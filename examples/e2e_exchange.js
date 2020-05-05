const SLPSDK = require('slp-sdk')
const bitbox = new SLPSDK({ restURL: 'https://rest.bitcoin.com/v2/' })
const swap = require('../index.js')
const Swp = swap.swp;
const swp = new Swp(bitbox);
const network = swp.network;
const eccrypto = require('eccrypto-js');
const slpjs = require('slpjs')
// const slp = new slpjs.Slp(bitbox);
const BigNumber = require('bignumber.js');
const Bitcoin = require('bitcoincashjs-lib');
const collect = require('./e2e_collect.js')
const e2eConfig = require('./e2e.json');

(async function(){
    try {

        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

        // First run the collection and redistribution script
        await collect()

        // Choose the token you want to use in exchange for BCH
        let tokenId = '4de69e374a8ed21cbddd47f2338cc0f479dc58daa2bbe11cd604ca488eca0ddf' // Spice

    // 1. Set WIFs for the offering party and purchasing party

        let offerWif = e2eConfig.wifArray[0] // Offering the SLP tokens
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
        if(offerAvailableSats < 1000)
            throw new Error('You must put at least 1000 satoshis in address: '+offerAddr+' to begin')

        let acceptAddr = bitbox.ECPair.toCashAddress(acceptEcpair)
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
        if(acceptAvailableSats < 11000)
            throw new Error('You must put at least 11000 satoshis in address: '+acceptAddr+' to begin')

        console.log('UTXOs found. Creating Offer Signal...')

    // 2. Set token that will be sold by offering party (have token UTXOs available) and broadcast BUY (BCH) signal
        
        // Filter out only utxos for this tokenId
        let offerTokenUtxos = offerSlpUtxos.filter(function(utxo){
            if(utxo === false)
                return false
            return true
        })

        if(offerTokenUtxos.length == 0)
            throw new Error('You must have some tokens (preferably a single UTXO of 10 tokens) of id '+tokenId+' in the offerer address, '+bitbox.ECPair.toSLPAddress(offerEcpair))

        let availableTokens = offerTokenUtxos.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.tokenQty
        }, 0)

        console.log('Total available tokens to trade', availableTokens)

        let exchangeRate = 600 // Number of Satoshis to buy one unit of SLP token

        // Create signal config object
        let msgType = 1 // exchange

        // Offer the UTXO at the 0 index
        const fileSize = 0 // No file included in this tx
        let config = {
            tokenId: tokenId,
            buyOrSell: 'SELL', // SELLing the token at tokenId, which means offering SLP tokens for sale in exchange for BCH
            rate: exchangeRate,
            reserve: false,
            exactUtxoTxId: offerTokenUtxos[0].txid,
            exactUtxoIndex: offerTokenUtxos[0].vout,
            minSatsToExchange: 0
        }
        let uploadCost = Swp.calculateFileUploadCost(fileSize, config);
        console.log('Cost to Upload Signal: ', uploadCost);
        
        if(uploadCost > offerAvailableSats)
            throw new Error('Insufficient funds to send offer signal. Needed: '+offerAvailableSats+'. You have: '+uploadCost)

        let offerSignalId = await swp.uploadSignal(msgType, offerUtxos, offerAddr, offerWif, config);
        console.log('Offer Signal Id: ', offerSignalId);

    // 3. Purchasing party looks for signals, but we filter for the specific BUY signal just broadcast
        console.log('Waiting 2 seconds before searching for signal...')
        await sleep(2000)
        // First get metadata
        let offerMetadata;
        try {
            offerMetadata = await swp.bitdb.getSignalMetadata(1, offerSignalId);
            console.log('Offer signal found. Metadata: ', offerMetadata);
        } catch (e) {
            throw new Error('Offer signal at '+offerSignalId+' not found')
        }

/*        let offerMetadata = { 
            timestamp: 'unconfirmed',
            tokenId:
            '4de69e374a8ed21cbddd47f2338cc0f479dc58daa2bbe11cd604ca488eca0ddf',
            buyOrSell: 'SELL',
            rate: 600,
            reserves: false,
            exactUtxoTxId:
            '90dfb75fef5f07e384df4703b853a2741b8e6f3ef31ef8e5187a17fb107547f8',
            exactUtxoIndex: 1,
            minSatsToExchange: 0,
            URI:
            'swap:b03883ca0b106ea5e7113d6cbe46b9ec37ac6ba437214283de2d9cf2fbdc997f' 
        }
*/

    // 4. Purchasing party constructs payment tx and broadcasts
        // Find info about UTXO and figure out required output based on
        console.log('Grabbing offered UTXOs information...')
        let offeredTx = await bitbox.Transaction.details(offerMetadata.exactUtxoTxId)
        let offeredVout = offeredTx.vout[offerMetadata.exactUtxoIndex]
        let offeredUtxo = {
            txid: offeredTx.txid,
            vout: offerMetadata.exactUtxoIndex,
            amount: offeredVout.value,
            satoshis: offeredVout.value * 100000000,
            height: offeredTx.blockheight,
            confirmations: offeredTx.confirmations
        }
        let hydratedUtxos = await bitbox.Utils.tokenUtxoDetails([offeredUtxo])
        let hydratedUtxo = hydratedUtxos[0]
        if(hydratedUtxo.tokenId != offerMetadata.tokenId)
            throw new Error('UTXO referenced in offer is not of same tokenId as is referenced in offer')

        let satsRequiredToBuy = hydratedUtxo.tokenQty * offerMetadata.rate
        console.log('Will be exchanging '+satsRequiredToBuy+' satoshis for '+hydratedUtxo.tokenQty+' '+hydratedUtxo.tokenTicker)

        // Build SLP OP_Return
        let opReturnBuf = slpjs.Slp.buildSendOpReturn({
            tokenIdHex: hydratedUtxo.tokenId,
            outputQtyArray: [
                new BigNumber(hydratedUtxo.tokenQty).times(10**hydratedUtxo.decimals)
            ]
        })

        console.log('SLP opReturn byte length', opReturnBuf.byteLength)

        // Get byte count (minimum 2 inputs, 3 outputs)
        let opReturnBufLength = opReturnBuf.byteLength + 32 // add padding
        let byteCount = bitbox.BitcoinCash.getByteCount({ P2PKH: 2 }, { P2PKH: 3 }) + opReturnBufLength
        let satsNeeded = byteCount + satsRequiredToBuy // Total needed additional input sats

        // Sort acceptUtxos TODO: create better sorting mechainsm
        acceptUtxos.sort(function(a,b){
            return b.satoshis - a.satoshis
        })

        // Pull minimum utxos needed for tx starting with largest
        let paymentUtxos = []
        let paymentSatoshis = 0
        for (let i=acceptUtxos.length -1; i >= 0; i--){
            if (paymentSatoshis < satsNeeded) {
                paymentUtxos.push(acceptUtxos[i])
                paymentSatoshis += acceptUtxos[i].satoshis
                acceptUtxos.splice(i,1)
                // Recalculate byte count
                byteCount = bitbox.BitcoinCash.getByteCount({ P2PKH: (1 + paymentUtxos.length) }, { P2PKH: 3 }) + opReturnBufLength
                satsNeeded = byteCount + satsRequiredToBuy // Total needed additional input sats
            }
        }

        console.log('Total sats required to create valid transaction:', satsNeeded)
        if (acceptAvailableSats < satsNeeded)
            throw new Error('You must have at least '+satsNeeded+' satoshis in address: '+acceptAddr+' to create payment transaction')
        
        // Create transaction (use slpjs for SLP OP_RETURN creation and TransactionBuilder for tx)
        let transactionBuilder = new bitbox.TransactionBuilder('mainnet')
        // Add SLP input
        transactionBuilder.addInput(hydratedUtxo.txid, hydratedUtxo.vout)
        // Add BCH inputs
        for (let i=0; i < paymentUtxos.length; i++) {
            let utxo = paymentUtxos[i]
            transactionBuilder.addInput(utxo.txid, utxo.vout)
        }
        // Add SLP output
        transactionBuilder.addOutput(opReturnBuf, 0)
        // Send coins to acceptor address
        transactionBuilder.addOutput(acceptAddr, 546)
        // Send BCH to offering party
        transactionBuilder.addOutput( Buffer.from(offeredVout.scriptPubKey.hex, 'hex'), satsRequiredToBuy)
        // Calculate change
        let change = paymentSatoshis - satsNeeded
        transactionBuilder.addOutput(acceptAddr, change)
        // Sign BCH inputs (start at index #1)
        for (let i=0; i < paymentUtxos.length; i++) {
            let utxo = paymentUtxos[i]
            transactionBuilder.sign((i+1), acceptEcpair, null, transactionBuilder.hashTypes.SIGHASH_ALL, utxo.satoshis)
        }

        // build tx
        let tx = transactionBuilder.transaction.buildIncomplete()
        // output rawhex
        let txHash = tx.toHex()

        console.log('Half-signed transaction hex', txHash)

        // Broadcast Payment
        console.log('Constructing encrypted payment broadcast...')
        const paymentFileBuffer = new Buffer.from(txHash, 'hex');

        // Get public key from spent input
        let signalTxHash = offerMetadata.URI.replace('swap:', '')
        let swapTxDetails = await bitbox.Transaction.details(signalTxHash)
        let spentAsm = swapTxDetails.vin[0].scriptSig.asm
        let pubKey = spentAsm.split(' ')[1]

        // Encrypt message
        
        let pubKeyBuf = Buffer.from(pubKey, 'hex')
        let structuredEc = await eccrypto.encrypt(pubKeyBuf, paymentFileBuffer)
        let encryptedEc = Buffer.concat([structuredEc.ephemPublicKey, structuredEc.iv, structuredEc.ciphertext, structuredEc.mac])

        // 3 - estimate upload cost for funding the transaction
        const paymentfileSize = encryptedEc.byteLength
        let paymentConfig = {
            msgClass: 2,
            msgType: 1,
            fileSize: paymentfileSize,
            signalSha256Hex: signalTxHash,
            chunkData: null  // chunk not needed for cost estimate stage
        }
        console.log('paymentConfig', paymentConfig)
        let paymentUploadCost = Swp.calculateFileUploadCost(paymentfileSize, paymentConfig);
        console.log('Encoded payment upload cost: ', paymentUploadCost);

        acceptAvailableSats = acceptUtxos.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.satoshis
        }, 0)
        if(acceptAvailableSats < uploadCost)
            throw new Error('You must have an additional '+uploadCost+' satoshis in available UTXOS in address: '+acceptAddr+' to upload payment. You only have '+acceptAvailableSats)

        let recipientEcPair = bitbox.ECPair.fromPublicKey(pubKeyBuf)
        console.log('acceptUtxos', acceptUtxos)
        let paymentFileId = await swp.uploadPayment(acceptUtxos, acceptAddr, acceptWif, encryptedEc, paymentConfig.signalSha256Hex, bitbox.ECPair.toCashAddress(recipientEcPair));
        console.log('Payment file ID: ', paymentFileId);

        // 5. Offering party looks for payment and downloads it once found
        // First get metadata
        // let paymentFileId = 'swap:4887ef83e592f9fa86703f9ad5764e4842f19795a7818271c3446f207e0c553d' // Placeholder for testing
        let paymentMetadata = await swp.bitdb.getPaymentMetadata(1, paymentFileId);
        console.log('Exchange payment metadata:', paymentMetadata);

        // Tx is encrypted
        let paymentTx = await swp.downloadTx(paymentFileId, offerWif);
        console.log("Exchange payment tx download complete.", paymentTx.fileBuf.toString('hex'));

        let csTransaction = Bitcoin.Transaction.fromBuffer(paymentTx.fileBuf)
        let csTransactionBuilder = Bitcoin.TransactionBuilder.fromTransaction(csTransaction, 'mainnet')

        // console.log(csTransactionBuilder.tx.ins[1].script)
        // console.log(csTransactionBuilder.tx.outs)

        // 6. Offering party validates payment
        // Ensure offered input is unspent
        if (offeredVout.spentTxId)
            throw new Error('Offered UTXO has already been spent')
        // Ensure exchange amount is correct and is sent to correct address
        let amountPaid = 0
        for (let i = 0; i < csTransactionBuilder.tx.outs.length; i++) {
            let out = csTransactionBuilder.tx.outs[i]
            // If the output's destination is proper, make sure amount is correct
            if(out.script.toString('hex') == offeredVout.scriptPubKey.hex) {
                amountPaid += out.value
            }
        }

        if(amountPaid < satsRequiredToBuy)
            throw new Error('Invalid transaction. Insufficient funds paid.')

        // 7. If payment is valid, offering party countersigns and broadcasts
        csTransactionBuilder.sign(0, offerEcpair, null, Bitcoin.Transaction.SIGHASH_ALL, 546)
        // build tx
        let csTx = csTransactionBuilder.build()
        // output rawhex
        let csTxHex = csTx.toHex()

        console.log('csTxHex:', csTxHex)

        let sendRawTransaction = await bitbox.RawTransactions.sendRawTransaction(csTxHex);
        console.log('Final completed exchange tx:', sendRawTransaction);

    } catch (e) {
        console.log(e)
    }
})();