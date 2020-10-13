const utils = require('./utils');
const Network = require('./network');
const Bitdb = require('./bitdbSwp');
const eccrypto = require("eccrypto-js");
const wif = require('wif')

// const BITBOXSDK = require('bitbox-sdk/lib/bitbox-sdk').default
//     , BITBOX = new BITBOXSDK()

let bchrpc = require('grpc-bchrpc-web');
const ReactNativeTransport = require("@improbable-eng/grpc-web-react-native-transport").ReactNativeTransport;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

class Swp {
    constructor(BITBOX, network = 'mainnet', grpcUrl=null) {
        this.BITBOX = BITBOX;
        this.networkstring = network;
        this.network = new Network(this.BITBOX, grpcUrl);
        this.bitdb = new Bitdb(network);
        if(grpcUrl)
            this.client = new bchrpc.GrpcClient(grpcUrl);
        else
            this.client = new bchrpc.GrpcClient();
        this.client.client.options.transport = ReactNativeTransport({withCredentials:false})
    }

    static get lokadIdHex() { return "53575000" } // <lokad_id_int = 'SWP\x00'>

    // exchange dataObj =
    // {
    //     tokenId: <string>,    
    //     buyOrSell: <string>, "BUY" or "SELL"
    //     rate: <int>, in sats
    //     reserve: <bool>, are reserves being proved
    //     exactUtxos: <bool>,
    //     minSatsToExchange: <int> minimum valid exchange amount
    // }

    // escrow dataObj =
    // {
    //     oracleBfp: <string>, transaction id of oracle bitcoinfile
    //     contractTermsIndex: <int>, index of the terms object in the "contracts" property of oracleBfp JSON
    //     contractPartyIndex: <int>, index of party being taken by user
    //     compilerId: <string>, compiler being used eg. "jeton" or "cashscript"
    //     compilerVersion: <string>, identifies ccontract being used by compiler
    //     pubKey: <string>, oracle's pubKey to be used to sign result
    //     appendedScriptPubKey: <string>, used for fee
    //     appendedSats: <int> fee amount
    // }

    async uploadSignal(msgType, // exchange = 1,  escrow = 2
                                fundingUtxo,                // object in form: { txid:'', satoshis:#, vout:# }
                                fundingAddress,             // string
                                fundingWif,                 // hex string?
                                dataObj,                    // object containing data
                                objectReceiverAddress=null,   // string
                                signProgressCallback=null, 
                                signFinishedCallback=null, 
                                uploadProgressCallback=null, 
                                uploadFinishedCallback=null,
                                useGrpc=true){

        let msgClass = 1 // Identifies Signal class

        // estimate cost
        // build empty meta data OpReturn
        let configEmptyMetaOpReturn = {
            msgClass: 1,
            msgType: msgType
        }

        if (msgType == 1) {
            configEmptyMetaOpReturn.buyOrSell = dataObj.buyOrSell
            configEmptyMetaOpReturn.tokenId = dataObj.tokenId
            configEmptyMetaOpReturn.rate = dataObj.rate
            configEmptyMetaOpReturn.reserve = dataObj.reserve ? 1 : 0
            configEmptyMetaOpReturn.exactUtxoTxId = dataObj.exactUtxoTxId ? dataObj.exactUtxoTxId : 0
            configEmptyMetaOpReturn.exactUtxoIndex = dataObj.exactUtxoIndex ? dataObj.exactUtxoIndex : 0
            configEmptyMetaOpReturn.minSatsToExchange = dataObj.minSatsToExchange ? dataObj.minSatsToExchange : 0
        } else if (msgType == 2) {
            configEmptyMetaOpReturn.oracleBfp = dataObj.oracleBfp
            configEmptyMetaOpReturn.terms = dataObj.terms
            configEmptyMetaOpReturn.contractPartyIndex = dataObj.contractPartyIndex
            configEmptyMetaOpReturn.compilerId = dataObj.compilerId
            configEmptyMetaOpReturn.compilerVersion = dataObj.compilerVersion
            configEmptyMetaOpReturn.pubKey = dataObj.pubKey
            configEmptyMetaOpReturn.exactUtxoTxId = dataObj.exactUtxoTxId ? dataObj.exactUtxoTxId : 0
            configEmptyMetaOpReturn.exactUtxoIndex = dataObj.exactUtxoIndex ? dataObj.exactUtxoIndex : 0
            configEmptyMetaOpReturn.appendedScriptPubKey = dataObj.appendedScriptPubKey ? dataObj.appendedScriptPubKey : null
            configEmptyMetaOpReturn.appendedSats = dataObj.appendedSats ? dataObj.appendedSats : 0
        } else if (msgType == 3) {
            configEmptyMetaOpReturn.campaignUri = dataObj.campaignUri ? dataObj.campaignUri : ''
            configEmptyMetaOpReturn.outputs = dataObj.outputs
        }

        //* ** building transaction
        let transactions = [];
        let txid = fundingUtxo.txid;
        let satoshis = fundingUtxo.satoshis;
        let vout = fundingUtxo.vout;

        let metaOpReturn = Swp.buildMetadataOpReturn(configEmptyMetaOpReturn);

        // Transform fundingUtxo into an array of UTXOs
        if(!Array.isArray(fundingUtxo)) {
            fundingUtxo = [{
                txid: fundingUtxo.txid,
                satoshis: fundingUtxo.satoshis,
                vout: fundingUtxo.vout
            }]
        }

        for(let i=0; i < fundingUtxo.length; i++) {
            fundingUtxo[i].wif = fundingWif
        }

        // build meta data transaction
        let configMetaTx = {
            bfpMetadataOpReturn: metaOpReturn,
            input_utxo: fundingUtxo,
            receiverAddress: objectReceiverAddress != null ? objectReceiverAddress : fundingAddress
        };
        let metaTx = this.buildMetadataTx(configMetaTx);
        transactions.push(metaTx);

        // sign progress
        if(signProgressCallback != null){
            signProgressCallback(100);
        }

        // progress : signing finished
        if(signFinishedCallback != null){
            signFinishedCallback();
        }
        
        //* ** sending transaction
        if(uploadProgressCallback != null){
            uploadProgressCallback(0);
        }
        console.log('transaction: ', transactions[0].toHex());
        var bfTxId
        if(useGrpc)
            bfTxId = await this.network.sendTxWithRetryGrpc(transactions[0].toHex());
        else
            bfTxId = await this.network.sendTxWithRetry(transactions[0].toHex());

        // progress
        if(uploadProgressCallback != null){
            uploadProgressCallback(100);
        }

        bfTxId = 'swap:' + bfTxId;
        if(uploadFinishedCallback != null){
            uploadFinishedCallback(bfTxId);
        }

        return bfTxId;
    }
    

