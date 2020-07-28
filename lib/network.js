//const BITBOXSDK = require('bitbox-sdk/lib/bitbox-sdk').default
let bchrpc = require('grpc-bchrpc-web');
const ReactNativeTransport = require("@improbable-eng/grpc-web-react-native-transport").ReactNativeTransport;


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

class BfpNetwork {
    constructor(BITBOX, grpcUrl="https://bchd.greyh.at:8335") {
        this.BITBOX = BITBOX;
        this.stopPayMonitor = false;
        this.isMonitoringPayment = false;
        if(grpcUrl)
            this.client = new bchrpc.GrpcClient(grpcUrl)
        else
            this.client = new bchrpc.GrpcClient()
        this.client.client.options.transport = ReactNativeTransport({withCredentials:false})
    }

    async getLastUtxoWithRetry(address, retries = 40) {
		let result;
        let count = 0;
		while(result == undefined){
            result = await this.getLastUtxo(address)
			count++;
			if(count > retries)
				throw new Error("BITBOX.Address.utxo endpoint experienced a problem");
			await sleep(250);
		}
		return result;
    }

    async isSwapTx(txDetails) {
        let scriptArr = txDetails.vout[0].scriptPubKey.asm.split(' ')
        if (scriptArr[0] == 'OP_RETURN' && (scriptArr[1] == '5265235' || scriptArr[1] == '5260866'))
            return true
        return false
    }

    async getTransactionDetailsWithRetry(txid, retries = 40){
        let result;
        let count = 0;
        while(result == undefined){
            result = await this.BITBOX.Transaction.details(txid);
            count++;
            if(count > retries)
                throw new Error("BITBOX.Address.details endpoint experienced a problem");

            await sleep(250);
        }
        return result; 
    }

    async getLastUtxo(address) {
        let res = await this.getUtxos(address)
        return res[0];
    }

    async getUtxos(address, excludeSwap = false) {
        let utxos = []
        // If array of addresses, loop through and put all Utxos into a single array
        if(Array.isArray(address)) {
            for (let i =0; i < address.length; i++) {
                let utxosForAddr = await this.getUtxos(address[i], excludeSwap)
                utxos = utxos.concat(utxosForAddr)
            }
            return utxos
        }
        // must be a cash or legacy addr
        if(!this.BITBOX.Address.isCashAddress(address) && !this.BITBOX.Address.isLegacyAddress(address))
            throw new Error("Not an a valid address format, must be cashAddr or Legacy address format.");
        let res = (await this.BITBOX.Address.utxo([ address ]))[0];
        if(res && res.utxos && res.utxos.length > 0)
            utxos = res.utxos
        else if (res.utxos && res.utxos.length == 0)
            return utxos
        else
            utxos = [res]
        if (excludeSwap) {
            let filteredUtxos = []
            let txids = utxos.map(utxo => utxo.txid)
            let txDetails = await this.getTransactionDetailsWithRetry(txids)
            for (let i=0; i < utxos.length; i++) {
                let isSwap = await this.isSwapTx(txDetails[i])
                if(!isSwap)
                    filteredUtxos.push(utxos[i])
            }
            utxos = filteredUtxos
        }
        return utxos
    }

    async sendTx(hex, log=true) {
        let res = await this.BITBOX.RawTransactions.sendRawTransaction(hex);
        if(res && res.error)
            return undefined;
        if(res === "64: too-long-mempool-chain")
            throw new Error("Mempool chain too long");
        if(log)
            console.log('sendTx() res: ', res);
        return res;
    }

    async sendTxWithRetry(hex, retries = 40) {
        let res;
        let count = 0;
        while(res === undefined || res.length != 64) {
            res = await this.sendTx(hex);
            count++;
            if(count > retries)
                break;
            await sleep(250);
        }

        if(res.length != 64)
            throw new Error("BITBOX network error");
        
        return res;
    }

    async monitorForPayment(paymentAddress, fee, onPaymentCB) {
        if(this.isMonitoringPayment || this.stopPayMonitor)
            return;

        this.isMonitoringPayment = true;

        // must be a cash or legacy addr
        if(!this.BITBOX.Address.isCashAddress(paymentAddress) && !this.BITBOX.Address.isLegacyAddress(paymentAddress))
            throw new Error("Not an a valid address format, must be cashAddr or Legacy address format.");

        while (true) {
            try {
                var utxo = await this.getLastUtxo(paymentAddress);
                if (utxo && utxo && utxo.satoshis >= fee && utxo.confirmations === 0) {
                    break;
                }
            } catch (ex) {
                console.log('monitorForPayment() error: ', ex);
            }

            if(this.stopPayMonitor) {
                this.isMonitoringPayment = false;
                return;
            }

            await sleep(2000);
        }

        this.isMonitoringPayment = false;
        onPaymentCB(utxo);
    }
}

module.exports = BfpNetwork;