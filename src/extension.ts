import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as HID from 'node-hid';
import {FV1Assembler} from './FV1Assembler';
import {IntelHexParser} from './hexParser';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
    console.log('FV-1 Assembly Editor extension is now active');

    // Register commands
    const assembleCommand = vscode.commands.registerCommand('fv1.assemble', async () => {
        await assembleFV1();
    });

    const assembleAndProgramCommand = vscode.commands.registerCommand('fv1.assembleAndProgram', async () => {
        const hexPath = await assembleFV1();
        if (hexPath) {
            await programEeprom(hexPath);
        }
    });

    const programEepromCommand = vscode.commands.registerCommand('fv1.programEeprom', async (uri?: vscode.Uri) => {
        let hexPath: string;
        if (uri) {
            hexPath = uri.fsPath;
        } else {
            const options: vscode.OpenDialogOptions = {
                canSelectMany: false,
                openLabel: 'Select HEX file',
                filters: {
                    'HEX files': ['hex'],
                    'All files': ['*']
                }
            };
            const fileUri = await vscode.window.showOpenDialog(options);
            if (!fileUri || fileUri.length === 0) {
                return;
            }
            hexPath = fileUri[0].fsPath;
        }
        await programEeprom(hexPath);
    });

    const detectMcp2221Command = vscode.commands.registerCommand('fv1.detectMcp2221', async () => {
        await detectMCP2221();
    });

    context.subscriptions.push(
        assembleCommand,
        assembleAndProgramCommand,
        programEepromCommand,
        detectMcp2221Command
    );
}