    async uploadPayment(fundingUtxo,                    // object in form: { txid:'', satoshis:#, vout:# }
                            fundingAddress,             // string
                            fundingWif,                 // hex string?
                            fileDataArrayBuffer,        // ArrayBuffer
                            signalSha256Hex=null,       // hex string
                            receiverAddress=null,       // string
                            p2shScriptPubKey=null,      // Buffer
                            inputsOnly=false,           // Boolean (inputs bytes only, not full tx?)
                            signProgressCallback=null, 
                            signFinishedCallback=null, 
                            uploadProgressCallback=null, 
                            uploadFinishedCallback=null, 
                            delay_ms=1000,
                            useGrpc=true) {

        let fileSize = fileDataArrayBuffer.byteLength;
        
        // chunks
        let chunks = [];
        let chunkCount = Math.floor(fileSize / 220);

        for (let nId = 0; nId < chunkCount; nId++) {
            chunks.push(fileDataArrayBuffer.slice(nId * 220, (nId + 1) * 220));
        }

        // meta
        if (fileSize % 220) {
            chunks[chunkCount] = fileDataArrayBuffer.slice(chunkCount * 220, fileSize);
            chunkCount++;
        }

        // estimate cost
        // build empty meta data OpReturn
        // Message Type: 1 = exchange, 2 = collaborate (P2SH escrow), 3 = ANYONECANPAY input only
        let msgType = 1
        if(p2shScriptPubKey)
            msgType = 2
        else if (inputsOnly)
            msgType = 3

        let configEmptyMetaOpReturn = {
            msgClass: 2,
            msgType: msgType,
            fileSize: fileSize,
            chunkCount: chunkCount,
            signalSha256Hex: signalSha256Hex,
            p2shScriptPubKey: p2shScriptPubKey,
            chunkData: null
        };

        //* ** building transaction
        let transactions = [];

        // show progress
        let nDiff = 100 / chunkCount;
        let nCurPos = 0;

        for (let nId = 0; nId < chunkCount; nId++) {
            // build chunk data OpReturn
            let chunkOpReturn = Swp.buildDataChunkOpReturn(chunks[nId]);

            let txid = '';
            let satoshis = 0;
            let vout = 1;
            if (nId === 0) {
                if(!Array.isArray(fundingUtxo)) {
                    txid = fundingUtxo.txid;
                    satoshis = fundingUtxo.satoshis;
                    vout = fundingUtxo.vout;
                } else {
                    // Add the address and wif as properties to each utxo
                    for(let i=0; i < fundingUtxo.length; i++) {
                        fundingUtxo[i].address = fundingAddress
                        fundingUtxo[i].wif = fundingWif
                    }

                }
            } else {
                txid = transactions[nId - 1].getId();
                satoshis = transactions[nId - 1].outs[1].value;
            }

            // build chunk data transaction
            let configChunkTx = {
                bfpChunkOpReturn: chunkOpReturn,
                input_utxo: Array.isArray(fundingUtxo) && txid == '' ? fundingUtxo : {
                    address: fundingAddress,
                    txid: txid,
                    vout: vout,
                    satoshis: satoshis,
                    wif: fundingWif
                }
            };

            let chunksTx = this.buildChunkTx(configChunkTx);

            if (nId === chunkCount - 1) {
                let emptyOpReturn = Swp.buildMetadataOpReturn(configEmptyMetaOpReturn);
                let capacity = 223 - emptyOpReturn.length;
                if (capacity >= chunks[nId].byteLength) {
                    // finish with just a single metadata txn
                    // build meta data OpReturn
                    let configMetaOpReturn = {
                        msgClass: 2,
                        msgType: msgType,
                        fileSize: fileSize,
                        chunkCount: chunkCount,
                        signalSha256Hex: signalSha256Hex,
                        p2shScriptPubKey: p2shScriptPubKey,
                        chunkData: chunks[nId]
                    };
                    let metaOpReturn = Swp.buildMetadataOpReturn(configMetaOpReturn);

                    // build meta data transaction
                    let configMetaTx = {
                        bfpMetadataOpReturn: metaOpReturn,
                        input_utxo: Array.isArray(fundingUtxo) && txid == '' ? fundingUtxo : {
                            txid: txid,
                            vout: vout,
                            satoshis: satoshis,
                            wif: fundingWif
                        },
                        receiverAddress: receiverAddress != null ? receiverAddress : fundingAddress
                    };
                    let metaTx = this.buildMetadataTx(configMetaTx);
                    transactions.push(metaTx);
                } else {
                    // finish with both chunk txn and then final empty metadata txn
                    transactions.push(chunksTx);

                    let metaOpReturn = Swp.buildMetadataOpReturn(configEmptyMetaOpReturn);

                    // build meta data transaction
                    let configMetaTx = {
                        bfpMetadataOpReturn: metaOpReturn,
                        input_utxo: {
                            txid: chunksTx.getId(),
                            vout: vout,
                            satoshis: chunksTx.outs[1].value,
                            wif: fundingWif
                        },
                        receiverAddress: receiverAddress != null ? receiverAddress : fundingAddress
                    };
                    let metaTx = this.buildMetadataTx(configMetaTx);
                    transactions.push(metaTx);
                }
            } else { // not last transaction
                transactions.push(chunksTx);
            }

            // sign progress
            if(signProgressCallback != null){
                signProgressCallback(nCurPos)
            }
            nCurPos += nDiff;
        }

        // progress : signing finished
        if(signFinishedCallback != null){
            signFinishedCallback();
        }
        
        //* ** sending transaction
        nDiff = 100 / transactions.length;
        nCurPos = 0;
        if(uploadProgressCallback != null){
            uploadProgressCallback(0);
        }
        for (let nId = 0; nId < transactions.length; nId++) {
            console.log('transaction: ', transactions[nId].toHex());
            var bfTxId
            if(useGrpc)
                bfTxId = await this.network.sendTxWithRetryGrpc(transactions[nId].toHex());
            else
                bfTxId = await this.network.sendTxWithRetry(transactions[nId].toHex());
            // progress
            if(uploadProgressCallback != null){
                uploadProgressCallback(nCurPos);
            }
            nCurPos += nDiff;

            // delay between transactions
            await sleep(delay_ms);
        }

        bfTxId = 'swap:' + bfTxId;
        if(uploadFinishedCallback != null){
            uploadFinishedCallback(bfTxId);
        }

        return bfTxId;
    }

