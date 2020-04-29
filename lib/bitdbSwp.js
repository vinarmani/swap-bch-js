const axios = require('axios');
const utils = require('./utils');

module.exports = class BfpBitdb {

    constructor(network) {
        // this.bitDbUrl = network === 'mainnet' ? 'https://bitdb.bitcoin.com/q/' : 'https://tbitdb.bitcoin.com/q/';
        this.bitDbUrl = network === 'mainnet' ? 'https://bitdb.bch.sx/q/' : 'https://tbitdb.bch.sx/q/';
        this.jqQueries = {
            signal: [
                { "f": "[ .[] | { timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), tokenId: .out[0].h4, buyOrSell: .out[0].s5, rate: .out[0].h6, reserves: .out[0].h7, exactUtxoTxId: .out[0].h8, exactUtxoIndex: .out[0].h9, minSatsToExchange: .out[0].h10, URI: \"swap:\\(.tx.h)\" } ]" }, // Signal/Exchange
                { "f": "[ .[] | { timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), oracleBfp: \"bitcoinfile:\\(.out[0].h4)\", contractTermsIndex: .out[0].h5, contractPartyIndex: .out[0].h6, compilerId: .out[0].s7, compilerVersion: .out[0].s8, pubKey: .out[0].h9, exactUtxoTxId: .out[0].h10, exactUtxoIndex: .out[0].h11, appendedScriptPubKey: .out[0].h12, appendedSats: .out[0].h13, URI: \"swap:\\(.tx.h)\" } ]" }, // Signal/Escrow
                { "f": "[ .[] | { timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), campaignUri: .out[0].s4, outputs: .out[0].h5, URI: \"swap:\\(.tx.h)\" } ]" }, // Signal/Crowdfund
            ],
            payment: [
                { "f": "[ .[] | { timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), signalId: .out[0].h5, totalChunks: .out[0].h4, URI: \"swap:\\(.tx.h)\" } ]" }, // Payment/Exchange
                { "f": "[ .[] | { timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), signalId: .out[0].h5, totalChunks: .out[0].h4, p2shScriptPubKey: .out[0].h6, URI: \"swap:\\(.tx.h)\" } ]" }, // Payment/Escrow
                { "f": "[ .[] | { timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), signalId: .out[0].h5, totalChunks: .out[0].h4, URI: \"swap:\\(.tx.h)\" } ]" }, // Payment/Crowdfund
            ]
        }
        this.qQuery = {
            "find": {
                "out.h1": "53575000"
            }
        }
    }

    async getSignalMetadata(msgType, txid=null, tokenOrOracleId=null, apiKey=null) {
        let jqQuery = this.jqQueries.signal[msgType-1]
        let qQuery = JSON.parse(JSON.stringify(this.qQuery))
        qQuery.find["out.h2"] = "01"
        qQuery.find["out.h3"] = utils.int2FixedBuffer(msgType, 1).toString('hex')
        if(txid)
            qQuery.find["tx.h"] = txid.replace('swap:', '')
        // If no txid, search by tokenId or OracleId
        else if(!txid && tokenOrOracleId) {
            qQuery.find["out.h4"] = tokenOrOracleId
        }

        let metadata = await this.getFileMetadata(qQuery, jqQuery, apiKey)

        for(let i = 0; i< metadata.length; i++) {
            metadata[i].timestamp = metadata[i].timestamp ? metadata[i].timestamp : 'unconfirmed'

            if(msgType == 1) {
                metadata[i].rate = parseInt(metadata[i].rate, 16)
                metadata[i].reserves = metadata[i].reserves == '01' ? true : false
                metadata[i].minSatsToExchange = parseInt(metadata[i].minSatsToExchange, 16)
                metadata[i].exactUtxoIndex = parseInt(metadata[i].exactUtxoIndex, 16)
            } else if (msgType == 2) {
                metadata[i].contractTermsIndex = parseInt(metadata[i].contractTermsIndex, 16),
                metadata[i].contractPartyIndex = parseInt(metadata[i].contractPartyIndex, 16)
                metadata[i].appendedSats = parseInt(metadata[i].appendedSats, 16)
                metadata[i].exactUtxoIndex = parseInt(metadata[i].exactUtxoIndex, 16)
            } else if (msgType == 3) {
                let outputsBuf = Buffer.from(metadata[i].outputs, 'hex')
                metadata[i].outputs = utils.outputsBufferToArray(outputsBuf)
            }
        }
        if(qQuery.find["tx.h"])
            return metadata[0]
        return metadata
    }

    async getPaymentMetadata(msgType, txid=null, signalId=null, apiKey=null) {
        let jqQuery = this.jqQueries.payment[msgType-1]
        let qQuery = JSON.parse(JSON.stringify(this.qQuery))
        qQuery.find["out.h2"] = "02"
        qQuery.find["out.h3"] = utils.int2FixedBuffer(msgType, 1).toString('hex')
        if(txid)
            qQuery.find["tx.h"] = txid.replace('swap:', '')
        // If no txid, search by tokenId or OracleId
        else if(!txid && signalId) {
            qQuery.find["out.h5"] = tokenOrOracleId
        }
        
        let metadata = await this.getFileMetadata(qQuery, jqQuery, apiKey)

        for(let i = 0; i< metadata.length; i++) {
            metadata[i].totalChunks = parseInt(metadata[i].totalChunks, 16)
        }

        if(qQuery.find["tx.h"])
            return metadata[0]
        return metadata
    }

    async getFileMetadata(qQuery, jqQuery=null, apiKey=null) {

        if(!jqQuery)
            jqQuery = { "f": "[ .[] | { timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), offer_txid: .out[0].h4, URI: \"swap:\\(.tx.h)\" } ]" }

        let query = {
            "v": 3,
            "q": qQuery,
            "r": jqQuery
          };

        // example response format:
        // { filename: 'tes158',
        //   fileext: '.json',
        //   size: '017a',
        //   sha256: '018321383bf2672befe28629d1e159af812260268a8aa77bbd4ec27489d65b58',
        //   prev_sha256: '',
        //   ext_uri: '' }

        const json_str = JSON.stringify(query);
        const data = Buffer.from(json_str).toString('base64');
        const response = (await axios({
            method: 'GET',
            url: this.bitDbUrl + data,
            headers: null,
            // {
            //     'key': apiKey,
            // },
            json: true,
        })).data;
    
        if(response.status === 'error'){
            throw new Error(response.message || 'API error message missing');
        }

        const list = [];
        // c = confirmed
        if(response.c){
            list.push(...response.c);
        }
        // u = unconfirmed
        if(response.u){
            list.push(...response.u);
        }
        if(list.length === 0){
            throw new Error('File not found');
        }
        // console.log('bitdb response: ', list[0]);
        return list
    }
}
