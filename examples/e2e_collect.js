const SLPSDK = require('slp-sdk')
const bitbox = new SLPSDK({ restURL: 'https://rest.bitcoin.com/v2/' })
const Bitcoin = require('bitcoincashjs-lib');

const fs = require('fs');

// Check if e2e.json exists and, if it doesn't, create it and populate it with new private keys in WIF.

try {
    if(fs.existsSync('./e2e.json')) {
        console.log("e2e.json file exists.")
    } else {
        console.log('e2e.json file does not exist. Creating new file')
        let ecPairArray = []
        // Create 5 new random WIFs
        for (let i = 0; i < 5; i++) {
            let ecPair = Bitcoin.ECPair.makeRandom()
            ecPairArray.push(ecPair)
        }
        let jsonObj = {
            collectWif: bitbox.ECPair.toWIF(ecPairArray[0]),
            collectAddress: bitbox.ECPair.toCashAddress(ecPairArray[0]),
        
            wifArray: [
                bitbox.ECPair.toWIF(ecPairArray[1]),
                bitbox.ECPair.toWIF(ecPairArray[2]),
                bitbox.ECPair.toWIF(ecPairArray[3]),
                bitbox.ECPair.toWIF(ecPairArray[4])
            ]
        }
        // write file
        fs.writeFileSync('./e2e.json', JSON.stringify(jsonObj));
    }
} catch (err) {
    console.error(err);
    process.exit()
}

const e2eConfig = require('./e2e.json');

// This collects funds from addresses used in tests and then redistributes them as necessary

module.exports = async function() {
    try {

        let collectWif = e2eConfig.collectWif
        let collectAddress = e2eConfig.collectAddress

        let wifArray = e2eConfig.wifArray

        let addressArray = wifArray.map(wif => bitbox.ECPair.toCashAddress(bitbox.ECPair.fromWIF(wif)))

        console.log('Getting UTXOs and excluding SLP UTXOs...')
        let utxos = await bitbox.Address.utxo(addressArray)

        let transactionBuilder = new bitbox.TransactionBuilder('mainnet');

        let inputIndexWif = []
        let originalAmounts = []
        let totalInput = 0
        for (let i = 0; i < wifArray.length; i++) {
            let isSLPUtxo = await bitbox.Utils.tokenUtxoDetails(utxos[i].utxos)
            // console.log('isSLPUtxo', isSLPUtxo)
            for (let j = 0; j < utxos[i].utxos.length; j++) {
                // Don't burn SLP UTXOs
                if(!isSLPUtxo[j]) {
                    let utxo = utxos[i].utxos[j]
                    transactionBuilder.addInput(utxo.txid, utxo.vout)
                    inputIndexWif.push(wifArray[i])
                    originalAmounts.push(utxo.satoshis)
                    totalInput += utxo.satoshis
                }
            }
        }

        if(inputIndexWif.length > 0) {
            console.log('Building and broadcasting collection tx...')
        
            let byteCount = bitbox.BitcoinCash.getByteCount({ P2PKH: inputIndexWif.length }, { P2PKH: 1 })
            let collectAmount = totalInput - byteCount

            transactionBuilder.addOutput(collectAddress, collectAmount)

            for (let i = 0; i < inputIndexWif.length; i++) {
                transactionBuilder.sign(i, bitbox.ECPair.fromWIF(inputIndexWif[i]), null, transactionBuilder.hashTypes.SIGHASH_ALL, originalAmounts[i])
            }

            // build tx
            let tx = transactionBuilder.build()
            let hex = tx.toHex()
            let collectTxid = await bitbox.RawTransactions.sendRawTransaction(hex)
            console.log('Collection txid:', collectTxid)
        }

        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
        console.log('Waiting 2 seconds for transaction to index')
        await sleep(2000)

        console.log('Redistributing funds back to addresses...')

        utxos = await bitbox.Address.utxo(collectAddress)

        transactionBuilder = new bitbox.TransactionBuilder('mainnet');

        originalAmounts = []
        totalInput = 0
        for (let i = 0; i < utxos.utxos.length; i++) {
            let utxo = utxos.utxos[i]
            transactionBuilder.addInput(utxo.txid, utxo.vout)
                originalAmounts.push(utxo.satoshis)
                totalInput += utxo.satoshis
        }

        console.log('Total funds available to distribute:', totalInput)

        byteCount = bitbox.BitcoinCash.getByteCount({ P2PKH: utxos.utxos.length + 1 }, { P2PKH: 17 })

        if(totalInput - (29300 + byteCount) < 546) {
            console.log('You do not have enough total balance to do redistribution. You need at least ' + (29300 + byteCount + 546) +' satoshis in address ' + collectAddress)
            process.exit()
        }

        // First three addresses get 4 outputs of 1000 sats each
        for(let i=0; i < 3; i++) {
            for(let j=0; j < 4; j++) {
                transactionBuilder.addOutput(addressArray[i], 1000)
            }
        }
        // Add an additional 4000 for acceptor
        transactionBuilder.addOutput(addressArray[1], 4000)
        // Add an additional 8000 for acceptor
        transactionBuilder.addOutput(addressArray[1], 8000)
        // Oracle gets another for 1500
        transactionBuilder.addOutput(addressArray[3], 1500)
        // Oracle address gets an output of 3800
        transactionBuilder.addOutput(addressArray[3], 3800)
        // Change
        transactionBuilder.addOutput(collectAddress, totalInput - (29300 + byteCount))

        for (let i = 0; i < originalAmounts.length; i++) {
            transactionBuilder.sign(i, bitbox.ECPair.fromWIF(collectWif), null, transactionBuilder.hashTypes.SIGHASH_ALL, originalAmounts[i])
        }

        // build tx
        let tx = transactionBuilder.build()
        let hex = tx.toHex()
        let collectTxid = await bitbox.RawTransactions.sendRawTransaction(hex)
        console.log('Redistribute txid:', collectTxid)

    } catch (e) {
        console.error(e)
        process.exit()
    }
}