    async downloadTx(swapUri, decryptWif=null, progressCallback=null) {
        let chunks = [];
        let size = 0;

        let txid = swapUri.replace('swap:', '');


        let tx = await this.client.getTransaction({hash:txid, reversedHashOrder:true});
        let prevHash = Buffer.from(tx.getTransaction().getInputsList()[0].getOutpoint().getHash_asU8()).toString('hex');
        let metadata_opreturn_hex = Buffer.from(tx.getTransaction().getOutputsList()[0].getPubkeyScript_asU8()).toString('hex')
        let bfpMsg = this.parsebfpDataOpReturn(metadata_opreturn_hex);

        let downloadCount = bfpMsg.chunk_count;
        if(bfpMsg.chunk_count > 0 && bfpMsg.chunk != null) {
            downloadCount = bfpMsg.chunk_count - 1;
            chunks.push(bfpMsg.chunk)
            size += bfpMsg.chunk.length;
        }


        // Loop through raw transactions, parse out data
        for (let index = 0; index < downloadCount; index++) {

            // download prev txn
            let tx = await this.client.getTransaction({hash:prevHash});
            prevHash = Buffer.from(tx.getTransaction().getInputsList()[0].getOutpoint().getHash_asU8()).toString('hex');
            let op_return_hex = Buffer.from(tx.getTransaction().getOutputsList()[0].getPubkeyScript_asU8()).toString('hex');

            // parse vout 0 for data, push onto chunks array
            let bfpMsg = this.parsebfpDataOpReturn(op_return_hex);
            chunks.push(bfpMsg.chunk);
            size += bfpMsg.chunk.length;

            if(progressCallback != null) {
                progressCallback(index/(downloadCount-1));
            }
        }

        // reverse order of chunks
        chunks = chunks.reverse()
        let fileBuf = new Buffer.alloc(size);
        let index = 0;
        chunks.forEach(chunk => {
            chunk.copy(fileBuf, index)
            index += chunk.length;
        });

        // TODO: check that metadata hash matches if one was provided.
        let passesHashCheck = true
        /*
        if(bfpMsg.sha256 != null){
            let fileSha256 = this.BITBOX.Crypto.sha256(fileBuf);
            let res = Buffer.compare(fileSha256, bfpMsg.sha256);
            if(res === 0){
                passesHashCheck = true;
            }
        } */

        let subscriptBuf = null

        if(decryptWif) {
            let encStruct = utils.convertToEncryptStruct(fileBuf)
            let privKeyBuf = wif.decode(decryptWif).privateKey
            fileBuf = await eccrypto.decrypt(privKeyBuf, encStruct)
            // Decode subscript
            // if(bfpMsg.p2shScriptPubKey) {
            //     let subStruct = utils.convertToEncryptStruct(bfpMsg.p2shScriptPubKey)
            //     subscriptBuf = await eccrypto.decrypt(privKeyBuf, subStruct)
            // }
        }

        return { passesHashCheck, fileBuf, subscriptBuf };
    }

