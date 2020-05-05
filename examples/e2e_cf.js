const SLPSDK = require('slp-sdk')
const bitbox = new SLPSDK({ restURL: 'https://rest.bitcoin.com/v2/' })
const swap = require('../index.js')
const Swp = swap.swp;
const swp = new Swp(bitbox);
const network = swp.network;
const utils = swap.utils;
const eccrypto = require('eccrypto-js');
const BigNumber = require('bignumber.js');
const Bitcoin = require('bitcoincashjs-lib');
const reverse = require('buffer-reverse');
const collect = require('./e2e_collect.js')
const e2eConfig = require('./e2e.json');

(async function(){
    try {

        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

        // First run the collection and redistribution script
        await collect()

    // 1. Set WIFs for the offering party and funding parties

        let offerWif = e2eConfig.wifArray[0]
        let acceptWifs = [
            e2eConfig.wifArray[1],
            e2eConfig.wifArray[2],
            e2eConfig.wifArray[3],
        ]

        let offerEcpair = bitbox.ECPair.fromWIF(offerWif)
        let acceptEcpairs = acceptWifs.map( function (acceptWif) {
            return bitbox.ECPair.fromWIF(acceptWif)
        })

        console.log('Waiting 5 seconds and fetching UTXOs for both parties...')
        await sleep(5000)

        // Check to make sure there is at least 1000 sats available in each 
        let offerAddr = bitbox.ECPair.toCashAddress(offerEcpair)
        let offerUtxos = await network.getUtxos(offerAddr, false)
        // Hydrate for SLP
        let offerSlpUtxos = await bitbox.Utils.tokenUtxoDetails(offerUtxos)
        // Filter out SLP UTXOs
        offerUtxos = offerUtxos.filter(function(utxo, index){
            if(!offerSlpUtxos[index])
                return true
            return false
        })
        let offerAvailableSats = offerUtxos.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.satoshis
        }, 0)
        if(offerAvailableSats < 1000)
            throw new Error('You must put at least 1000 satoshis in address: '+offerAddr+' to begin')

        let acceptAddrs = acceptEcpairs.map( function(acceptEcpair) {
            return bitbox.ECPair.toCashAddress(acceptEcpair)
        })

        let acceptUtxos = []
        for (let i = 0; i < acceptAddrs.length; i++) {
            let acceptAddr = acceptAddrs[i]
            let acceptUtxo = await network.getUtxos(acceptAddr, false)
            // Hydrate for SLP
            let acceptSlpUtxos = await bitbox.Utils.tokenUtxoDetails(acceptUtxo)
            // Filter out SLP UTXOs
            acceptUtxo = acceptUtxo.filter(function(utxo, index){
                if(!acceptSlpUtxos[index])
                    return true
                return false
            })
            // Sort the UTXOs by satoshi value in descending order
            acceptUtxo.sort(function (a, b) {
                return b.satoshis - a.satoshis;
            });

            let acceptAvailableSats = acceptUtxo.reduce(function (accumulator, currentValue) {
                return accumulator + currentValue.satoshis
            }, 0)
            if(acceptAvailableSats < 1000)
                throw new Error('You must put at least 1000 satoshis in address: '+acceptAddr+' to begin')

            acceptUtxos.push(acceptUtxo)
        }

        console.log('UTXOs found. Creating Offer Signal...')
   
    // 2. Offering Party constructs and broadcasts signal

        let msgType = 3 // crowdfund

        // Pay to 2 outputs at Offering Party's address
        let offerHash160 = bitbox.Address.cashToHash160(offerAddr)

        let outputArray= [
            {
                script: bitbox.Script.fromASM('OP_DUP OP_HASH160 '+offerHash160+' OP_EQUALVERIFY OP_CHECKSIG'),
                value: 3500
            },
            {
                script: bitbox.Script.fromASM('OP_DUP OP_HASH160 '+offerHash160+' OP_EQUALVERIFY OP_CHECKSIG'),
                value: 2000
            }
        ]

        let outputsBuf = utils.outputsArrayToBuffer(outputArray)
        // console.log('outputsBuf', outputsBuf)
        // console.log('outputsArray check', utils.outputsBufferToArray(outputsBuf))

        // estimate upload cost for funding the transaction
        const fileSize = 0 // No file included in this tx
        let config = {
            msgClass: 1,
            msgType: msgType,
            campaignUri: 'https://swapcrowdfund.com/somecampaign',
            outputs: outputsBuf,
        }
        let uploadCost = Swp.calculateFileUploadCost(fileSize, config);
        console.log('Cost to Upload Signal: ', uploadCost);
        
        if(uploadCost > offerAvailableSats)
            throw new Error('Insufficient funds to send offer signal. Needed: '+offerAvailableSats+'. You have: '+uploadCost)

        let offerSignalId = await swp.uploadSignal(msgType, offerUtxos, offerAddr, offerWif, config);
        console.log('Offer Signal Id: ', offerSignalId);

    // 3. Funding parties look for signal
        console.log('Waiting 2 seconds before searching for signal...')
        await sleep(2000)
        // let offerSignalId = 'swap:1e9469d2c5129b2f923323766a5e2343445e12cd146e2382902919178716fbef' // Placeholder for testing
        // First get metadata
        let offerMetadata;
        try {
            offerMetadata = await swp.bitdb.getSignalMetadata(3, offerSignalId);
            console.log('Offer signal found. Metadata: ', offerMetadata);
            console.log('Outputs array', offerMetadata.outputs)
        } catch (e) {
            throw new Error('Offer signal at '+offerSignalId+' not found')
        }

        // process.exit()

        // Each funding party creates and broadcasts a Payment message with their inputs
        // The first funder will contribute two inputs while the second and third will each contribute one input

        // Resort the UTXOs of the first acceptor by satoshi value in asscending order
        acceptUtxos[0].sort(function (a, b) {
            return a.satoshis - b.satoshis;
        });

        for (let i = 0; i < acceptAddrs.length; i++) {

            let transactionBuilder = new bitbox.TransactionBuilder('mainnet')
            // Add outputs from Offer Signal
            for (let j = 0; j < offerMetadata.outputs.length; j++) {
                let output = offerMetadata.outputs[j]
                transactionBuilder.addOutput(output.script, output.value)
            }
            // Add input and sign with ANYONECANPAY
            transactionBuilder.addInput(acceptUtxos[i][0].txid, acceptUtxos[i][0].vout)
            let currentInputIndex = transactionBuilder.transaction.tx.ins.length - 1
            let redeemScript
            transactionBuilder.sign(
                currentInputIndex, 
                acceptEcpairs[i], 
                redeemScript, 
                (transactionBuilder.hashTypes.SIGHASH_ALL | transactionBuilder.hashTypes.SIGHASH_ANYONECANPAY), 
                acceptUtxos[i][0].satoshis, 
                transactionBuilder.signatureAlgorithms.ECDSA)
            // Add additional input for first funder and sign with ANYONECANPAY
            if(i == 0) {
                transactionBuilder.addInput(acceptUtxos[i][1].txid, acceptUtxos[i][1].vout)
                currentInputIndex = transactionBuilder.transaction.tx.ins.length - 1
                transactionBuilder.sign(
                    currentInputIndex, 
                    acceptEcpairs[i], 
                    redeemScript, 
                    (transactionBuilder.hashTypes.SIGHASH_ALL | transactionBuilder.hashTypes.SIGHASH_ANYONECANPAY), 
                    acceptUtxos[i][1].satoshis, 
                    transactionBuilder.signatureAlgorithms.ECDSA)
            }

            let tx = transactionBuilder.build();

            let insArray = tx.ins.map(function (input) {
                input.txid = input.hash // buffer
                input.vout = input.index // int
                input.scriptSig = input.script // buffer
                input.sequence = 4294967295 // UINT_MAX
                return input
            })
        
            // Convert to raw tx inputs format
            let insBuf = utils.inputsArrayToBuffer(insArray)

            // console.log('ins for '+acceptAddrs[i], utils.inputsBufferToArray(insBuf))

            // console.log('acceptUtxos before for '+acceptAddrs[i], acceptUtxos[i])

            // Shift the UTXOs used off of the front of the UTXO array for this funding party
            for(j = 0; j < insArray.length; j++) {
                acceptUtxos[i].shift()
            }

            // console.log('acceptUtxos after for '+acceptAddrs[i], acceptUtxos[i])

            let pubKeyBuf = bitbox.ECPair.toPublicKey(offerEcpair)
            let structuredEc = await eccrypto.encrypt(pubKeyBuf, insBuf)
            let encryptedEc = Buffer.concat([structuredEc.ephemPublicKey, structuredEc.iv, structuredEc.ciphertext, structuredEc.mac])

            // 3 - estimate upload cost for funding the transaction
            const fileSize = encryptedEc.byteLength
            let paymentConfig = {
                msgClass: 2,
                msgType: 3,
                fileSize: fileSize,
                signalSha256Hex: offerMetadata.URI.replace('swap:', ''),
                chunkData: null  // chunk not needed for cost estimate stage
            };
            let uploadCost = Swp.calculateFileUploadCost(fileSize, config);
            console.log('upload cost: ', uploadCost);

            acceptAvailableSats = acceptUtxos[i].reduce(function (accumulator, currentValue) {
                return accumulator + currentValue.satoshis
            }, 0)
            if(acceptAvailableSats < uploadCost)
                throw new Error('You must have an additional '+uploadCost+' satoshis in available UTXOS in address: '+acceptAddrs[i]+' to upload payment. You only have '+acceptAvailableSats)
    
            let paymentFileId = await swp.uploadPayment(acceptUtxos[i], acceptAddrs[i], acceptWifs[i], encryptedEc, paymentConfig.signalSha256Hex, null, null, true);
            console.log('Payment file ID for '+acceptAddrs[i]+': ', paymentFileId);
        }

    // 5. Offering party looks for payments and downloads them once found
        console.log('Waiting 2 seconds for payments to index...')
        await sleep(2000)
        // First get metadata
        //let offerMetadata = {URI: 'swap:1e9469d2c5129b2f923323766a5e2343445e12cd146e2382902919178716fbef'} // Placeholder for testing
        let paymentMetadata = await swp.bitdb.getPaymentMetadata(3, null, offerMetadata.URI);
        console.log('Exchange payment metadata:', paymentMetadata);

        console.log('Downloading and validating payments...')
        // Download payments and make sure that the inputs are unspent
        // Additional validations can (and should) be made against the signatures to ensure they are valid and use ANYONECANPAY
        let validInputs = []
        let inputTotal = 0
        for (let i = 0; i < paymentMetadata.length; i++) {
            let payment = paymentMetadata[i]
            let result = await swp.downloadTx(payment.URI, offerWif);
            console.log("crowdfund tx download complete for "+ payment.URI);

            let decodeInputs = utils.inputsBufferToArray(result.fileBuf).map(function(input){
                input.txid = input.txid.toString('hex')
                input.scriptSig = input.scriptSig.toString('hex')
                return input
            })
            console.log('decodeInputs for '+ payment.URI, decodeInputs)

            // If inputs are unspent, add the input to the validInputs array and add satoshis to total
            let txIds = decodeInputs.map(x => x.txid)
            let transactionDetails = await bitbox.Transaction.details(txIds)
            for (let j = 0; j < decodeInputs.length; j++) {
                let txOuts = transactionDetails[j].vout
                let outToCheck = txOuts[decodeInputs[j].vout]
                // If unspent, add to validInputs
                if (!outToCheck.spentTxId && !outToCheck.spentIndex) {
                    validInputs.push(decodeInputs[j])
                    inputTotal += Number(outToCheck.value) * 100000000
                }
            }
        }

        console.log('validInputs', validInputs)
        console.log('inputTotal', inputTotal)

        let outputTotal = offerMetadata.outputs.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.value
        }, 0)

        console.log('outputTotal', outputTotal)
        let byteCount = bitbox.BitcoinCash.getByteCount({ P2PKH: validInputs.length }, { P2PKH: offerMetadata.outputs.length })
        console.log('byteCount', byteCount)
        if (inputTotal < outputTotal + byteCount)
            throw new Error('Inputs are insufficient. Crowdfund transaction cannot be created')
        // If the inputs are sufficient for creating a valid transaction, create and broadcast transaction
        let finalTransactionBuilder = new bitbox.TransactionBuilder('mainnet')

        // Add outputs from Offer Signal
        for (let i = 0; i < offerMetadata.outputs.length; i++) {
            let output = offerMetadata.outputs[i]
            finalTransactionBuilder.addOutput(output.script, output.value)
        }
        // Add valid inputs
        for (let i = 0; i < validInputs.length; i++) {
            let input = validInputs[i]
            let options = {
                script: Buffer.from(input.scriptSig, 'hex'),
                sequence: 4294967295
            }
            finalTransactionBuilder.transaction.__addInputUnsafe(
                reverse(Buffer.from(input.txid, 'hex')), // Since we are 'close to the metal' we need to reverse the bytes manually here
                input.vout,
                options
            )
        }

        let finalTx = finalTransactionBuilder.build()
        let finalHex = finalTx.toHex()

        console.log('Fully funded raw tx', finalHex)

        // Broadcast completed crowdfund transaction
        let sendRawTransaction = await bitbox.RawTransactions.sendRawTransaction(finalHex);
        console.log('Final, fully funded tx:', sendRawTransaction);


    } catch (e) {
        console.log(e)
    }
})();