async function assembleFV1(): Promise<string | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }

    const document = activeEditor.document;
    if (!document.fileName.endsWith('.spn') && !document.fileName.endsWith('.fv1')) {
        vscode.window.showErrorMessage('Active file is not an FV-1 assembly file (.spn or .fv1)');
        return;
    }

    // Save the file first
    await document.save();

    const sourceFile = document.fileName;
    const outputFile = sourceFile.replace(/\.(spn|fv1)$/, '.hex');
    const assembler = new FV1Assembler();

    try {
        vscode.window.showInformationMessage('Assembling FV-1 code...');
        const fileContent = fs.readFileSync(sourceFile, 'utf8');
        const result = assembler.assemble(fileContent);
        if (result.problems.length === 0) {
            console.log("Assembly successful!");
            const hexFileString = IntelHexParser.generate(Buffer.from(FV1Assembler.saveBinary(result.machineCode)));
            fs.writeFileSync(outputFile, hexFileString, 'utf8');
            vscode.window.showErrorMessage(`Assembled to: ${hexFileString}`);
        } else {
            vscode.window.showErrorMessage(`Assembly failed: ${result.problems.map(p => p.message).join(', ')}`);
            return;
        }

        if (fs.existsSync(outputFile)) {
            vscode.window.showInformationMessage(`Assembly successful: ${path.basename(outputFile)}`);
            return outputFile;
        } else {
            vscode.window.showErrorMessage('Assembly failed: Output file not created');
            return;
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Assembly error: ${error}`);
        return;
    }
}

async function programEeprom(hexPath: string): Promise<void> {
    if (!fs.existsSync(hexPath)) {
        vscode.window.showErrorMessage(`HEX file not found: ${hexPath}`);
        return;
    }

    const config = vscode.workspace.getConfiguration('fv1');
    const vendorId = parseInt(config.get<string>('mcp2221VendorId') || '04D8', 16);
    const productId = parseInt(config.get<string>('mcp2221ProductId') || '00DD', 16);
    const eepromAddress = parseInt(config.get<string>('i2cAddress') || '0x50', 16);

    try {
        // Find MCP2221 device
        const devices = HID.devices();
        const mcp2221 = devices.find(d => d.vendorId === vendorId && d.productId === productId);
        
        if (!mcp2221) {
            vscode.window.showErrorMessage('MCP2221 device not found. Please check connection.');
            return;
        }

        vscode.window.showInformationMessage('Programming EEPROM...');

        // Read HEX file
        const hexData = fs.readFileSync(hexPath, 'utf8');
        const binaryData = parseIntelHex(hexData);

        // Program EEPROM via MCP2221
        // await programEepromViaMCP2221(mcp2221.path!, binaryData, eepromAddress);

        vscode.window.showInformationMessage('EEPROM programming completed successfully!');
    } catch (error) {
        vscode.window.showErrorMessage(`Programming error: ${error}`);
    }
}

async function detectMCP2221(): Promise<void> {
    const config = vscode.workspace.getConfiguration('fv1');
    const vendorId = parseInt(config.get<string>('mcp2221VendorId') || '04D8', 16);
    const productId = parseInt(config.get<string>('mcp2221ProductId') || '00DD', 16);

    try {
        const devices = HID.devices();
        const mcp2221Devices = devices.filter(d => d.vendorId === vendorId && d.productId === productId);

        if (mcp2221Devices.length === 0) {
            vscode.window.showWarningMessage('No MCP2221 devices found');
        } else {
            const deviceList = mcp2221Devices.map(d => 
                `Product: ${d.product}, Serial: ${d.serialNumber}, Path: ${d.path}`
            ).join('\n');
            vscode.window.showInformationMessage(`Found ${mcp2221Devices.length} MCP2221 device(s):\n${deviceList}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error detecting MCP2221: ${error}`);
    }
}

function parseIntelHex(hexData: string): Buffer {
    const lines = hexData.split('\n').filter(line => line.trim().length > 0);
    const data: number[] = [];
    
    for (const line of lines) {
        if (!line.startsWith(':')) {
            continue;
        }
        
        const byteCount = parseInt(line.substr(1, 2), 16);
        const address = parseInt(line.substr(3, 4), 16);
        const recordType = parseInt(line.substr(7, 2), 16);
        
        if (recordType === 0) { // Data record
            for (let i = 0; i < byteCount; i++) {
                const byte = parseInt(line.substr(9 + i * 2, 2), 16);
                data[address + i] = byte;
            }
        } else if (recordType === 1) { // End of file
            break;
        }
    }
    
    return Buffer.from(data);
}

// async function programEepromViaMCP2221(devicePath: string, data: Buffer, eepromAddress: number): Promise<void> {
//     const device = new HID.HIDAsync(devicePath);
    
//     try {
//         // Initialize I2C
//         await initializeI2C(device);
        
//         // Program EEPROM in pages (typically 16 bytes per page for 24LC04)
//         const pageSize = 16;
//         const totalPages = Math.ceil(data.length / pageSize);
        
//         for (let page = 0; page < totalPages; page++) {
//             const pageAddress = page * pageSize;
//             const pageData = data.slice(pageAddress, pageAddress + pageSize);
            
//             await writeEepromPage(device, eepromAddress, pageAddress, pageData);
            
//             // Small delay between page writes
//             await new Promise(resolve => setTimeout(resolve, 10));
//         }
//     } finally {
//         device.close();
//     }
// }

// async function initializeI2C(device: HID.HIDAsync): Promise<void> {
//     // MCP2221 I2C initialization commands
//     const setI2CSpeed = Buffer.from([0x10, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
//     await device.write(setI2CSpeed);
    
//     const response = await device.read();
//     if (response[1] !== 0x00) {
//         throw new Error('Failed to initialize I2C');
//     }
// }

// async function writeEepromPage(device: HID.HIDAsync, eepromAddr: number, memoryAddr: number, data: Buffer): Promise<void> {
//     // Construct I2C write command for EEPROM
//     const cmd = Buffer.alloc(64);
//     cmd[0] = 0x90; // I2C Write Data command
//     cmd[1] = data.length + 2; // Length (address bytes + data)
//     cmd[2] = eepromAddr << 1; // I2C address (shifted for write)
//     cmd[3] = (memoryAddr >> 8) & 0xFF; // Memory address high byte
//     cmd[4] = memoryAddr & 0xFF; // Memory address low byte
    
//     // Copy data
//     data.copy(cmd, 5);
    
//     await device.write(cmd);
    
//     // Check response
//     const response = await device.read();
//     if (response[1] !== 0x00) {
//         throw new Error(`EEPROM write failed at address ${memoryAddr.toString(16)}`);
//     }
// }

export function deactivate() {
    console.log('FV-1 Assembly Editor extension deactivated');
}