    static buildMetadataOpReturn(config) {

        let script = [];
        let re = /^[0-9a-fA-F]+$/;

        // OP Return Prefix
        script.push(0x6a);

        // Lokad Id
        let lokadId = Buffer.from(Swp.lokadIdHex, 'hex');
        script.push(utils.getPushDataOpcode(lokadId));
        lokadId.forEach((item) => script.push(item));

        // Message Class
        script.push(utils.getPushDataOpcode([config.msgClass]));
        script.push(config.msgClass);

        // Message Type
        script.push(utils.getPushDataOpcode([config.msgType]));
        script.push(config.msgType);

        if (config.msgClass == 1) {

            // Exchange
            if (config.msgType == 1) {

                // SLP Token ID (hash)
                if (config.tokenId == null || config.tokenId.length === 0 || config.tokenId == '') {
                    [0x4c, 0x00].forEach((item) => script.push(item));
                } else if (config.tokenId.length === 64 && re.test(config.tokenId)) {
                    let tokenIdBuf = Buffer.from(config.tokenId, 'hex');
                    script.push(utils.getPushDataOpcode(tokenIdBuf));
                    tokenIdBuf.forEach((item) => script.push(item));
                } else {
                    throw Error("Token Id must be provided as a 64 character hex string");
                }

                // BUY or SELL
                let validActions = ['BUY', 'SELL']
                let action = config.buyOrSell.toUpperCase()
                if (validActions.includes(action)) {
                    let buyOrSell = Buffer.from(action, 'utf8');
                    script.push(utils.getPushDataOpcode(buyOrSell));
                    buyOrSell.forEach((item) => script.push(item));
                } else {
                    throw Error('Action must be either BUY or SELL')
                }

                // Rate In Satoshis
                let rate = utils.int2FixedBuffer(config.rate, 1)
                script.push(utils.getPushDataOpcode(rate))
                rate.forEach((item) => script.push(item))

                // Proof of Reserves?
                let reserves = utils.int2FixedBuffer(config.reserve, 1)
                script.push(utils.getPushDataOpcode(reserves))
                reserves.forEach((item) => script.push(item))

                // Exact UTXOS
                if (config.exactUtxoTxId == null || config.exactUtxoTxId === 0 || config.exactUtxoTxId == '') {
                    [0x4c, 0x00].forEach((item) => script.push(item));
                } else if (config.exactUtxoTxId.length === 64 && re.test(config.exactUtxoTxId)) {
                    let utxoIdBuf = Buffer.from(config.exactUtxoTxId, 'hex');
                    script.push(utils.getPushDataOpcode(utxoIdBuf));
                    utxoIdBuf.forEach((item) => script.push(item));
                } else {
                    throw Error("UTXO Id must be provided as a 64 character hex string");
                }

                // Exact UTXO index
                let exactUtxoIndex = utils.int2FixedBuffer(config.exactUtxoIndex, 1)
                script.push(utils.getPushDataOpcode(exactUtxoIndex))
                exactUtxoIndex.forEach((item) => script.push(item))

                // Minimum exchange amount
                let minExchange = utils.int2FixedBuffer(config.minSatsToExchange, 1)
                script.push(utils.getPushDataOpcode(minExchange))
                minExchange.forEach((item) => script.push(item))

            // Escrow
            } else if (config.msgType == 2) {

                // Oracle BFP hash
                config.oracleBfp = config.oracleBfp.replace('bitcoinfile:', '')
                if (config.oracleBfp.length === 64 && re.test(config.oracleBfp)) {
                    let oracleBfpBuf = Buffer.from(config.oracleBfp, 'hex');
                    script.push(utils.getPushDataOpcode(oracleBfpBuf));
                    oracleBfpBuf.forEach((item) => script.push(item));
                } else {
                    throw Error("Oracle BFP hash must be provided as a 64 character hex string");
                }

                // Compiler ID
                let compiler = Buffer.from(config.compilerId, 'utf8');
                script.push(utils.getPushDataOpcode(compiler));
                compiler.forEach((item) => script.push(item));

                // Compiler contract version
                let compilerContract = Buffer.from(config.compilerVersion, 'utf8');
                script.push(utils.getPushDataOpcode(compilerContract));
                compilerContract.forEach((item) => script.push(item));

                // Contract party index
                let party = utils.int2FixedBuffer(config.contractPartyIndex, 1)
                script.push(utils.getPushDataOpcode(party))
                party.forEach((item) => script.push(item))

                // Offering party public key
                if (re.test(config.pubKey)) {
                    let oraclePubKey = Buffer.from(config.pubKey, 'hex');
                    script.push(utils.getPushDataOpcode(oraclePubKey));
                    oraclePubKey.forEach((item) => script.push(item));
                } else {
                    throw Error("Offering party public key must be a hex string");
                }

                // Exact UTXO
                if (config.exactUtxoTxId == null || config.exactUtxoTxId === 0 || config.exactUtxoTxId == '') {
                    [0x4c, 0x00].forEach((item) => script.push(item));
                } else if (config.exactUtxoTxId.length === 64 && re.test(config.exactUtxoTxId)) {
                    let utxoIdBuf = Buffer.from(config.exactUtxoTxId, 'hex');
                    script.push(utils.getPushDataOpcode(utxoIdBuf));
                    utxoIdBuf.forEach((item) => script.push(item));
                } else {
                    throw Error("UTXO Id must be provided as a 64 character hex string");
                }

                // Exact UTXO index
                let exactUtxoIndex = utils.int2FixedBuffer(config.exactUtxoIndex, 1)
                script.push(utils.getPushDataOpcode(exactUtxoIndex))
                exactUtxoIndex.forEach((item) => script.push(item))

                // Contract terms bytes
                if (re.test(config.terms)) {
                    let terms = Buffer.from(config.terms, 'hex');
                    script.push(utils.getPushDataOpcode(terms));
                    terms.forEach((item) => script.push(item));
                } else {
                    throw Error("The terms data must be a hex string");
                }

                // Appended scriptPubKey (for fee)
                if (config.appendedScriptPubKey == null || config.appendedScriptPubKey.length === 0 || config.appendedScriptPubKey == '') {
                    [0x4c, 0x00].forEach((item) => script.push(item));
                } else if (re.test(config.appendedScriptPubKey)) {
                    let appendedScriptPubKey = Buffer.from(config.appendedScriptPubKey, 'hex');
                    script.push(utils.getPushDataOpcode(appendedScriptPubKey));
                    appendedScriptPubKey.forEach((item) => script.push(item));
                } else {
                    throw Error("scriptPubKey must be a hex string");
                }

                // Appended sats (for fee)
                // Contract party index
                let appendedSats = utils.int2FixedBuffer(config.appendedSats, 1)
                script.push(utils.getPushDataOpcode(appendedSats))
                appendedSats.forEach((item) => script.push(item))

            // Crowdfund   
            } else if (config.msgType == 3) {

                // Campaign URI
                let campaignUri = Buffer.from(config.campaignUri, 'utf8');
                script.push(utils.getPushDataOpcode(campaignUri));
                campaignUri.forEach((item) => script.push(item));

                // Outputs bytes
                let outsBuf = config.outputs
                script.push(utils.getPushDataOpcode(outsBuf))
                outsBuf.forEach((item) => script.push(item))
            }
        }

        if (config.msgClass == 2) {
            // Chunk Count
            let chunkCount = utils.int2FixedBuffer(config.chunkCount, 1)
            script.push(utils.getPushDataOpcode(chunkCount))
            chunkCount.forEach((item) => script.push(item))

            // Signal Tx Hash
            if (config.signalSha256Hex == null || config.signalSha256Hex.length === 0 || config.signalSha256Hex == '') {
                [0x4c, 0x00].forEach((item) => script.push(item));
            } else if (config.signalSha256Hex.length === 64 && re.test(config.signalSha256Hex)) {
                let signalSha256Buf = Buffer.from(config.signalSha256Hex, 'hex');
                script.push(utils.getPushDataOpcode(signalSha256Buf));
                signalSha256Buf.forEach((item) => script.push(item));
            } else {
                throw Error("Offer tx hash must be provided as a 64 character hex string");
            }

            if (config.msgType == 2) {
                // Encrypted p2sh subscript
                let p2shScriptPubKey = Buffer.from(config.p2shScriptPubKey, 'hex');
                script.push(utils.getPushDataOpcode(p2shScriptPubKey));
                p2shScriptPubKey.forEach((item) => script.push(item));
            }

            // Chunk Data
            if (config.chunkData == null || config.chunkData.length === 0) {
                [0x4c, 0x00].forEach((item) => script.push(item));
            } else {
                let chunkData = Buffer.from(config.chunkData);
                script.push(utils.getPushDataOpcode(chunkData));
                chunkData.forEach((item) => script.push(item));
            }
        }

        //console.log('script: ', script);
        let encodedScript = utils.encodeScript(script);

        if (encodedScript.length > 223) {
            throw Error("Script too long, must be less than 223 bytes.")
        }

        return encodedScript;
    }

