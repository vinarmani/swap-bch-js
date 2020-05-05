const SLPSDK = require('slp-sdk')
const bitbox = new SLPSDK({ restURL: 'https://rest.bitcoin.com/v2/' })
const e2eConfig = require('./e2e.json');

// This collects funds from addresses used in tests and then redistributes them as necessary

/**
 * Edit e2e.json (with your own) so 
 * 
 *  let collectWif = 'KzyECu4WsxPkV74ge8c1AddQp9Z2TgKfyDJS1SWs68mwPvuLqZZS'
 *  let collectAddress = 'bitcoincash:qzp3t8w8nmwy0eew2ddfulwz6t6t8ln73s5nhlu8pt' // must be address for collectWif
 *
 *  let wifArray = [
 *      'L1tYLRZwubd23R1fP3u29nNhR7cQMV6obuboWtRYAMtNoeYhA1v6', // offer
 *      'L2vmQ1chDJ3HcfrVjJuvGfgLCEPp6TFtTK6Q3MJa8AeD1x8S5fxz', // accept
 *      'KycDPL5YLPXQHoSw8SL6mGHWbFeLA276vdywG6iSuuyDAKHC5GKt', // crowdfunder 3
 *      'L3ZvsbDF3Rj48NqxWxyL8oufL4iRxiLxZHrSNgdQAiHYf8XzuXNe', // oracle
 *  ]
 * 
 */

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

        if (utxos.length == 0) {
            console.log('No funds in collection address to redistribute')
            process.exit()
        }

        transactionBuilder = new bitbox.TransactionBuilder('mainnet');

        originalAmounts = []
        totalInput = 0
        for (let i = 0; i < utxos.utxos.length; i++) {
            let utxo = utxos.utxos[i]
            transactionBuilder.addInput(utxo.txid, utxo.vout)
                originalAmounts.push(utxo.satoshis)
                totalInput += utxo.satoshis
        }

        console.log(totalInput)

        byteCount = bitbox.BitcoinCash.getByteCount({ P2PKH: utxos.utxos.length }, { P2PKH: 17 })

        if(totalInput - (29300 + byteCount) < 546) {
            console.log('You do not have enough total balance to do redistribution. You need at least ' + (29300 + byteCount + 546) +' in address ' + collectAddress)
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