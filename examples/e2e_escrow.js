const SLPSDK = require('slp-sdk')
const bitbox = new SLPSDK({ restURL: 'https://rest.bitcoin.com/v2/' })
const swap = require('../index.js')
const Swp = swap.swp;
const swp = new Swp(bitbox);
const Bfp = swap.bfp;
const bfp = new Bfp(bitbox);
const network = swp.network;
const utils = swap.utils;
const eccrypto = require('eccrypto-js');
const BigNumber = require('bignumber.js');
const Bitcoin = require('bitcoincashjs-lib');
const jeton = require('jeton-lib');
const PrivateKey = jeton.PrivateKey
const Signature = jeton.Signature
const OutputScript = jeton.escrow.OutputScript
const Transaction = jeton.Transaction
const collect = require('./e2e_collect.js')
const e2eConfig = require('./e2e.json');
const axios = require('axios');

async function getOracleResult(oracleBfp){
    oracleBfp = oracleBfp.replace('bitcoinfile:', '')
    let insightUrl = 'http://explorer.api.bitcoin.com/bch/v1/tx/'+oracleBfp
    let response = await axios({
        url: insightUrl,
        method: 'get'
    })
    let txDetails = response.data
    // let txDetails = await bitbox.Transaction.details(oracleBfp) // Seems to fail to find results baton, using axios to Ninsight instead
    console.log('txDetails.vout', txDetails.vout)
    let spentTxId = txDetails.vout[1].spentTxId
    let txType = 'chunk'
    // If spent, walk the chain and find the Bfp
    if(spentTxId) {
        console.log('Oracle has results. Fetching now...')
        while (txType == 'chunk') {
            txDetails = await bitbox.Transaction.details(spentTxId)
            let opReturnHex = txDetails.vout[0].scriptPubKey.hex
            let parsedOpReturn = bfp.parsebfpDataOpReturn(opReturnHex)
            // console.log('parsedOpReturn', parsedOpReturn)
            txType = parsedOpReturn.type
            spentTxId = txDetails.vout[1].spentTxId
        }

        // Use current txDetails for oracleResult
        if (txType == 'metadata') {
            oracleResultBfp = txDetails.txid
            metadata = await bfp.bitdb.getFileMetadata(oracleResultBfp);
            console.log('oracle result metadata: ', metadata);
            result = await bfp.downloadFile(oracleResultBfp);
            console.log("oracle result download complete.");
            // Wait for download to complete

            // 2 - result includes a boolean check telling you if the file's sha256 matches the file's metadata```
            if(result.passesHashCheck){
                console.log("Success: downloaded file sha256 matches file's metadata");
            }

            // 3 - do something with the file...
            console.log('oracle result json', result.fileBuf.toString('utf-8'))
            return result.fileBuf;
        } else {
            throw Error('Baton is not spent to a proper result bitcoinfile')
        }
    } else {
        console.log("Oracle does not have results")
        return null
    }
}


function joinBuffers(buffers, delimiter = ' ') {
    let d = Buffer.from(delimiter);
  
    return buffers.reduce((prev, b) => Buffer.concat([prev, d, b]));
  }