    static buildDataChunkOpReturn(chunkData) {
        let script = []

        // OP Return Prefix
        script.push(0x6a)

        // Chunk Data
        if (chunkData === undefined || chunkData === null || chunkData.length === 0) {
            [0x4c, 0x00].forEach((item) => script.push(item));
        } else {
            let chunkDataBuf = Buffer.from(chunkData);
            script.push(utils.getPushDataOpcode(chunkDataBuf));
            chunkDataBuf.forEach((item) => script.push(item));
        }

        let encodedScript = utils.encodeScript(script);
        if (encodedScript.length > 223) {
            throw Error("Script too long, must be less than 223 bytes.");
        }
        return encodedScript;
    }

    // We may not need this function since the web browser wallet will be receiving funds in a single txn.
    buildFundingTx(config) {
        // Example config:
        // let config = {
        //     outputAddress: this.bfpAddress,
        //     fundingAmountSatoshis: ____,
        //     input_utxos: [{
        //          txid: utxo.txid,
        //          vout: utxo.vout,
        //          satoshis: utxo.satoshis,
        //          wif: wif
        //     }]
        //   }

        let transactionBuilder;
        if(this.networkstring === 'mainnet')
            transactionBuilder = new this.BITBOX.TransactionBuilder('bitcoincash');
        else
            transactionBuilder = new this.BITBOX.TransactionBuilder('bchtest');

        let satoshis = 0;
        config.input_utxos.forEach(token_utxo => {
            transactionBuilder.addInput(token_utxo.txid, token_utxo.vout);
            satoshis += token_utxo.satoshis;
        });

        let fundingMinerFee = this.BITBOX.BitcoinCash.getByteCount({ P2PKH: config.input_utxos.length }, { P2PKH: 1 })
        let outputAmount = satoshis - fundingMinerFee;

        //assert config.fundingAmountSatoshis == outputAmount //TODO: Use JS syntax and throw on error

        // Output exact funding amount
        transactionBuilder.addOutput(config.outputAddress, outputAmount);

        // sign inputs
        let i = 0;
        for (const txo of config.input_utxos) {
            let paymentKeyPair = this.BITBOX.ECPair.fromWIF(txo.wif);
            transactionBuilder.sign(i, paymentKeyPair, null, transactionBuilder.hashTypes.SIGHASH_ALL, txo.satoshis);
            i++;
        }

        return transactionBuilder.build();
    }

