const varuint = require('varuint-bitcoin')
const reverse = require('buffer-reverse');

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

    static verifuint (value, max) {
        if (typeof value !== 'number') throw new Error('cannot write a non-number as a number')
        if (value < 0) throw new Error('specified a negative value for writing an unsigned value')
        if (value > max) throw new Error('RangeError: value out of range')
        if (Math.floor(value) !== value) throw new Error('value has a fractional component')
    }

    static outputsArrayToBuffer (outputsArray) {
        let txOuts = outputsArray

        let outBufLen = 220 + (32 * (txOuts.length - 1)) // Allow OP_RETURN
        let buffer = Buffer.alloc(outBufLen)

        var offset = 0

        function writeUInt64LE (buffer, value, offset) {
            BfpUtils.verifuint(value, 0x001fffffffffffff)

            buffer.writeInt32LE(value & -1, offset)
            buffer.writeUInt32LE(Math.floor(value / 0x100000000), offset + 4)
            return offset + 8
        }

        function writeSlice (slice) { offset += slice.copy(buffer, offset) }
        function writeUInt64 (i) { offset = writeUInt64LE(buffer, i, offset) }
        function writeVarInt (i) {
            varuint.encode(i, buffer, offset)
            offset += varuint.encode.bytes
        }
        function writeVarSlice (slice) { writeVarInt(slice.length); writeSlice(slice) }

        function trimEnd (buffer) {
            var pos = 0
            for (var i = buffer.length - 1; i >= 0; i--) {
                if (buffer[i] !== 0x00) {
                    pos = i
                    break
                }
            }
            return buffer.slice(0, pos + 1)
        }

        writeVarInt(txOuts.length)
        for (let i = 0; i < txOuts.length; i++) {
            let txOut = txOuts[i]
            writeUInt64(txOut.value)
            writeVarSlice(txOut.script)
        }

        buffer = trimEnd(buffer)
        return buffer
    }

    static inputsArrayToBuffer (inputsArray) {
        let txIns = inputsArray

        let inBufLen = 148 * (txIns.length + 1) // Allow some buffer
        let buffer = Buffer.alloc(inBufLen)

        var offset = 0

        function writeSlice (slice) { offset += slice.copy(buffer, offset) }
        function writeUInt32 (i) { offset = buffer.writeUInt32LE(i, offset) }
        function writeVarInt (i) {
            varuint.encode(i, buffer, offset)
            offset += varuint.encode.bytes
        }
        function writeVarSlice (slice) { writeVarInt(slice.length); writeSlice(slice) }

        function trimEnd (buffer) {
            var pos = 0
            for (var i = buffer.length - 1; i >= 0; i--) {
                if (buffer[i] !== 0x00) {
                    pos = i
                    break
                }
            }
            return buffer.slice(0, pos + 1)
        }

        writeVarInt(txIns.length)
        for (let i = 0; i < txIns.length; i++) {
            let txIn = txIns[i]
            writeSlice(reverse(txIn.txid))
            writeUInt32(txIn.vout)
            writeVarSlice(txIn.scriptSig)
            writeUInt32(txIn.sequence)
        }

        buffer = trimEnd(buffer)
        return buffer
    }


    static termsArrayToBuffer (termsDataArray) {
        let bufArray = []
        
        function writetoBufArray(termObj) {
            let buf
            switch (termObj.type) {
                case "uint32_t":
                    buf = Buffer.alloc(5)
                    buf.writeUInt8(4, 0)
                    buf.writeUInt32LE(termObj.value, 1)
                    return buf

                case "bytes":
                    buf = Buffer.alloc(1)
                    if (!termObj.value) {
                        buf.writeUInt8(0)
                        return buf
                    }
                    let valueBuf = Buffer.from(termObj.value, 'hex')
                    buf.writeUInt8(valueBuf.byteLength, 0)
                    return Buffer.concat([
                        buf,
                        valueBuf
                    ])

                default:
                    throw new Error ("Trying to write an unrecognized type to terms data: " + termObj.type)
            }
        }

        for (let i = 0; i < termsDataArray.length; i++) {
            let chunkBuf = writetoBufArray(termsDataArray[i])
            bufArray.push(chunkBuf)
        }
        return Buffer.concat(bufArray)
    }


    static outputsBufferToArray (outputsBuffer) {
        let buffer = outputsBuffer
        let offset = 0

        function readSlice (n) {
            offset += n
            return buffer.slice(offset - n, offset)
        }

        function readUInt64LE (buffer, offset) {
            let a = buffer.readUInt32LE(offset)
            let b = buffer.readUInt32LE(offset + 4)
            b *= 0x100000000

            BfpUtils.verifuint(b + a, 0x001fffffffffffff)

            return b + a
        }

        function readUInt64 () {
            let i = readUInt64LE(buffer, offset)
            offset += 8
            return i
        }

        function readVarInt () {
            let vi = varuint.decode(buffer, offset)
            offset += varuint.decode.bytes
            return vi
        }

        function readVarSlice () {
            return readSlice(readVarInt())
        }

        let numOuts = readVarInt()
        let outArray = []
        for (let i = 0; i < numOuts; i++) {
            outArray.push({
                value: readUInt64(),
                script: readVarSlice()
            })
        }

        return outArray
    }

    static inputsBufferToArray (inputsBuffer) {
        let buffer = inputsBuffer
        let offset = 0

        function readSlice (n) {
            offset += n
            return buffer.slice(offset - n, offset)
        }

        function readUInt32 () {
            let i = buffer.readUInt32LE(offset)
            offset += 4
            return i
        }

        function readVarInt () {
            let vi = varuint.decode(buffer, offset)
            offset += varuint.decode.bytes
            return vi
        }

        function readVarSlice () {
            return readSlice(readVarInt())
        }

        let numIns = readVarInt()
        let inArray = []
        for (let i = 0; i < numIns; i++) {
            inArray.push({
                txid: readSlice(32),
                vout: readUInt32(),
                scriptSig: readVarSlice(),
                sequence: readUInt32()
            })
        }

        return inArray
    }

    static termsBufferToArray (termsBuffer, termsTemplateArray) {
        let offset = 0
        
        function readBufSlice(index) {
            let len = termsBuffer.readUInt8(offset)
            offset += 1
            if (len == 0)
                return null
            let result
            switch (termsTemplateArray[index].type) {
                case "uint32_t":
                    if(len != 4)
                        throw new Error ("Incorrectly formatted length at index "+index+" . Expected 4 got " + len)
                    result = termsBuffer.readUInt32LE(offset)
                    break

                case "bytes":
                    if(len != 32 && len != 33)
                        throw new Error ("Incorrectly formatted length at index "+index+" . Expected 32 or 33 got " + len)
                    result = termsBuffer.slice(offset, len).toString('hex')
                    break

                default:
                    throw new Error ("Trying to write an unrecognized type to terms data: " + termsTemplateArray[index].type)
            }

            offset += len
            return result
        }

        for (let i = 0; i < termsTemplateArray.length; i++) {
            let chunkValue = readBufSlice(i)
            if(chunkValue && !termsTemplateArray[i].value)
                termsTemplateArray[i].value = chunkValue
        }
        return termsTemplateArray
    }
}

module.exports = BfpUtils