(async function(){
    try {

        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

        // First run the collection and redistribution script
        await collect()

    // 0. Set Oracle address and WIF
        let oracleWif = e2eConfig.wifArray[3] // Oracle from e2e.json
        let oracleEcpair = bitbox.ECPair.fromWIF(oracleWif)
        let oracleAddress = bitbox.ECPair.toCashAddress(oracleEcpair)
   
    // 1. Set WIFs for the offering party and accepting party

        let offerWif = e2eConfig.wifArray[0]
        let acceptWif = e2eConfig.wifArray[1]

        let offerEcpair = bitbox.ECPair.fromWIF(offerWif)
        let acceptEcpair = bitbox.ECPair.fromWIF(acceptWif)

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
        if(offerAvailableSats < 3000)
            throw new Error('You must put at least 1000 satoshis in address: '+offerAddr+' to begin')

        let acceptAddr = bitbox.ECPair.toCashAddress(acceptEcpair)
        let acceptPubKey = bitbox.ECPair.toPublicKey(acceptEcpair)
        acceptUtxos = await network.getUtxos(acceptAddr, false)
        // Hydrate for SLP
        let acceptSlpUtxos = await bitbox.Utils.tokenUtxoDetails(acceptUtxos)
        // Filter out SLP UTXOs
        acceptUtxos = acceptUtxos.filter(function(utxo, index){
            if(!acceptSlpUtxos[index])
                return true
            return false
        })
        let acceptAvailableSats = acceptUtxos.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.satoshis
        }, 0)
        if(acceptAvailableSats < 3000)
            throw new Error('You must put at least 1000 satoshis in address: '+acceptAddr+' to begin')

        console.log('UTXOs found. Creating Oracle Signal...')

    // 2. Oracle broadcasts signal
        const oracleData = {
            "type":"event",
            "data":{
                "league":"nba",
                "date":"20200222",
                "status":"UNPLAYED",
                "awayTeam":{
                    "id":"SAC",
                    "name":"Sacramento Kings",
                    "logo":"https://global.nba.com/media/img/teams/00/logos/SAC_logo.svg"
                },
                "homeTeam":{
                    "id":"LAC",
                    "name":"Los Angeles Clippers",
                    "logo":"https://global.nba.com/media/img/teams/00/logos/LAC_logo.svg"
                }
            },
            "contracts":{
                "jeton":{
                    "escrow":{
                        "parties":[
                            {
                                "name":"SAC Wins",
                                "message":"NBA-20200222-SAC-LAC_SAC-WIN",
                                "weight":1
                            },
                            {
                                "name":"LAC Wins",
                                "message":"NBA-20200222-SAC-LAC_LAC-WIN",
                                "weight":1
                            }
                        ],
                        "terms":[
                            {
                                "name":"refereePubKey",
                                "type":"bytes",
                                "value":"02c3e42dd2a3806f1bc9a9f32c3a97b872ed03ce8a779242b8bf2dba636ce655b0"
                            }
                        ]
                    }
                }
            }
        }
        const oracleJson = JSON.stringify(oracleData)

        // get a file and file metadata somehow 
        const oracleFileBuffer = new Buffer.from(oracleJson);
        const oracleFileName = 'NBA-20200222-SAC-LAC'
        const oracleFileExt = '.json'
        const oracleFileSize = oracleFileBuffer.length
        const oracleFileSha256Hex = bitbox.Crypto.sha256(oracleFileBuffer).toString('hex');

        // estimate upload cost for funding the transaction
        let config = {
            msgType: 1,
            chunkCount: 0,
            fileName: oracleFileName,
            fileExt: oracleFileExt,
            fileSize: oracleFileSize,
            fileSha256Hex: oracleFileSha256Hex,
            prevFileSha256Hex: null,
            fileUri: null,
            chunkData: null  // chunk not needed for cost estimate stage
        };
        let uploadCost = Bfp.calculateFileUploadCost(oracleFileSize, config);
        console.log('oracle signal upload cost: ', uploadCost);

        // create a funding transaction

        // Make sure address above is funded with the amount equal to the uploadCost

        let oracleFundingUtxos = await network.getUtxos(oracleAddress, false)
        oracleFundingUtxos.sort((function(a, b) {
            return b.satoshis - a.satoshis;
          }))
        let oracleFundingUtxo = oracleFundingUtxos[0];
        console.log('oracleFundingUtxos', oracleFundingUtxos)
        
        console.log('got oracle funding Utxo.')

        if(oracleFundingUtxo.satoshis < uploadCost * 2)
            throw new Error('You need to begin with a single UTXO of at least '+uploadCost * 2+' satoshis in address: '+oracleAddress+' to begin')

        // wait for network to resolve...

        // upload the file
        let oracleFileId = await bfp.uploadFile(oracleFundingUtxo,
            oracleAddress,
            oracleWif,
            oracleFileBuffer,
            config.fileName,
            config.fileExt,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            3000);
        console.log('Oracle signal Id: ', oracleFileId);
        //process.exit()

        console.log('UTXOs found. Waiting 5 seconds and creating Offer Signal...')
        await sleep(5000)

    // 3. Offering party looks for oracle, constructs offer and broadcasts
        // let oracleBfp = 'bitcoinfile:b3f4023cabcf8a5437bc84e736e6a24c50a7c1bb12089a5a17d4e9fd04340812'
        let oracleBfp = oracleFileId

        metadata = await bfp.bitdb.getFileMetadata(oracleBfp);
        // console.log('oracle signal metadata: ', metadata);
        result = await bfp.downloadFile(oracleBfp);
        console.log("oracle download complete.");
        // Wait for download to complete

        // result includes a boolean check telling you if the file's sha256 matches the file's metadata```
        if(result.passesHashCheck){
            console.log("Success: downloaded oracle signal file sha256 matches file's metadata");
        }

        // do something with the file...
        let fileBuffer = result.fileBuf;
        console.log('oracle json', fileBuffer.toString('utf-8'))

        // Check to see if baton is spent
        let oracleResult;
        try {
            oracleResult = await getOracleResult(oracleBfp)
        } catch (e) {
            console.error(e)
        }

        // Construct the oracle terms buffer to use in the Offer Signal
        let compilerId = 'jeton'
        let compilerVersion = 'escrow'
        let oracleSignalObject = JSON.parse(fileBuffer.toString('utf-8'))
        let oracleTermsArray = oracleSignalObject.contracts[compilerId][compilerVersion].terms
        let termsBuffer = utils.termsArrayToBuffer(oracleTermsArray)

        // Make sure address above is funded with the amount equal to the uploadCost
        let fundingUtxos = await network.getUtxos(offerAddr, false);
        
        console.log('got funding Utxos for offer')
        console.log(fundingUtxos)

        if(fundingUtxos.length < 3)
          throw new Error ('must have at least 3 UTXOs in '+offerAddr+', will use smallest to make wager')

        // Sort UTXOs and pick smallest to use as wager in signal
        fundingUtxos.sort(function(a, b) {
            return  b.satoshis - a.satoshis
        })

        let wagerOfferUtxo = fundingUtxos.pop()

        offerAvailableSats = fundingUtxos.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.satoshis
          }, 0)

        console.log('available satoshis:', offerAvailableSats)

        let msgType = 2 // escrow

        // estimate upload cost for funding the transaction
        offerFileSize = 0 // No file included in this tx
        config = {
            msgClass: 1,
            msgType: msgType,
            oracleBfp: oracleBfp,
            compilerId: compilerId,
            compilerVersion: compilerVersion,
            contractPartyIndex: 1,
            pubKey: bitbox.ECPair.toPublicKey(offerEcpair).toString('hex'),
            exactUtxoTxId: wagerOfferUtxo.txid,
            exactUtxoIndex: wagerOfferUtxo.vout,
            terms: termsBuffer.toString('hex'),
            appendedScriptPubKey: '76a91410c1db6f3076e020974ef540199e7ae4b76fbafa88ac',
            appendedSats: 1000
        }
        uploadCost = Swp.calculateFileUploadCost(offerFileSize, config);
        console.log('upload cost: ', uploadCost);

        if(uploadCost > offerAvailableSats)
            throw new Error('Insufficient funds to send offer signal. Needed: '+uploadCost+'. You have: '+offerAvailableSats)
    
        // wait for network to resolve...
    
        // upload the offer
        let offerSignalId = await swp.uploadSignal(msgType, fundingUtxos, offerAddr, offerWif, config);
        console.log('Offer Signal ID: ', offerSignalId);

    // 4. Accepting party looks for offer (we filter for one just broadcast)
        // let offerSignalId = 'swap:62d3c03be906f3874a1d720b3c5e401fb6abe2bff660e52770c366a2c3d001fd' // as example

        console.log('Waiting 5 seconds before searching for offer signal...')
        await sleep(5000)
        // First get metadata
        let offerMetadata;
        try {
            offerMetadata = await swp.bitdb.getSignalMetadata(2, offerSignalId);
            console.log('Offer signal found. Metadata: ', offerMetadata);
        } catch (e) {
            throw new Error('Offer signal at '+offerSignalId+' not found')
        }

        // let offerMetadata = { 
        //     timestamp: 'unconfirmed',
        //     oracleBfp:
        //     'bitcoinfile:974b3bf766b36434a21fe6f8782d8056f932d33ae401e92cf31a88204a21ea3e',
        //     contractTermsIndex: 0,
        //     contractPartyIndex: 1,
        //     compilerId: 'jeton',
        //     compilerVersion: 'escrow',
        //     pubKey:
        //     '0299edb7a63380305c32b6fd54e09f7c2cbcf85b7182a691b065d8e5aff16ef61f',
        //     exactUtxoTxId:
        //     '3757612cf36aae7cebaf71099139edd19e67cb5bdddc40514c38fe91341db5a6',
        //     exactUtxoIndex: 1,
        //     appendedScriptPubKey: '76a91410c1db6f3076e020974ef540199e7ae4b76fbafa88ac',
        //     appendedSats: 2000,
        //     URI:
        //     'swap:d7cbeaab6d02769464f9c71a6efd8cd2682d728d7e5de3ac278372b1b81c9d83' 
        // }

    // 5. Accepting party crafts escrow payment
        console.log('Grabbing offered UTXOs information...')
        let offeredTx = await bitbox.Transaction.details(offerMetadata.exactUtxoTxId)
        let offeredVout = offeredTx.vout[offerMetadata.exactUtxoIndex]
        let offeredUtxo = {
            txid: offeredTx.txid,
            vout: offerMetadata.exactUtxoIndex,
            amount: offeredVout.value,
            satoshis: offeredVout.value * 100000000,
            height: offeredTx.blockheight,
            confirmations: offeredTx.confirmations,
            scriptPubKey: offeredVout.scriptPubKey.hex
        }
        let hydratedUtxos = await bitbox.Utils.tokenUtxoDetails([offeredUtxo])
        let hydratedUtxo = hydratedUtxos[0]
        let isSlpUtxo = hydratedUtxo ? true : false

        if (isSlpUtxo) {
            hydratedUtxo.scriptPubKey = offeredUtxo.scriptPubKey
            offeredUtxo = hydratedUtxo
        }
        
        console.log('Utxo being wagered', isSlpUtxo ? hydratedUtxo : offeredUtxo)

        // Go get oracle data so we can build the wager
        oracleBfp = offerMetadata.oracleBfp

        metadata = await bfp.bitdb.getFileMetadata(oracleBfp);
        // console.log('oracle signal metadata: ', metadata);
        result = await bfp.downloadFile(oracleBfp);
        console.log("oracle download complete.");
        // Wait for download to complete

        // result includes a boolean check telling you if the file's sha256 matches the file's metadata```
        if(result.passesHashCheck){
            console.log("Success: downloaded oracle signal file sha256 matches file's metadata");
        }

        // do something with the file...
        fileBuffer = result.fileBuf;
        console.log('oracle json', fileBuffer.toString('utf-8'))

        // Check to see if baton is spent
        try {
            oracleResult = await getOracleResult(oracleBfp)
        } catch (e) {
            console.error(e)
        }

        let oracleObj = JSON.parse(fileBuffer.toString('utf-8'))

        // Use Signal and Oracle data to build accept transaction
        // Create the output script
        let oracleJetonData = oracleObj.contracts[compilerId][compilerVersion]
        let oraclePubKey = oracleJetonData.terms.find( ({ name }) => name === 'refereePubKey' )
        var outputScriptData = {
            refereePubKey: jeton.PublicKey.fromString(oraclePubKey.value),
            parties: [
                {
                    message: oracleJetonData.parties[0].message, 
                    pubKey: offerMetadata.contractPartyIndex == 0 ? new jeton.PublicKey(offerMetadata.pubKey) : new jeton.PublicKey(acceptPubKey)
                },
                {
                    message: oracleJetonData.parties[1].message, 
                    pubKey: offerMetadata.contractPartyIndex == 1 ? new jeton.PublicKey(offerMetadata.pubKey) : new jeton.PublicKey(acceptPubKey)
                }
            ]
        }

        let outScript = new OutputScript(outputScriptData)
        let p2shScriptBuf = outScript.toBuffer()

        console.log('Contract successfully created. Will be at address:', outScript.toAddress().toString())
        console.log('Contract script buffer:', p2shScriptBuf.toString('hex'))

        // Calculate output amounts

        let feeAmount = offerMetadata.appendedScriptPubKey != '' && offerMetadata.appendedSats >= 546 ? offerMetadata.appendedSats : 0
        console.log('Fee amount:', feeAmount)
        let escrowOutputAmount = parseInt(offeredUtxo.satoshis * outputScriptData.parties.length)
        console.log('escrowOutputAmount:', escrowOutputAmount)
        let totalOutputAmount = parseInt(escrowOutputAmount + feeAmount)
        console.log('totalOutputAmount:', totalOutputAmount)
        let acceptorOutputAmount = parseInt(totalOutputAmount - offeredUtxo.satoshis)
        console.log('acceptorOutputAmount:', acceptorOutputAmount)

        if(acceptorOutputAmount > acceptAvailableSats)
            throw new Error('You must have at least '+acceptorOutputAmount+' satoshis in address: '+acceptAddr+' to place your wager')

        // Get needed UTXOS
        let satsUsed = 0
        let utxosToUse = []
        // Sort UTXOs and pick largest to use as wager in payment
        acceptUtxos.sort(function(a, b) {
            return  a.satoshis - b.satoshis
        })
        while(satsUsed < acceptorOutputAmount || satsUsed - acceptorOutputAmount < 546) {
            if(acceptUtxos.length == 0)
                throw new Error('You ran out of available UTXOs: '+acceptAddr+' to add more') 
            let popped = acceptUtxos.pop()
            utxosToUse.push(popped)
            satsUsed += popped.satoshis
        }

        //console.log('acceptUtxos:', acceptUtxos)
        //console.log('utxosToUse:', utxosToUse)
        console.log('satsUsed:', satsUsed)

        let hasChangeOutput = satsUsed > acceptorOutputAmount
        let numInputs = utxosToUse.length + 1
        // Calculate outputs: escrow output + appended output + changeOutput
        let numOutputs = 1 + (feeAmount > 0 ? 1 : 0) + (hasChangeOutput ? 1 : 0)
        let byteCount = bitbox.BitcoinCash.getByteCount({ P2PKH: numInputs }, { P2PKH: numOutputs })
        console.log('byteCount:', byteCount)
        let changeAmount = satsUsed + offeredUtxo.satoshis - byteCount - totalOutputAmount

        // Construct tx
        let transactionBuilder = new bitbox.TransactionBuilder('mainnet')
        // Add offeror's UTXO
        transactionBuilder.addInput(offeredUtxo.txid, offeredUtxo.vout)
        // Add acceptor's UTXOS
        for (let i = 0; i < utxosToUse.length; i++){
            transactionBuilder.addInput(utxosToUse[i].txid, utxosToUse[i].vout)
        }
        // Add Escrow Output
        transactionBuilder.addOutput(outScript.toAddress().toString(), escrowOutputAmount)
        // Add Fee Output
        if (feeAmount > 0)
            transactionBuilder.addOutput(Buffer.from(offerMetadata.appendedScriptPubKey, 'hex'), feeAmount)
        // Add change Output
        if(hasChangeOutput)
            transactionBuilder.addOutput(acceptAddr, changeAmount)

        // Sign BCH inputs (start at index #1)
        for (let i=0; i < utxosToUse.length; i++) {
            let utxo = utxosToUse[i]
            transactionBuilder.sign((i+1), acceptEcpair, null, transactionBuilder.hashTypes.SIGHASH_ALL, utxo.satoshis)
        }

        // build tx
        let tx = transactionBuilder.transaction.buildIncomplete()

        // output rawhex
        let txHash = tx.toHex()

        console.log('Half-signed transaction hex', txHash)

        // Broadcast Payment
        console.log('Constructing encrypted escrow payment broadcast...')
        const txFileBuffer = new Buffer.from(txHash, 'hex');
        // Prepend P2SH script buffer length bytes onto scrpt buffer + transaction buffer
        let scriptBufLengthBytes = Buffer.allocUnsafe(4)
        scriptBufLengthBytes.writeUInt32LE(p2shScriptBuf.byteLength, 0)
        const paymentFileBuffer = Buffer.concat([scriptBufLengthBytes, p2shScriptBuf, txFileBuffer])

        // Check to see that paymentFileBuffer is parsable
        let sbLen = paymentFileBuffer.readInt32LE()
        let pscriptBuf = paymentFileBuffer.slice(4,sbLen + 4)
        let txFileBuf = paymentFileBuffer.slice(sbLen + 4)
        if(txFileBuffer.toString('hex') == txFileBuf.toString('hex') && p2shScriptBuf.toString('hex') == pscriptBuf.toString('hex'))
            console.log('Escrow Payment file buffer encoded correctly')
        else
            throw new Error('Escrow Payment file buffer has not been encoded correctly. Cannot be parsed')


        // Get public key from spent input
        let signalTxHash = offerMetadata.URI.replace('swap:', '')
        let swapTxDetails = await bitbox.Transaction.details(signalTxHash)
        let spentAsm = swapTxDetails.vin[0].scriptSig.asm
        let pubKey = spentAsm.split(' ')[1]

        // Encrypt message
        
        let pubKeyBuf = Buffer.from(pubKey, 'hex')
        let structuredEc = await eccrypto.encrypt(pubKeyBuf, paymentFileBuffer)
        let encryptedEc = Buffer.concat([structuredEc.ephemPublicKey, structuredEc.iv, structuredEc.ciphertext, structuredEc.mac])
        //let structuredP2SHEc = await eccrypto.encrypt(pubKeyBuf, p2shScriptBuf)
        //let encryptedP2SHEc = Buffer.concat([structuredP2SHEc.ephemPublicKey, structuredP2SHEc.iv, structuredP2SHEc.ciphertext, structuredP2SHEc.mac])

        // 3 - estimate upload cost for funding the transaction
        const paymentFileSize = encryptedEc.byteLength
        config = {
            msgClass: 2,
            msgType: 2,
            fileSize: paymentFileSize,
            signalSha256Hex: signalTxHash,
            p2shScriptPubKey: outScript.toScriptHash().toBuffer(), //change from 'subscriptEnc' to 'p2shScriptPubKey'
            chunkData: null  // chunk not needed for cost estimate stage
        };
        uploadCost = Swp.calculateFileUploadCost(paymentFileSize, config);
        console.log('upload cost: ', uploadCost);

        acceptAvailableSats = acceptUtxos.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.satoshis
        }, 0)

        if(acceptAvailableSats < uploadCost)
            throw new Error('Insufficient funds in '+acceptAddr+' to send escrow payment. Needed: '+uploadCost+'. You have: '+acceptAvailableSats)

        let acceptPaymentFileId = await swp.uploadPayment(acceptUtxos,
            acceptAddr,
            acceptWif,
            encryptedEc,
            config.signalSha256Hex,
            swapTxDetails.vout[1].scriptPubKey.addresses[0],
            config.p2shScriptPubKey,
            false,
            null,
            null,
            null,
            null,
            3000); // Increase time between chunks to allow indexer to catch up
        console.log('acceptPaymentFileId: ', acceptPaymentFileId);

        // process.exit()

        // 5. Offering party looks for payment and downloads it once found
        console.log('Waiting 5 seconds before searching for accepted payment...')
        await sleep(5000)
        // First get metadata
        try {
            acceptPaymentFileId = acceptPaymentFileId
        } catch (e) {
            console.error(e)
            // acceptPaymentFileId = 'swap:777bd57a7e7992012d824e728a39767eed59b7c93bafc1ba4d3f3ce0140301a0' // Placeholder for testing
        }
        let paymentMetadata = await swp.bitdb.getPaymentMetadata(2, acceptPaymentFileId);
        console.log('Exchange payment metadata:', paymentMetadata);

        // Tx is encrypted
        let paymentTx = await swp.downloadTx(acceptPaymentFileId, offerWif);
        console.log("Accept payment tx (half-signed) download complete.", paymentTx.fileBuf.toString('hex'));

        // Parse payment FileBuffer
        let subscriptLen = paymentTx.fileBuf.readInt32LE()
        let subscriptBuf = paymentTx.fileBuf.slice(4,subscriptLen + 4)
        // Parse the subscript using jeton-lib e001
        let parsedSubscript = OutputScript.parseScriptPubKey(subscriptBuf.toString('hex'))
        console.log('parsed subscript:', parsedSubscript)
        console.log('parsed subscript parties:', parsedSubscript.parties)
        let escrowTxBuf = paymentTx.fileBuf.slice(subscriptLen + 4)

        // let csTransaction = new Transaction(escrowTxBuf)

        let csTransaction = Bitcoin.Transaction.fromBuffer(escrowTxBuf)
        let csTransactionBuilder = Bitcoin.TransactionBuilder.fromTransaction(csTransaction, 'mainnet')

        // console.log(csTransactionBuilder.inputs)
        // console.log(csTransaction.outputs)

    // 6. Offering party validates payment
        // Get offer signal and oracle data
        console.log('Fetching original Offer Signal and Oracle Signal to validate payment...')
        let signalMetadata
        try {
            signalMetadata = await swp.bitdb.getSignalMetadata(2, paymentMetadata.signalId);
            // console.log('Offer signal found. Metadata: ', signalMetadata);
        } catch (e) {
            throw new Error('Offer signal at '+offerSignalId+' not found')
        }

        // Go get oracle data so we can build the wager
        oracleBfp = signalMetadata.oracleBfp

        metadata = await bfp.bitdb.getFileMetadata(oracleBfp);
        // console.log('oracle signal metadata: ', metadata);
        result = await bfp.downloadFile(oracleBfp);
        console.log("Oracle Signal download complete.");
        // Wait for download to complete

        // result includes a boolean check telling you if the file's sha256 matches the file's metadata```
        if(result.passesHashCheck){
            console.log("Success: downloaded Oracle Signal file sha256 matches file's metadata");
        }

        // do something with the file...
        fileBuffer = result.fileBuf;
        console.log('oracle json', fileBuffer.toString('utf-8'))

        // Check to see if baton is spent
        try {
            oracleResult = await getOracleResult(oracleBfp)
        } catch (e) {
            console.error(e)
        }

        oracleObj = JSON.parse(fileBuffer.toString('utf-8'))

        // Use Signal and Oracle data to build accept transaction
        // Create the output script
        oracleJetonData = oracleObj.contracts[offerMetadata.compilerId][offerMetadata.compilerVersion]
        oraclePubKey = oracleJetonData.terms.find( ({ name }) => name === 'refereePubKey' )

        console.log('oracleJetonData: ', oracleJetonData)
        // Validate that the refereePubKey, and messages + offering party pubKeyHash are accurate for oracle and signal
        if(parsedSubscript.refereePubKey != oraclePubKey.value)
            throw new Error('Referee public key does not match oracle data')
        
        for(let i = 0; i < oracleJetonData.parties.length; i++) {
            if(oracleJetonData.parties[i].message != parsedSubscript.parties[i].message)
                throw new Error('Party messages do not match oracle data') 
        }

        let hashbuffer = jeton.PublicKey.fromString(signalMetadata.pubKey).toAddress().hashBuffer

        if(parsedSubscript.parties[signalMetadata.contractPartyIndex].pubKeyHash != hashbuffer.toString('hex'))
            throw new Error('Incorrect public key used for offering party. Does not match offer signal') 

        // Validate that the subscript translates to scriptPubKey in output 0
        var outputP2SH = new jeton.Script()
            .add('OP_HASH160')
            .add(jeton.crypto.Hash.sha256ripemd160(subscriptBuf))
            .add('OP_EQUAL')

        let correctContractAmount = false
        let utxoSats = 0
        for (let i = 0; i < csTransactionBuilder.tx.outs.length; i++){
            let output = csTransactionBuilder.tx.outs[i]
            if (outputP2SH.toHex() == output.script.toString('hex')) {
                // Validate that amount in output is correct (UTXO amount of vin[0] * 2)
                let offeredTx = await bitbox.Transaction.details(signalMetadata.exactUtxoTxId)
                let offeredVout = offeredTx.vout[signalMetadata.exactUtxoIndex]
                utxoSats = parseInt(offeredVout.value * 100000000)
                if(output.value == utxoSats * 2)
                    correctContractAmount = true
            }
        }

        if(!correctContractAmount)
            throw new Error('Incorrect amount in escrow contract. Should be')  

        // Validate that all other inputs are signed
        for (let i = 1; i < csTransactionBuilder.inputs.length; i++){
            let input = csTransactionBuilder.inputs[i]
            if(!input.signatures)
                throw new Error('Missing signatures on inputs from accepting party')
        }

    // 7. If all checks pass, payment is valid. Offering party countersigns input 0 and broadcasts
        csTransactionBuilder.sign(0, offerEcpair, null, Bitcoin.Transaction.SIGHASH_ALL, utxoSats)
        // build tx
        let csTx = csTransactionBuilder.build()
        // output rawhex
        let csTxHex = csTx.toHex()

        console.log('csTxHex:', csTxHex)

        let sendRawTransaction = await bitbox.RawTransactions.sendRawTransaction(csTxHex);
        console.log('Completed contract broadcast', sendRawTransaction);
        // let sendRawTransaction = '90954cb64ef32525f7e78a12c8e6498dbfb625dc57cf8c01669f975eacb3ea18'

    // 8. Oracle broadcasts result
        console.log('Waiting 5 seconds before broadcasting oracle result...')
        await sleep(5000)
        // let oracleBfp = 'bitcoinfile:b3f4023cabcf8a5437bc84e736e6a24c50a7c1bb12089a5a17d4e9fd04340812'
        const oracleResultOb = {
            type:"result",
            data:{
                finalScore:{
                    awayTeam:112,
                    homeTeam:103
                }
            },
            contracts:{
                jeton:{
                    escrow:{
                        message:"NBA-20200222-SAC-LAC_SAC-WIN",
                        refereeSig:"304402202d435db55d497053e9b9fc7620985c99a8f7ff62d164446731473fddc1661baa02205f986222198947c0897aadc70982203a1ee6021a86aa9b0da57ca93e1a43fc8e"
                    }
                }
            }
        }
        const oracleResultJson = JSON.stringify(oracleResultOb)

        // const someFileBuffer = new Buffer.from('aabbccddeeff', 'hex');
        const oracleResultFileBuffer = new Buffer.from(oracleResultJson);
        const oracleResultFileName = 'NBA-20200222-SAC-LAC.result'
        const oracleResultFileExt = '.json'
        const oracleResultFileSize = oracleResultFileBuffer.length
        const oracleResultFileSha256Hex = bitbox.Crypto.sha256(oracleResultFileBuffer).toString('hex');

        // estimate upload cost for funding the transaction
        config = {
            msgType: 1,
            chunkCount: 0,
            fileName: oracleResultFileName,
            fileExt: oracleResultFileExt,
            fileSize: oracleResultFileSize,
            fileSha256Hex: oracleResultFileSha256Hex,
            prevFileSha256Hex: null,
            fileUri: null,
            chunkData: null  // chunk not needed for cost estimate stage
        };
        uploadCost = Bfp.calculateFileUploadCost(oracleResultFileSize, config);
        console.log('upload cost: ', uploadCost);

        // create a funding transaction
        let fundingAddress = oracleAddress
        let fundingWif = oracleWif

        // Get baton UTXO
        let oracleTxid = oracleBfp.replace('bitcoinfile:', '')
        oracleBatonTx = await bitbox.Transaction.details(oracleTxid)
        oracleBatonVout = oracleBatonTx.vout[1]
        oracleFundingUtxo = {
            txid: oracleTxid,
            vout: 1,
            amount: oracleBatonVout.value,
            satoshis: oracleBatonVout.value * 100000000,
            height: oracleBatonTx.blockheight,
            confirmations: oracleBatonTx.confirmations,
            scriptPubKey: oracleBatonVout.scriptPubKey.hex
        }
        
        console.log('got baton utxo of previous oracle signal')

        // wait for network to resolve...

        // upload the file
        let oracleResultFileId = await bfp.uploadFile(oracleFundingUtxo,
            oracleAddress,
            oracleWif,
            oracleResultFileBuffer,
            config.fileName,
            config.fileExt,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            3000);
        console.log('Oracle result Id: ', oracleResultFileId);
        console.log('Original oracle Id: ', oracleFileId)

    // 9. Winner collects funds
        // This can have issues if dealing with unconfirmed original oracle signals. In practice, results would not be chained unconfirmed.
        // Ping for results (this is an indexer bug)
        await sleep(2000)
        let oracleFinalResult;
        try {
            oracleFinalResult = await getOracleResult(oracleBfp)
        } catch (e) {
            console.error(e)
        }
        console.log('Waiting 60 seconds before attempting to collect winnings...')
        await sleep(60000)
        // let oracleBfp = 'bitcoinfile:b3f4023cabcf8a5437bc84e736e6a24c50a7c1bb12089a5a17d4e9fd04340812'
        // See if there are results
        oracleBfp = oracleFileId

        metadata = await bfp.bitdb.getFileMetadata(oracleBfp);
        // console.log('oracle signal metadata: ', metadata);
        result = await bfp.downloadFile(oracleBfp);
        console.log("oracle signal download complete.");
        // Wait for download to complete

        // result includes a boolean check telling you if the file's sha256 matches the file's metadata```
        if(result.passesHashCheck){
            console.log("Success: downloaded oracle signal file sha256 matches file's metadata");
        }

        // do something with the file...
        fileBuffer = result.fileBuf;
        oracleObj = JSON.parse(fileBuffer.toString('utf-8'))
        console.log('oracle json', fileBuffer.toString('utf-8'))

        // Check to see if baton is spent and there are results
        try {
            oracleFinalResult = await getOracleResult(oracleBfp)
        } catch (e) {
            console.error(e)
        }

        // Ping twice for results (this is an indexer bug)
        await sleep(2000)
        try {
            oracleFinalResult = await getOracleResult(oracleBfp)
        } catch (e) {
            console.error(e)
        }

        if (!oracleFinalResult)
            throw new Error('There needs to be a result before winnings can be collected')

        console.log('Got Oracle result. Constructing winning tx')

        let finalResultObj = JSON.parse(oracleFinalResult.toString('utf-8'))

        let winner = finalResultObj.data.finalScore.awayTeam > finalResultObj.data.finalScore.homeTeam ? 'awayTeam' : 'homeTeam'
        
        console.log('The winner is the message at index 0:', oracleObj.data[winner].name)
        console.log('The winner is the accepting party, who can now spend')

        // TODO: Somehow get the metadata from the swap:payment made by the acceptor
        let p2shAddress = jeton.Address.fromScript(jeton.Script.fromString(paymentMetadata.p2shScriptPubKey))
        let p2shAddressString = p2shAddress.toString()

        acceptUtxos = await network.getUtxos(p2shAddressString, false)
        // Hydrate for SLP
        acceptSlpUtxos = await bitbox.Utils.tokenUtxoDetails(acceptUtxos)
        // Filter out SLP UTXOs
        acceptUtxos = acceptUtxos.filter(function(utxo, index){
            if(!acceptSlpUtxos[index])
                return true
            return false
        })

        if(!acceptUtxos || acceptUtxos.length == 0) {
            throw new Error('There are no avaialble winning UTXOs to collect')
        }

        // Construct and sign tx using all UTXOS in address
        totalSats = 0
        for(let i = 0; i < acceptUtxos.length; i++) {
            let fullTx = await bitbox.Transaction.details(acceptUtxos[i].txid)
            let vout = fullTx.vout[acceptUtxos[i].vout]
            totalSats += acceptUtxos[i].satoshis
            acceptUtxos[i] = new Transaction.UnspentOutput({ 
                txid: acceptUtxos[i].txid,
                vout: acceptUtxos[i].vout,
                satoshis: acceptUtxos[i].satoshis,
                scriptPubKey: vout.scriptPubKey.hex 
            })
        }

        byteCount = bitbox.BitcoinCash.getByteCount({ P2PKH: acceptUtxos.length }, { P2PKH: 1 })
        byteCount += (subscriptBuf.byteLength + 110) * acceptUtxos.length

        let sighash = (Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID)
        let spendTx = new Transaction()
        for (i = 0; i < acceptUtxos.length; i++) {
            spendTx.from(acceptUtxos[i])
        }

        if(totalSats - byteCount < 546)
            throw new Error('You do not have enough sats available in '+acceptAddr+' to collect. You only have '+totalSats)

        spendTx.to(acceptAddr, totalSats - byteCount)

        let acceptPrivKey = jeton.PrivateKey.fromWIF(acceptWif)
        let winningMessage = finalResultObj.contracts[compilerId][compilerVersion].message
        let refereeSig = Signature.fromString(finalResultObj.contracts[compilerId][compilerVersion].refereeSig)
        for (i = 0; i < acceptUtxos.length; i++) {
            spendTx.signEscrow(i, acceptPrivKey, winningMessage, refereeSig, jeton.Script.fromBuffer(subscriptBuf), sighash)
        }

        // console.log(spendTx.toObject())
        console.log('estimated size of winning collection transaction', spendTx._estimateSize())
        console.log('verify tx full sig', spendTx.verify())
        console.log('jeton signature verified?', spendTx.verifyScriptSig(0))

        for (i = 0; i < acceptUtxos.length; i++) {
            if(!spendTx.verifyScriptSig(i))
                throw new Error('Signature at index '+i+' is invalid') 
        }

        try {
            let sendCollectTransaction = await bitbox.RawTransactions.sendRawTransaction(spendTx.toString());
            console.log('Winnings collected!', sendCollectTransaction);
        } catch(error) {
            console.error(error)
        }

    } catch (e) {
        console.error(e)
    }
})();