    buildChunkTx(config) {
        // Example config: 
        // let config = {
        //     bfpChunkOpReturn: chunkOpReturn,
        //     input_utxo: {
        //          address: utxo.address??
        //          txid: utxo.txid,
        //          vout: utxo.vout,
        //          satoshis: utxo.satoshis,
        //          wif: wif
        //     }
        //   }

        let transactionBuilder
        if(this.networkstring === 'mainnet')
            transactionBuilder = new this.BITBOX.TransactionBuilder('bitcoincash');
        else
            transactionBuilder = new this.BITBOX.TransactionBuilder('bchtest');

        let inputSatoshis = 0;

        if (!Array.isArray(config.input_utxo) && config.input_utxo.txid)
            config.input_utxo = [config.input_utxo]
        
        for (let i=0; i < config.input_utxo.length; i++) {
            let utxo = config.input_utxo[i]
            transactionBuilder.addInput(utxo.txid, utxo.vout);
            inputSatoshis += utxo.satoshis;
        }

        let chunkTxFee = this.calculateDataChunkMinerFee(config.bfpChunkOpReturn.length, config.input_utxo.length);
        let outputAmount = inputSatoshis - chunkTxFee;

        // Chunk OpReturn
        transactionBuilder.addOutput(config.bfpChunkOpReturn, 0);

        // Genesis token mint
        transactionBuilder.addOutput(config.input_utxo[0].address, outputAmount);

        // sign inputs
        for (let i=0; i < config.input_utxo.length; i++) {
            let paymentKeyPair = this.BITBOX.ECPair.fromWIF(config.input_utxo[i].wif);
            transactionBuilder.sign(i, paymentKeyPair, null, transactionBuilder.hashTypes.SIGHASH_ALL, config.input_utxo[i].satoshis);
        }

        return transactionBuilder.build();
    }

