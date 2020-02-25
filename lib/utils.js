class BfpUtils {

    static getPushDataOpcode(data) {
        let length = data.length

        if (length === 0)
            return [0x4c, 0x00]
        else if (length < 76)
            return length
        else if (length < 256)
            return [0x4c, length]
        else
            throw Error("Pushdata too large")
    }

    static int2FixedBuffer(amount, size) {
        let hex = amount.toString(16);
        hex = hex.padStart(size * 2, '0');
        if (hex.length % 2) hex = '0' + hex;
        return Buffer.from(hex, 'hex');
    }

    static encodeScript(script) {
        const bufferSize = script.reduce((acc, cur) => {
            if (Array.isArray(cur)) return acc + cur.length
            else return acc + 1
        }, 0)

        const buffer = Buffer.allocUnsafe(bufferSize)
        let offset = 0
        script.forEach((scriptItem) => {
            if (Array.isArray(scriptItem)) {
                scriptItem.forEach((item) => {
                    buffer.writeUInt8(item, offset)
                    offset += 1
                })
            } else {
                buffer.writeUInt8(scriptItem, offset)
                offset += 1
            }
        })

        return buffer
    }

    static convertToEncryptStruct(encbuf) {
        let offset = 0;
        let tagLength = 32;
        let pub;
        switch(encbuf[0]) {
          case 4:
            pub = encbuf.slice(0, 65);
            break;
          case 3:
          case 2:
            pub = encbuf.slice(0, 33);
            break;
          default:
            throw new Error('Invalid type: ' + encbuf[0]);
        }
          offset += pub.length;
      
        let c = encbuf.slice(offset, encbuf.length - tagLength);
        let ivbuf = c.slice(0, 128 / 8);
        let ctbuf = c.slice(128 / 8);
      
        let d = encbuf.slice(encbuf.length - tagLength, encbuf.length);
    
        return {
            iv: ivbuf,
            ephemPublicKey: pub,
            ciphertext: ctbuf,
            mac: d
        }
    }
}

module.exports = BfpUtils