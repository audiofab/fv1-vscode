export interface HexRecord {
    address: number;
    data: Buffer;
    type: number;
}

export class IntelHexParser {
    static parse(hexContent: string): Buffer {
        const lines = hexContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const dataMap = new Map<number, number>();
        let maxAddress = 0;
        let baseAddress = 0;

        for (const line of lines) {
            if (!line.startsWith(':')) {
                continue;
            }

            const record = this.parseRecord(line);
            
            switch (record.type) {
                case 0x00: // Data record
                    const address = baseAddress + record.address;
                    for (let i = 0; i < record.data.length; i++) {
                        dataMap.set(address + i, record.data[i]);
                        maxAddress = Math.max(maxAddress, address + i);
                    }
                    break;
                    
                case 0x01: // End of file record
                    // End of file, stop processing
                    break;
                    
                case 0x02: // Extended segment address record
                    baseAddress = (record.data.readUInt16BE(0) << 4);
                    break;
                    
                case 0x04: // Extended linear address record
                    baseAddress = (record.data.readUInt16BE(0) << 16);
                    break;
                    
                case 0x05: // Start linear address record
                    // Ignore for our purposes
                    break;
                    
                default:
                    throw new Error(`Unsupported record type: 0x${record.type.toString(16).padStart(2, '0')}`);
            }
        }

        // Create buffer and fill with data
        const buffer = Buffer.alloc(maxAddress + 1, 0xFF); // Fill with 0xFF (erased EEPROM state)
        
        for (const [address, value] of dataMap.entries()) {
            buffer[address] = value;
        }

        return buffer;
    }

    private static parseRecord(line: string): HexRecord {
        if (!line.startsWith(':') || line.length < 11) {
            throw new Error(`Invalid hex record: ${line}`);
        }

        const byteCount = parseInt(line.substr(1, 2), 16);
        const address = parseInt(line.substr(3, 4), 16);
        const recordType = parseInt(line.substr(7, 2), 16);
        
        if (line.length < 11 + (byteCount * 2)) {
            throw new Error(`Hex record too short: ${line}`);
        }

        const data = Buffer.alloc(byteCount);
        for (let i = 0; i < byteCount; i++) {
            data[i] = parseInt(line.substr(9 + i * 2, 2), 16);
        }

        const checksum = parseInt(line.substr(9 + byteCount * 2, 2), 16);
        
        // Verify checksum
        let calculatedChecksum = byteCount + (address >> 8) + (address & 0xFF) + recordType;
        for (let i = 0; i < byteCount; i++) {
            calculatedChecksum += data[i];
        }
        calculatedChecksum = (256 - (calculatedChecksum & 0xFF)) & 0xFF;
        
        if (calculatedChecksum !== checksum) {
            throw new Error(`Checksum mismatch in hex record: ${line}`);
        }

        return {
            address,
            data,
            type: recordType
        };
    }

    static generate(data: Buffer, baseAddress: number = 0): string {
        const lines: string[] = [];
        const recordSize = 16; // 16 bytes per record
        
        for (let i = 0; i < data.length; i += recordSize) {
            const recordLength = Math.min(recordSize, data.length - i);
            const address = baseAddress + i;
            const recordData = data.slice(i, i + recordLength);
            
            let checksum = recordLength + (address >> 8) + (address & 0xFF) + 0x00; // 0x00 = data record
            for (let j = 0; j < recordLength; j++) {
                checksum += recordData[j];
            }
            checksum = (256 - (checksum & 0xFF)) & 0xFF;
            
            const record = [
                ':',
                recordLength.toString(16).padStart(2, '0').toUpperCase(),
                address.toString(16).padStart(4, '0').toUpperCase(),
                '00', // Data record type
                recordData.toString('hex').toUpperCase(),
                checksum.toString(16).padStart(2, '0').toUpperCase()
            ].join('');
            
            lines.push(record);
        }
        
        // Add end of file record
        lines.push(':00000001FF');
        
        return lines.join('\n');
    }

    static validateHex(hexContent: string): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        const lines = hexContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        let foundEndRecord = false;
        
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            
            if (!line.startsWith(':')) {
                errors.push(`Line ${lineNum + 1}: Record must start with ':'`);
                continue;
            }
            
            if (line.length < 11) {
                errors.push(`Line ${lineNum + 1}: Record too short`);
                continue;
            }
            
            try {
                const record = this.parseRecord(line);
                if (record.type === 0x01) {
                    foundEndRecord = true;
                }
            } catch (error) {
                errors.push(`Line ${lineNum + 1}: ${error}`);
            }
        }
        
        if (!foundEndRecord) {
            errors.push('Missing end of file record');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
}