    buildMetadataTx(config) {
        // Example config: 
        // let config = {
        //     bfpMetadataOpReturn: metadataOpReturn,
        //     input_utxo:
        //       {
        //         txid: previousChunkTxid,
        //         vout: 1,
        //         satoshis: previousChunkTxData.satoshis,
        //         wif: fundingWif 
        //       },
        //     receiverAddress: outputAddress
        //   }

        let transactionBuilder
        if(this.networkstring === 'mainnet')
            transactionBuilder = new this.BITBOX.TransactionBuilder('bitcoincash');
        else
            transactionBuilder = new this.BITBOX.TransactionBuilder('bchtest');

        let inputSatoshis = 0;

        if (!Array.isArray(config.input_utxo) && config.input_utxo.txid)
            config.input_utxo = [config.input_utxo]
        
        for (let i=0; i < config.input_utxo.length; i++) {
            let utxo = config.input_utxo[i]
            transactionBuilder.addInput(utxo.txid, utxo.vout);
            inputSatoshis += utxo.satoshis;
        }

        let metadataFee = this.calculateMetadataMinerFee(config.bfpMetadataOpReturn.length, config.input_utxo.length); //TODO: create method for calculating miner fee
        let output = inputSatoshis - metadataFee;

        // Metadata OpReturn
        transactionBuilder.addOutput(config.bfpMetadataOpReturn, 0);

        // outputs
        let outputAddress = this.BITBOX.Address.toCashAddress(config.receiverAddress);
        transactionBuilder.addOutput(outputAddress, output);

        // sign inputs
        for (let i=0; i < config.input_utxo.length; i++) {
            let paymentKeyPair = this.BITBOX.ECPair.fromWIF(config.input_utxo[i].wif);
            transactionBuilder.sign(i, paymentKeyPair, null, transactionBuilder.hashTypes.SIGHASH_ALL, config.input_utxo[i].satoshis);
        }

        return transactionBuilder.build();
    }

    calculateMetadataMinerFee(genesisOpReturnLength, inputs = 1, feeRate = 1) {
        let fee = this.BITBOX.BitcoinCash.getByteCount({ P2PKH: inputs }, { P2PKH: 1 })
        fee += genesisOpReturnLength
        fee += 10 // added to account for OP_RETURN ammount of 0000000000000000
        fee *= feeRate
        return fee
    }

    calculateDataChunkMinerFee(sendOpReturnLength, inputs = 1, feeRate = 1) {
        let fee = this.BITBOX.BitcoinCash.getByteCount({ P2PKH: inputs }, { P2PKH: 1 })
        fee += sendOpReturnLength
        fee += 10 // added to account for OP_RETURN ammount of 0000000000000000
        fee *= feeRate
        return fee
    }

    static calculateFileUploadCost(fileSizeBytes, configMetadataOpReturn, fee_rate = 1){
        let byte_count = fileSizeBytes;
        let whole_chunks_count = Math.floor(fileSizeBytes / 220);
        let last_chunk_size = fileSizeBytes % 220;

        configMetadataOpReturn.chunkCount = last_chunk_size > 0 ? whole_chunks_count + 1 : whole_chunks_count

        // cost of final transaction's op_return w/o any chunkdata
        let final_op_return_no_chunk = Swp.buildMetadataOpReturn(configMetadataOpReturn);
        byte_count += final_op_return_no_chunk.length;

        // cost of final transaction's input/outputs
        byte_count += 35;
        byte_count += 148 + 1;

        // cost of chunk trasnsaction op_returns
        byte_count += (whole_chunks_count + 1) * 3;

        if (!Swp.chunk_can_fit_in_final_opreturn(final_op_return_no_chunk.length, last_chunk_size))
        {
            // add fees for an extra chunk transaction input/output
            byte_count += 149 + 35;
            // opcode cost for chunk op_return
            byte_count += 16;
        }

        // output p2pkh
        byte_count += 35 * (whole_chunks_count);

        // dust input bytes (this is the initial payment for the file upload)
        byte_count += (148 + 1) * whole_chunks_count;

        // other unaccounted per txn
        byte_count += 22 * (whole_chunks_count + 1);

        // dust output to be passed along each txn
        let dust_amount = 546;

        return byte_count * fee_rate + dust_amount;
    }

