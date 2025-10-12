import * as vscode from 'vscode';
import * as fs from 'fs';
import HID from 'node-hid';
import { MCP2221 } from '@johntalton/mcp2221'
import { I2CBusMCP2221 } from '@johntalton/i2c-bus-mcp2221'
import { I2CAddressedBus } from '@johntalton/and-other-delights'
import { EEPROM, DEFAULT_EEPROM_ADDRESS, DEFAULT_WRITE_PAGE_SIZE } from '@johntalton/eeprom'
import { NodeHIDStreamSource } from './node-hid-stream.js';
import {FV1Assembler, FV1AssemblerResult} from './FV1Assembler.js';

const FV1_EEPROM_SLOT_SIZE_BYTES = 512; // Each FV-1 slot is 512 bytes

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

    context.subscriptions.push(
        assembleCommand,
        assembleAndProgramCommand,
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
    } catch (error) {
        vscode.window.showErrorMessage(`Unhandled assembly error: ${error}`);
        return;
    }
}

async function programEeprom(machineCode: number[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('fv1');
    let verifyWrites: boolean = config.get<boolean>('verifyWrites');
    let eepromAddress: number = config.get<number>('i2cAddress');
    let pageSize: number = config.get<number>('writePageSize');

    if (verifyWrites === undefined) {
        verifyWrites = true;
    }
    if (isNaN(eepromAddress) || eepromAddress < 0 || eepromAddress > 127) {
        eepromAddress = DEFAULT_EEPROM_ADDRESS;
    }
    if (isNaN(pageSize) || pageSize < 0 || pageSize > 512) {
        pageSize = DEFAULT_WRITE_PAGE_SIZE;
    }


    const selectedDevice = await detectMCP2221();
    if (!selectedDevice) {
        vscode.window.showErrorMessage('No MCP2221 device selected');
        return;
    }

    try {
        const hidDevice = await HID.HIDAsync.open(selectedDevice.path!);
        const source = new NodeHIDStreamSource(hidDevice);

        // setup MCP2221 and I2CBus interface
        const device = new MCP2221(source);
        const bus = new I2CBusMCP2221(device);

        // set the bus speed to 100 / 400
        // note: this is not required for the mcp2221 bus to function 
        //   as the default configuration works out of the box in most cases
        await device.common.status({
            opaque: 'Speed-Setup-400',
            i2cClock: 400
        });

        // use bus with some device (just using eeprom as example here)
        const abus = new I2CAddressedBus(bus, eepromAddress);
        const eeprom = new EEPROM(abus, { writePageSize: pageSize });

        // Prompt user for which slot to program (Program 1 to 8)
        const selectedSlot = await new Promise<number | undefined>((resolve) => {
            try {
                const items: Array<vscode.QuickPickItem & { index?: number }> = Array.from({ length: 8 }, (_, i) => i + 1).map(i => ({
                    label: `Program ${i}`,
                    description: `Slot ${i} (address 0x${((i - 1) * FV1_EEPROM_SLOT_SIZE_BYTES).toString(16)})`,
                    index: i - 1
                }));

                vscode.window.showQuickPick(items, {
                    placeHolder: 'Select program to write to EEPROM (1-8)',
                    canPickMany: false
                }).then(picked => {
                    if (!picked) {
                        resolve(undefined);
                    } else {
                        resolve(picked.index);
                    }
                }, err => {
                    vscode.window.showErrorMessage(`Error showing device picker: ${err}`);
                    resolve(undefined);
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Error selecting a program: ${error}`);
                resolve(undefined);
            }
        });

        if (selectedSlot === undefined) {
            vscode.window.showWarningMessage('No program slot selected, aborting');
            return;
        }

        // write machine code to eeprom at slot offset
        const slotSize = FV1_EEPROM_SLOT_SIZE_BYTES;   // FV-1 slot size in bytes
        const startAddress = selectedSlot * slotSize;
        const writeData: Uint8Array = expand32ToBytesWithDataView(machineCode);
        if (writeData.length != slotSize) {
            vscode.window.showErrorMessage(`Unexpected machine code size (${writeData.length} bytes) expected (${slotSize} bytes)`);
            return;
        }
        await eeprom.write(startAddress, writeData);

        // Read back and verify
        if (verifyWrites) {
            const verifyBuffer = await eeprom.read(startAddress, FV1_EEPROM_SLOT_SIZE_BYTES);
            const verifyArray = ArrayBuffer.isView(verifyBuffer) ?
                new Uint8Array(verifyBuffer.buffer, verifyBuffer.byteOffset, verifyBuffer.byteLength) :
                new Uint8Array(verifyBuffer, 0, verifyBuffer.byteLength);
            // Compare writeData to verifyArray
            for (let i = 0; i < writeData.length; i++) {
                if (writeData[i] !== verifyArray[i]) {
                    throw new Error(`Verification failed at byte ${i}: wrote 0x${writeData[i].toString(16)}, read back 0x${verifyArray[i].toString(16)}`);
                }
            }
            vscode.window.showInformationMessage(`Successfully wrote and verified program ${selectedSlot}`);
        } else {
            vscode.window.showInformationMessage(`Successfully wrote to program ${selectedSlot}`);
        }

    } catch (error) {
        vscode.window.showErrorMessage(`Error programming EEPROM: ${error}`);
        return;
    }
}

function expand32ToBytesWithDataView(nums: number[], littleEndian = false): Uint8Array {
  const buffer = new ArrayBuffer(nums.length * 4);
  const view = new DataView(buffer);
  for (let i = 0; i < nums.length; i++) {
    view.setUint32(i * 4, nums[i] >>> 0, littleEndian);
  }
  return new Uint8Array(buffer);
}

/**
 * Present a QuickPick to the user and return the selected device info.
 * This is a non-async (no `async` keyword) function that returns a Promise
 * resolving to the chosen HID.DeviceInfo or undefined if cancelled / none found.
 */
function detectMCP2221(): Promise<HID.Device | undefined> {
    const config = vscode.workspace.getConfiguration('fv1');
    const vendorId = parseInt(config.get<string>('mcp2221VendorId') || '0x04D8', 16);
    const productId = parseInt(config.get<string>('mcp2221ProductId') || '0x00DD', 16);

    return new Promise((resolve) => {
        try {
            const devices = HID.devices();
            const mcp2221Devices = devices.filter(d => d.vendorId === vendorId && d.productId === productId);

            if (mcp2221Devices.length === 0) {
                vscode.window.showWarningMessage('No MCP2221 devices found');
                resolve(undefined);
                return;
            } else if (mcp2221Devices.length === 1) {
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