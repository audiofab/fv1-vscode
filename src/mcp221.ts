import * as HID from 'node-hid';

export class MCP2221 {
    private device: HID.HIDAsync | null = null;
    private isOpen: boolean = false;

    constructor(private devicePath: string) {}

    async open(): Promise<void> {
        if (this.isOpen) {
            return;
        }
        
        this.device = await HID.HIDAsync.open(this.devicePath);
        this.isOpen = true;
        
        // Reset and initialize the device
        await this.reset();
        await this.setI2CSpeed(100000); // 100kHz
    }

    async close(): Promise<void> {
        if (!this.isOpen) {
            return;
        }
        
        this.device.close();
        this.isOpen = false;
    }

    async reset(): Promise<void> {
        const cmd = Buffer.alloc(64);
        cmd[0] = 0x70; // Reset command
        await this.device.write(cmd);
        
        // Wait for reset to complete
        await this.delay(100);
    }

    async setI2CSpeed(speedHz: number): Promise<void> {
        const cmd = Buffer.alloc(64);
        cmd[0] = 0x10; // Set parameters command
        cmd[1] = 0x00; // Don't alter chip settings
        cmd[2] = 0x00; // Don't alter GP settings  
        cmd[3] = 0x20; // Alter I2C settings
        
        // Calculate divider for I2C speed
        // MCP2221 uses 12MHz base clock
        const divider = Math.round(12000000 / speedHz) - 3;
        cmd[4] = divider & 0xFF;
        
        await this.device.write(cmd);
        
        const response = await this.device.read();
        if (response[1] !== 0x00) {
            throw new Error(`Failed to set I2C speed: ${response[1]}`);
        }
    }

    async i2cWrite(address: number, data: Buffer): Promise<void> {
        if (data.length > 60) {
            throw new Error('Data too long for single I2C write');
        }

        const cmd = Buffer.alloc(64);
        cmd[0] = 0x90; // I2C Write Data command
        cmd[1] = data.length; // Length of data
        cmd[2] = address << 1; // I2C address (shifted left for write bit)
        
        // Copy data to command buffer
        data.copy(cmd, 3);
        
        await this.device.write(cmd);
        
        // Wait for completion
        let attempts = 0;
        while (attempts < 100) {
            const status = await this.getI2CStatus();
            if (status.complete) {
                if (status.error) {
                    throw new Error(`I2C write failed: ${status.errorCode}`);
                }
                return;
            }
            await this.delay(1);
            attempts++;
        }
        
        throw new Error('I2C write timeout');
    }

    async i2cRead(address: number, length: number): Promise<Buffer> {
        if (length > 60) {
            throw new Error('Read length too long for single I2C read');
        }

        const cmd = Buffer.alloc(64);
        cmd[0] = 0x91; // I2C Read Data command
        cmd[1] = length; // Length to read
        cmd[2] = (address << 1) | 1; // I2C address with read bit
        
        await this.device.write(cmd);
        
        // Wait for completion
        let attempts = 0;
        while (attempts < 100) {
            const status = await this.getI2CStatus();
            if (status.complete) {
                if (status.error) {
                    throw new Error(`I2C read failed: ${status.errorCode}`);
                }
                
                // Get the read data
                const dataCmd = Buffer.alloc(64);
                dataCmd[0] = 0x40; // Get I2C data command
                await this.device.write(dataCmd);
                
                const response = await this.device.read();
                if (response[1] === 0x00) {
                    return response.slice(4, 4 + response[3]);
                } else {
                    throw new Error('Failed to retrieve I2C read data');
                }
            }
            await this.delay(1);
            attempts++;
        }
        
        throw new Error('I2C read timeout');
    }

    async writeEepromPage(eepromAddress: number, memoryAddress: number, data: Buffer): Promise<void> {
        // EEPROM page write: send memory address followed by data
        const writeData = Buffer.alloc(2 + data.length);
        writeData[0] = (memoryAddress >> 8) & 0xFF; // High byte of memory address
        writeData[1] = memoryAddress & 0xFF; // Low byte of memory address
        data.copy(writeData, 2);
        
        await this.i2cWrite(eepromAddress, writeData);
        
        // Wait for EEPROM write cycle to complete (typically 5ms)
        await this.delay(10);
    }

    async readEeprom(eepromAddress: number, memoryAddress: number, length: number): Promise<Buffer> {
        // First, write the memory address
        const addrBuffer = Buffer.alloc(2);
        addrBuffer[0] = (memoryAddress >> 8) & 0xFF;
        addrBuffer[1] = memoryAddress & 0xFF;
        
        await this.i2cWrite(eepromAddress, addrBuffer);
        
        // Then read the data
        return await this.i2cRead(eepromAddress, length);
    }

    private async getI2CStatus(): Promise<{complete: boolean, error: boolean, errorCode: number}> {
        const cmd = Buffer.alloc(64);
        cmd[0] = 0x10; // Status/Set Parameters command
        cmd[1] = 0x00; // Don't change settings, just get status

        await this.device.write(cmd);
        const response = await this.device.read();
        
        const status = response[8]; // I2C state machine status
        const complete = (status & 0x80) === 0; // Bit 7 = 0 means complete
        const error = response[2] !== 0x00; // I2C error status
        
        return {
            complete,
            error,
            errorCode: response[2]
        };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export async function findMCP2221Devices(vendorId: number = 0x04D8, productId: number = 0x00DD): Promise<HID.Device[]> {
    const devices = HID.devices();
    return devices.filter(d => d.vendorId === vendorId && d.productId === productId);
}

export class EepromProgrammer {
    private mcp2221: MCP2221;

    constructor(devicePath: string) {
        this.mcp2221 = new MCP2221(devicePath);
    }

    async connect(): Promise<void> {
        await this.mcp2221.open();
    }

    async disconnect(): Promise<void> {
        await this.mcp2221.close();
    }

    async programEeprom(eepromAddress: number, data: Buffer, pageSize: number = 16): Promise<void> {
        const totalPages = Math.ceil(data.length / pageSize);
        
        for (let page = 0; page < totalPages; page++) {
            const pageAddress = page * pageSize;
            const pageEnd = Math.min(pageAddress + pageSize, data.length);
            const pageData = data.slice(pageAddress, pageEnd);
            
            await this.mcp2221.writeEepromPage(eepromAddress, pageAddress, pageData);
            
            // Progress callback could be added here
            if (page % 10 === 0) {
                console.log(`Programming progress: ${Math.round((page / totalPages) * 100)}%`);
            }
        }
    }

    async verifyEeprom(eepromAddress: number, expectedData: Buffer): Promise<boolean> {
        const readData = await this.mcp2221.readEeprom(eepromAddress, 0, expectedData.length);
        return expectedData.equals(readData);
    }

    async eraseEeprom(eepromAddress: number, size: number): Promise<void> {
        const eraseData = Buffer.alloc(Math.min(size, 16), 0xFF);
        const pages = Math.ceil(size / 16);
        
        for (let page = 0; page < pages; page++) {
            const pageAddress = page * 16;
            const pageSize = Math.min(16, size - pageAddress);
            const pageData = eraseData.slice(0, pageSize);
            
            await this.mcp2221.writeEepromPage(eepromAddress, pageAddress, pageData);
        }
    }
}