    static chunk_can_fit_in_final_opreturn (script_length, chunk_data_length) {
        if (chunk_data_length === 0) {
            return true;
        }

        let op_return_capacity = 223 - script_length;
        if (op_return_capacity >= chunk_data_length) {
            return true;
        }

        return false;
    }

    // static getFileUploadPaymentInfoFromHdNode(masterHdNode) {
    //     let hdNode = this.BITBOX.HDNode.derivePath(masterHdNode, "m/44'/145'/1'");
    //     let node0 = this.BITBOX.HDNode.derivePath(hdNode, '0/0');
    //     let keyPair = this.BITBOX.HDNode.toKeyPair(node0);
    //     let wif = this.BITBOX.ECPair.toWIF(keyPair);
    //     let ecPair = this.BITBOX.ECPair.fromWIF(wif);
    //     let address = this.BITBOX.ECPair.toLegacyAddress(ecPair);
    //     let cashAddress = this.BITBOX.Address.toCashAddress(address);

    //     return {address: cashAddress, wif: wif};
    // }

    // getFileUploadPaymentInfoFromSeedPhrase(seedPhrase) {
    //     let phrase = seedPhrase;
    //     let seedBuffer = this.BITBOX.Mnemonic.toSeed(phrase);
    //     // create HDNode from seed buffer
    //     let hdNode = this.BITBOX.HDNode.fromSeed(seedBuffer);
    //     let hdNode2 = this.BITBOX.HDNode.derivePath(hdNode, "m/44'/145'/1'");
    //     let node0 = this.BITBOX.HDNode.derivePath(hdNode2, '0/0');
    //     let keyPair = this.BITBOX.HDNode.toKeyPair(node0);
    //     let wif = this.BITBOX.ECPair.toWIF(keyPair);
    //     let ecPair = this.BITBOX.ECPair.fromWIF(wif);
    //     let address = this.BITBOX.ECPair.toLegacyAddress(ecPair);
    //     let cashAddress = this.BITBOX.Address.toCashAddress(address);

    //     return {address: cashAddress, wif: wif};
    // }

    parsebfpDataOpReturn(hex) {
        const script = this.BITBOX.Script.toASM(Buffer.from(hex, 'hex')).split(' ');
        let bfpData = {}
        bfpData.type = 'metadata'

        if(script.length == 2) {
            bfpData.type = 'chunk';
            try {
                bfpData.chunk = Buffer.from(script[1], 'hex');
            } catch(e) {
                bfpData.chunk = null;
            }
            return bfpData;
        }

        if (script[0] != 'OP_RETURN') {
            throw new Error('Not an OP_RETURN');
        }

        if (script[1] !== Swp.lokadIdHex) {
            throw new Error('Not a SWaP OP_RETURN');
        }

        // 01 = On-chain File
        if (script[2] != 'OP_2') { // NOTE: bitcoincashlib-js converts hex 01 to OP_1 due to BIP62.3 enforcement
            throw new Error('Not a SWaP transaction (type 0x02)');
        }

        let chunkDataIndex = 6
        // Is escrow?
        if(script[3] == 'OP_2') {
            chunkDataIndex = 7
            bfpData.p2shScriptPubKey = Buffer.from(script[6], 'hex')
        }

        // chunk count
        bfpData.chunk_count = parseInt(script[3], 16);
        if(script[4].includes('OP_')){
            let val = script[4].replace('OP_', '');
            bfpData.chunk_count = parseInt(val);
        }

        // offer_tx_id
        if(script[5] == 'OP_0'){
            bfpData.sha256 = null
        } else {
            bfpData.sha256 = Buffer.from(script[5], 'hex');
        }

        // chunk_data
        if(script[chunkDataIndex] == 'OP_0'){
            bfpData.chunk = null
        } else {
            try {
                bfpData.chunk = Buffer.from(script[chunkDataIndex], 'hex');
            } catch(e) {
                bfpData.chunk = null
            }
        }

        return bfpData;
    }
}

module.exports = Swp;