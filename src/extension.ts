import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import HID from 'node-hid';
import { MCP2221 } from '@johntalton/mcp2221'
import { I2CBusMCP2221 } from '@johntalton/i2c-bus-mcp2221'
import { I2CAddressedBus } from '@johntalton/and-other-delights'
import { EEPROM, DEFAULT_EEPROM_ADDRESS } from '@johntalton/eeprom'
import { NodeHIDStreamSource } from './node-hid-stream.js';
import {FV1Assembler, FV1AssemblerResult} from './FV1Assembler.js';
import {IntelHexParser} from './hexParser.js';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
    console.log('FV-1 Assembly Editor extension is now active');

    // Register commands
    const assembleCommand = vscode.commands.registerCommand('fv1.assemble', async () => {
        await assembleFV1();
    });

    const assembleAndProgramCommand = vscode.commands.registerCommand('fv1.assembleAndProgram', async () => {
        const result = await assembleFV1();
        if (result.machineCode.length > 0) {
            await programEeprom(result.machineCode);
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
        // await programEeprom(hexPath);
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

async function assembleFV1(): Promise<FV1AssemblerResult | undefined> {
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
        const fileContent = fs.readFileSync(sourceFile, 'utf8');
        const result = assembler.assemble(fileContent);
        if (result.problems.length !== 0) {
            vscode.window.showErrorMessage(`Assembly failed: ${result.problems.map(p => p.message).join(', ')}`);
        } else {
            vscode.window.showInformationMessage('Assembly successful');
        }
        return result;

        // if (fs.existsSync(outputFile)) {
        //     vscode.window.showInformationMessage(`Assembly successful: ${path.basename(outputFile)}`);
        //     return outputFile;
        // } else {
        //     vscode.window.showErrorMessage('Assembly failed: Output file not created');
        //     return;
        // }
    } catch (error) {
        vscode.window.showErrorMessage(`Unhandled assembly error: ${error}`);
        return;
    }
}

async function programEeprom(machineCode: number[], slot: number = 0): Promise<void> {
    const config = vscode.workspace.getConfiguration('fv1');
    const vendorId = parseInt(config.get<string>('mcp2221VendorId') || '0x04D8', 16);
    const productId = parseInt(config.get<string>('mcp2221ProductId') || '0x00DD', 16);
    const eepromAddress = parseInt(config.get<string>('i2cAddress') || '0x50', 16);

    const selectedDevice = await detectMCP2221();
    if (!selectedDevice) {
        vscode.window.showErrorMessage('No MCP2221 device selected');
        return;
    }

    const hidDevice = await HID.HIDAsync.open(selectedDevice.path!);
    const source = new NodeHIDStreamSource(hidDevice)

    // setup MCP2221 and I2CBus interface
    const device = new MCP2221(source)
    const bus = new I2CBusMCP2221(device)

    // set the bus speed to 100 / 400
    // note: this is not required for the mcp2221 bus to function 
    //   as the default configuration works out of the box in most cases
    await device.common.status({
        opaque: 'Speed-Setup-400',
        i2cClock: 400
    })

    // use bus with some device (just using eeprom as example here)
    const abus = new I2CAddressedBus(bus, DEFAULT_EEPROM_ADDRESS)
    const eeprom = new EEPROM(abus, { writePageSize: 32 })

    // write machine code to eeprom at slot offset
    const slotSize = 512;   // FV-1 slot size in bytes
    const startAddress = slot * slotSize;
    await eeprom.write(startAddress, expand32ToBytesWithDataView(machineCode));

    // Read back and verify
    // const verifyBuffer = await eeprom.read(startAddress, machineCode.length);
    // const verifyArray = ArrayBuffer.isView(verifyBuffer) ?
    //     new Uint8Array(verifyBuffer.buffer, verifyBuffer.byteOffset, verifyBuffer.byteLength) :
    //     new Uint8Array(verifyBuffer, 0, verifyBuffer.byteLength);

    vscode.window.showInformationMessage(`Programmed EEPROM at slot ${slot} (address 0x${startAddress.toString(16)})`);
}

function expand32ToBytesWithDataView(nums: number[], littleEndian = false): Uint8Array {
  const buffer = new ArrayBuffer(nums.length * 4);
  const view = new DataView(buffer);
  for (let i = 0; i < nums.length; i++) {
    view.setUint32(i * 4, nums[i] >>> 0, littleEndian);
  }
  return new Uint8Array(buffer);
}
    // async function detectMCP2221(): Promise<void> {
    //     const config = vscode.workspace.getConfiguration('fv1');
    //     const vendorId = parseInt(config.get<string>('mcp2221VendorId') || '04D8', 16);
    //     const productId = parseInt(config.get<string>('mcp2221ProductId') || '00DD', 16);

    //     try {
    //         const devices = HID.devices();
    //         const mcp2221Devices = devices.filter(d => d.vendorId === vendorId && d.productId === productId);

    //         if (mcp2221Devices.length === 0) {
    //             vscode.window.showWarningMessage('No MCP2221 devices found');
    //         } else {
    //             const deviceList = mcp2221Devices.map(d => 
    //                 `Product: ${d.product}, Serial: ${d.serialNumber}, Path: ${d.path}`
    //             ).join('\n');
    //             vscode.window.showInformationMessage(`Found ${mcp2221Devices.length} MCP2221 device(s):\n${deviceList}`);
    //         }
    //     } catch (error) {
    //         vscode.window.showErrorMessage(`Error detecting MCP2221: ${error}`);
    //     }

// async function testMCP2221() {
//     const VENDOR_ID = 1240
//     const PRODUCT_ID = 221
//     const hidDevice = await HID.HIDAsync.open(VENDOR_ID, PRODUCT_ID)
//     const source = new NodeHIDStreamSource(hidDevice)

//     // setup MCP2221 and I2CBus interface
//     const device = new MCP2221(source)
//     const bus = new I2CBusMCP2221(device)

//     // set the bus speed to 100 / 400
//     // note: this is not required for the mcp2221 bus to function 
//     //   as the default configuration works out of the box in most cases
//     await device.common.status({
//     opaque: 'Speed-Setup-400',
//     i2cClock: 400
//     })

//     // use bus with some device (just using eeprom as example here)
//     const abus = new I2CAddressedBus(bus, DEFAULT_EEPROM_ADDRESS)
//     const eeprom = new EEPROM(abus, { writePageSize: 32 })

//     // read first 24 bytes from eeprom
//     const startAddress = 0
//     const byteLength = 24
//     const buffer = await eeprom.read(startAddress, byteLength)
//     const u8 = ArrayBuffer.isView(buffer) ?
//     new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) :
//     new Uint8Array(buffer, 0, buffer.byteLength)

//     // log the first 24 bytes as unsigned 8-bit values
//     console.log(u8)
// }

/**
 * Present a QuickPick to the user and return the selected device info.
 * This is a non-async (no `async` keyword) function that returns a Promise
 * resolving to the chosen HID.DeviceInfo or undefined if cancelled / none found.
 */
function detectMCP2221(): Promise<HID.Device | undefined> {
    const config = vscode.workspace.getConfiguration('fv1');
    const vendorId = parseInt(config.get<string>('mcp2221VendorId') || '04D8', 16);
    const productId = parseInt(config.get<string>('mcp2221ProductId') || '00DD', 16);

    return new Promise((resolve) => {
        try {
            const devices = HID.devices();
            const mcp2221Devices = devices.filter(d => d.vendorId === vendorId && d.productId === productId);

            if (mcp2221Devices.length === 0) {
                vscode.window.showWarningMessage('No MCP2221 devices found');
                resolve(undefined);
                return;
            } else if (mcp2221Devices.length === 1) {
                // vscode.window.showInformationMessage(`Found MCP2221 device: ${mcp2221Devices[0].path}`);
                resolve(mcp2221Devices[0]);
                return;
            }

            const items: Array<vscode.QuickPickItem & { device?: HID.Device }> = mcp2221Devices.map(d => ({
                label: d.product || 'MCP2221',
                description: d.serialNumber ? `SN: ${d.serialNumber}` : undefined,
                detail: d.path,
                device: d
            }));

            vscode.window.showQuickPick(items, {
                placeHolder: 'Select MCP2221 device to use',
                canPickMany: false
            }).then(picked => {
                if (!picked) {
                    resolve(undefined);
                } else {
                    resolve(picked.device);
                }
            }, err => {
                vscode.window.showErrorMessage(`Error showing device picker: ${err}`);
                resolve(undefined);
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error detecting MCP2221: ${error}`);
            resolve(undefined);
        }
    });
}

export function deactivate() {
    console.log('FV-1 Assembly Editor extension deactivated');
}