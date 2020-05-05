# swap-bch-js

swap-bch-js is a JavaScript Library for building transactions for the [Signal, Watch, and Pay (SWaP) Protocol](https://github.com/vinarmani/swap-protocol/blob/master/swap-protocol-spec.md).  The library is a fork of [bitcoinfilesjs](https://github.com/simpleledger/BitcoinFilesJS) and also supports the Bitcoin Files Protocol (BFP). Methods for uploading and downloading files are provided [per the BFP specification](https://github.com/simpleledger/slp-specification/blob/master/bitcoinfiles.md).  For convenience, [SLP-SDK (Bitbox)](https://github.com/Bitcoin-com/slp-sdk) functionality has been built into the library.

# SWaP Protocol Reference

This library is reference code for the [Signal, Watch, and Pay (SWaP) Protocol](https://github.com/vinarmani/swap-protocol/blob/master/swap-protocol-spec.md). The [end-to-end examples](https://github.com/vinarmani/swap-bch-js/tree/master/examples) in this repository contain the full code necessary for the SWaP Signal and Payment message classes and types described in the protocol specification. Please reference these examples when building or testing your own applications.

# Installation

#### For node.js
`npm install swap-bch-js`

# Example Signal Downloads

```javascript

const SLPSDK = require('slp-sdk')
const bitbox = new SLPSDK({ restURL: 'https://rest.bitcoin.com/v2/' })
const swap = require('swap-bch-js')
const Swp = swap.swp;
const swp = new Swp(bitbox);
fs = require('fs');


let metadata;
(async function(){
    try {
        // Exchange
        let exchangeMetadata = await swp.bitdb.getSignalMetadata(1, "3bebd6590b0870e13a65fbb6a59e891ec06cd2f1c162f2b3c034d8b1e1ae88b9");
        console.log('exchange metadata: ', exchangeMetadata);

        let exchangeByTokenMetadata = await swp.bitdb.getSignalMetadata(1, null, "c4b0d62156b3fa5c8f3436079b5394f7edc1bef5dc1cd2f9d0c4d46f82cca479");
        console.log('exchange by token metadata: ', exchangeByTokenMetadata);

        // Escrow
        let escrowMetadata = await swp.bitdb.getSignalMetadata(2, "d7cbeaab6d02769464f9c71a6efd8cd2682d728d7e5de3ac278372b1b81c9d83");
        console.log('escrow metadata: ', escrowMetadata);

        let escrowByOracleMetadata = await swp.bitdb.getSignalMetadata(2, null, "974b3bf766b36434a21fe6f8782d8056f932d33ae401e92cf31a88204a21ea3e");
        console.log('escrow by oracle metadata: ', escrowByOracleMetadata);

        // Crowdfund
        let crowdfundMetadata = await swp.bitdb.getSignalMetadata(3, "565c84990aacfbd006d4ed2ee14bfb0f3bb27a84a6c9adcabccb6fb8e17e64c5");
        console.log('crowdfund metadata: ', crowdfundMetadata);
        console.log('outputs to crowdfund', crowdfundMetadata.outputs)

    } catch (e) {
        console.error(e)
    }

})();

```

# Example Exchange Offer Signal Upload
Full exchange end-to-end example in [examples directory](https://github.com/vinarmani/swap-bch-js/blob/master/examples/e2e_exchange.js)

```javascript
const SLPSDK = require('slp-sdk')
const bitbox = new SLPSDK({ restURL: 'https://rest.bitcoin.com/v2/' })
const swap = require('swap-bch-js')
const Swp = swap.swp;
const swp = new Swp(bitbox);
const network = swp.network;

(async function(){
    try {
        // 1 - Set the funding address and WIF

        let fundingWif = 'L3TS24MB1RhG3tcod2se7ik59WQRsUFkDiG8S2QNaPsapby7DmjR'
        let fundingEcpair = bitbox.ECPair.fromWIF(fundingWif)
        let fundingAddress = bitbox.ECPair.toCashAddress(fundingEcpair)
        
        let msgType = 1 // exchange

        // 3 - estimate upload cost for funding the transaction
        const fileSize = 0 // No file included in this tx
        let config = {
            tokenId: 'c4b0d62156b3fa5c8f3436079b5394f7edc1bef5dc1cd2f9d0c4d46f82cca479',
            buyOrSell: 'BUY',
            rate: 280000,
            reserve: false,
            exactUtxoTxId: '9a1a5be139ee12e487ea34e5ff62d90995946f876227be056d5d088a79a302ee', // txid of the UTXO to spend
            exactUtxoIndex: 1, // index (vout) of the UTXO you want to spend in the exchange
            minSatsToExchange: 140000
        }
        let uploadCost = Swp.calculateFileUploadCost(fileSize, config);
        console.log('upload cost: ', uploadCost);

        // 4 - Make sure address above is funded with the amount equal to the uploadCost

        let fundingUtxos = await network.getUtxos(fundingAddress, false);

        let availableSats = fundingUtxos.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.satoshis
        }, 0)
        
        console.log('got funding Utxos')
        console.log('available satoshis:', availableSats)

        if(availableSats < uploadCost)
            throw new Error('Insufficient funds in '+fundingAddress+' to send offer signal. Needed: '+uploadCost

        // wait for network to resolve...

        // 5 - upload the file
        let fileId = await swp.uploadSignal(msgType, fundingUtxos, fundingAddress, fundingWif, config);
        console.log('Offer Signal Id: ', fileId);
    
    } catch (e) {
        console.log(e)
    }
})();

// wait for upload to complete resolve... Done.

```

# Example Escrow Offer Signal Upload
Full escrow end-to-end example in [examples directory](https://github.com/vinarmani/swap-bch-js/blob/master/examples/e2e_escrow.js)

```javascript
const BITBOXSDK = require('bitbox-sdk')
const bitbox = new BITBOXSDK.BITBOX({ restURL: 'https://rest.bitcoin.com/v2/' });
const swap = require('swap-bch-js')
const Swp = swap.swp;
const swp = new Swp(bitbox);
const network = swp.network;

(async function(){
    try {
        // 1 - Set the funding address and WIF

        let fundingWif = 'L3TS24MB1RhG3tcod2se7ik59WQRsUFkDiG8S2QNaPsapby7DmjR'
        let fundingEcpair = bitbox.ECPair.fromWIF(fundingWif)
        let fundingAddress = bitbox.ECPair.toCashAddress(fundingEcpair)
        let msgType = 2 // escrow

        // 3 - estimate upload cost for funding the transaction
        const fileSize = 0 // No file included in this tx
        let config = {
            oracleBfp: 'ee10994d61ae1318d6298975283509e44eeace497d30765cf1c7bc48a7410d2f',
            contractTermsIndex: 0,
            contractPartyIndex: 1,
            compilerId: 'jeton',
            compilerVersion: 'e01',
            pubKey: '025d8a5fb65c9171946a17b791279862d85e7fe88ea194f85ff95de15388c7e666',
            exactUtxoTxId: '3bebd6590b0870e13a65fbb6a59e891ec06cd2f1c162f2b3c034d8b1e1ae88b9',
            exactUtxoIndex: 1,
            appendedScriptPubKey: '76a91410c1db6f3076e020974ef540199e7ae4b76fbafa88ac',
            appendedSats: 2000
        }
        let uploadCost = Swp.calculateFileUploadCost(fileSize, config);
        console.log('upload cost: ', uploadCost);

        // 4 - Make sure address above is funded with the amount equal to the uploadCost
        let fundingUtxos = await network.getUtxos(fundingAddress, false);

        let availableSats = fundingUtxos.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.satoshis
        }, 0)
        
        console.log('got funding Utxos')
        console.log('available satoshis:', availableSats)

        if(availableSats < uploadCost)
            throw new Error('Insufficient funds in '+fundingAddress+' to send offer signal. Needed: '+uploadCost)

        // wait for network to resolve...

        // 5 - upload the file
        let fileId = await swp.uploadSignal(msgType, fundingUtxos, fundingAddress, fundingWif, config);
        console.log('Offer Signal Id: ', fileId);
    } catch (e) {
        console.error(e)
    }
})();

// wait for upload to complete resolve... Done.

```

# Example Crowdfund Offer Signal Upload
Full threshold crowdfunding end-to-end example in [examples directory](https://github.com/vinarmani/swap-bch-js/blob/master/examples/e2e_cf.js)

```javascript
const SLPSDK = require('slp-sdk')
const bitbox = new SLPSDK({ restURL: 'https://rest.bitcoin.com/v2/' })
const swap = require('swap-bch-js')
const Swp = swap.swp;
const swp = new Swp(bitbox);
const network = swp.network;
const utils = swap.utils

function outputArrayToBuffer (outputObject) {
    let bufArray = []

}

(async function(){
    try {
        // 1 - Set the funding address and WIF

        let fundingWif = 'L3TS24MB1RhG3tcod2se7ik59WQRsUFkDiG8S2QNaPsapby7DmjR'
        let fundingEcpair = bitbox.ECPair.fromWIF(fundingWif)
        let fundingAddress = bitbox.ECPair.toCashAddress(fundingEcpair)
        let msgType = 3 // crowdfund

        let outputArray= [
            {
                script: Buffer.from('76a914da74026d67264c0acfede38e8302704ef7d8cfb288ac', 'hex'),
                value: 100000
            },
            {
                script: Buffer.from('76a914ac656e2dd5378ca9c45fd5cd44aa7da87c7bfa8288ac', 'hex'),
                value: 150000
            }
        ]

        let outputsBuf = utils.outputsArrayToBuffer(outputArray)

        // 3 - estimate upload cost for funding the transaction
        const fileSize = 0 // No file included in this tx
        let config = {
            msgClass: 1,
            msgType: msgType,
            campaignUri: 'https://swapcrowdfund.com/somecampaign',
            outputs: outputsBuf,
        }
        let uploadCost = Swp.calculateFileUploadCost(fileSize, config);
        console.log('upload cost: ', uploadCost);

        // 4 - Make sure address above is funded with the amount equal to the uploadCost

        let fundingUtxos = await network.getUtxos(fundingAddress, false);

        let availableSats = fundingUtxos.reduce(function (accumulator, currentValue) {
            return accumulator + currentValue.satoshis
        }, 0)
        
        console.log('got funding Utxos')
        console.log('available satoshis:', availableSats)

        if(availableSats < uploadCost)
            throw new Error('Insufficient funds in '+fundingAddress+' to send offer signal. Needed: '+uploadCost)

        // wait for network to resolve...

        // 5 - upload the file
        let fileId = await swp.uploadSignal(msgType, fundingUtxos, fundingAddress, fundingWif, config);
        console.log('fileId: ', fileId);
    } catch (e) {
        console.error(e)
    }
})();

// wait for upload to complete resolve... Done.
```