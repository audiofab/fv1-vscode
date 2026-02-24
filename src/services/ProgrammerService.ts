import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import HID from 'node-hid';
import { MCP2221 } from '@johntalton/mcp2221';
import { I2CBusMCP2221 } from '@johntalton/i2c-bus-mcp2221';
import { I2CAddressedBus } from '@johntalton/and-other-delights';
import { EEPROM, DEFAULT_EEPROM_ADDRESS, DEFAULT_WRITE_PAGE_SIZE } from '@johntalton/eeprom';
import { NodeHIDStreamSource } from '../lib/node-hid-stream.js';
import { FV1Assembler, FV1AssemblerResult } from '../assembler/FV1Assembler.js';
import { IntelHexParser } from '../core/hexParser.js';
import { OutputService } from './OutputService.js';
import { AssemblyService } from './AssemblyService.js';

const FV1_EEPROM_SLOT_SIZE_BYTES = 512;

export class ProgrammerService {
    constructor(
        private outputService: OutputService,
        private assemblyService: AssemblyService
    ) { }

    private validateHardwareLimits(): boolean {
        const config = vscode.workspace.getConfiguration('fv1');
        const regCount = config.get<number>('hardware.regCount') ?? 32;
        const progSize = config.get<number>('hardware.progSize') ?? 128;
        const delaySize = config.get<number>('hardware.delaySize') ?? 32768;

        if (regCount !== 32 || progSize !== 128 || delaySize !== 32768) {
            const msg = `Hardware programming is only allowed with standard FV-1 limits (32 REGs, 128 instructions, 32k RAM). Current settings: ${regCount} REGs, ${progSize} instructions, ${delaySize} RAM.`;
            this.outputService.log(`[ERROR] ❌ ${msg}`);
            vscode.window.showErrorMessage(msg);
            return false;
        }
        return true;
    }

    public async selectProgramSlot(): Promise<number | undefined> {
        const items = Array.from({ length: 8 }, (_, i) => i + 1).map(i => ({
            label: `Program ${i}`,
            description: `Program into EEPROM program slot ${i}`,
            index: i - 1
        }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select program to write to EEPROM (1-8)', canPickMany: false });
        return picked?.index;
    }

    public async detectMCP2221(): Promise<HID.Device | undefined> {
        const config = vscode.workspace.getConfiguration('fv1');
        const vendorId = parseInt(config.get<string>('mcp2221VendorId') || '0x04D8', 16);
        const productId = parseInt(config.get<string>('mcp2221ProductId') || '0x00DD', 16);

        try {
            const devices = HID.devices();
            const mcp2221Devices = devices.filter(d => d.vendorId === vendorId && d.productId === productId);

            if (mcp2221Devices.length === 0) {
                vscode.window.showWarningMessage('No MCP2221 devices found');
                return undefined;
            }
            if (mcp2221Devices.length === 1) {
                return mcp2221Devices[0];
            }

            const items = mcp2221Devices.map(d => ({
                label: d.product || 'MCP2221',
                description: d.serialNumber ? `SN: ${d.serialNumber}` : undefined,
                detail: d.path,
                device: d
            }));

            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select MCP2221 device to use', canPickMany: false });
            return picked?.device;
        } catch (error) {
            vscode.window.showErrorMessage(`Error detecting MCP2221: ${error}`);
            return undefined;
        }
    }

    private async getEepromConnection(): Promise<EEPROM | undefined> {
        const config = vscode.workspace.getConfiguration('fv1');
        const eepromAddress = config.get<number>('i2cAddress') ?? DEFAULT_EEPROM_ADDRESS;
        const pageSize = config.get<number>('writePageSize') ?? DEFAULT_WRITE_PAGE_SIZE;

        const selectedDevice = await this.detectMCP2221();
        if (!selectedDevice) return undefined;

        try {
            const hidDevice = await HID.HIDAsync.open(selectedDevice.path!);
            const source = new NodeHIDStreamSource(hidDevice);
            const device = new MCP2221(source);
            const bus = new I2CBusMCP2221(device);

            await device.common.status({ opaque: 'Speed-Setup-400', i2cClock: 400 });

            const abus = new I2CAddressedBus(bus, eepromAddress);
            return new EEPROM(abus, { writePageSize: pageSize });
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error connecting to pedal: ${error}`);
            vscode.window.showErrorMessage(`Error connecting to pedal: ${error}`);
            return undefined;
        }
    }

    public async programEeprom(machineCode: number[], forcedSlot?: number): Promise<void> {
        if (!this.validateHardwareLimits()) return;

        const config = vscode.workspace.getConfiguration('fv1');
        const verifyWrites = config.get<boolean>('verifyWrites') ?? true;

        const eeprom = await this.getEepromConnection();
        if (!eeprom) return;

        try {
            let selectedSlot = forcedSlot;
            if (selectedSlot === undefined) selectedSlot = await this.selectProgramSlot();
            if (selectedSlot === undefined) {
                vscode.window.showWarningMessage('No program slot was selected, aborting');
                return;
            }

            const startAddress = selectedSlot * FV1_EEPROM_SLOT_SIZE_BYTES;
            const writeData = FV1Assembler.toUint8Array(machineCode);

            if (writeData.length !== FV1_EEPROM_SLOT_SIZE_BYTES) {
                vscode.window.showErrorMessage(`Unexpected machine code size (${writeData.length} bytes)`);
                return;
            }

            await eeprom.write(startAddress, writeData);

            if (verifyWrites) {
                const verifyBuffer = await eeprom.read(startAddress, FV1_EEPROM_SLOT_SIZE_BYTES);
                const verifyArray = new Uint8Array(verifyBuffer as any);
                for (let i = 0; i < writeData.length; i++) {
                    if (writeData[i] !== verifyArray[i]) throw new Error(`Verification failed at byte ${i}`);
                }
                this.outputService.log(`[SUCCESS] ✅ Successfully wrote and verified program slot ${selectedSlot + 1}`);
            } else {
                this.outputService.log(`[SUCCESS] ✅ Successfully wrote to program slot ${selectedSlot + 1}`);
            }
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error programming EEPROM: ${error}`);
            vscode.window.showErrorMessage(`Error programming EEPROM: ${error}`);
        }
    }

    public async backupPedal(): Promise<void> {
        try {
            this.outputService.log(`[INFO] 💾 Starting pedal backup...`);

            const eeprom = await this.getEepromConnection();
            if (!eeprom) return;

            const totalBytes = 8 * FV1_EEPROM_SLOT_SIZE_BYTES;
            this.outputService.log(`[INFO] 📖 Reading ${totalBytes} bytes from EEPROM...`);

            const readBuffer = await eeprom.read(0, totalBytes);
            const dataArray = new Uint8Array(readBuffer as any);

            this.outputService.log(`[SUCCESS] ✅ Successfully read ${dataArray.length} bytes`);

            const segments: Array<{ data: Buffer, address: number }> = [];
            for (let slot = 0; slot < 8; slot++) {
                const startOffset = slot * FV1_EEPROM_SLOT_SIZE_BYTES;
                const slotData = dataArray.slice(startOffset, startOffset + FV1_EEPROM_SLOT_SIZE_BYTES);
                segments.push({ data: Buffer.from(slotData), address: startOffset });
            }

            const defaultFileName = `pedal-backup-${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.hex`;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.';
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(workspaceFolder, defaultFileName)),
                filters: { 'Intel HEX files': ['hex'], 'All files': ['*'] },
                saveLabel: 'Save Backup'
            });

            if (!saveUri) {
                this.outputService.log(`[WARNING] ⚠ Backup cancelled by user`);
                return;
            }

            this.outputService.log(`[INFO] 📄 Generating Intel HEX file...`);
            const hexFileString = IntelHexParser.generateMultiSegment(segments, 16);
            fs.writeFileSync(saveUri.fsPath, hexFileString, 'utf8');

            if (fs.existsSync(saveUri.fsPath)) {
                this.outputService.log(`[SUCCESS] ✅ Pedal backup saved to: ${path.basename(saveUri.fsPath)}`);
                vscode.window.showInformationMessage(`Pedal backup successfully saved to ${path.basename(saveUri.fsPath)}`);

                const openFile = await vscode.window.showInformationMessage('Backup complete! Open file?', 'Open File', 'Close');
                if (openFile === 'Open File') {
                    const doc = await vscode.workspace.openTextDocument(saveUri);
                    await vscode.window.showTextDocument(doc);
                }
            } else {
                throw new Error('Failed to save backup file');
            }
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error backing up pedal: ${error}`);
            vscode.window.showErrorMessage(`Error backing up pedal: ${error}`);
        }
    }

    public async loadHexToEeprom(): Promise<void> {
        if (!this.validateHardwareLimits()) return;

        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const document = activeEditor.document;
            if (!document.fileName.endsWith('.hex')) {
                vscode.window.showErrorMessage('Active file is not an Intel HEX file (.hex)');
                return;
            }

            const hexFilePath = document.fileName;
            this.outputService.log(`[INFO] 📄 Loading Intel HEX file: ${path.basename(hexFilePath)}...`);

            const hexContent = fs.readFileSync(hexFilePath, 'utf8');

            const validation = IntelHexParser.validateHex(hexContent);
            if (!validation.valid) {
                this.outputService.log(`[ERROR] ❌ Invalid Intel HEX file:`);
                validation.errors.forEach(error => {
                    this.outputService.log(`[ERROR] ❌   ${error}`);
                });
                vscode.window.showErrorMessage('Invalid Intel HEX file. Check Output panel for details.');
                return;
            }

            this.outputService.log(`[INFO] 🔧 Parsing Intel HEX file...`);
            const buffer = IntelHexParser.parse(hexContent);
            this.outputService.log(`[SUCCESS] ✅ Parsed ${buffer.length} bytes from Intel HEX file`);

            const config = vscode.workspace.getConfiguration('fv1');
            const verifyWrites = config.get<boolean>('verifyWrites') ?? true;

            const eeprom = await this.getEepromConnection();
            if (!eeprom) return;

            this.outputService.log(`[INFO] 📡 Programming EEPROM with ${buffer.length} bytes...`);
            const writeData = new Uint8Array(buffer);
            await eeprom.write(0, writeData);

            if (verifyWrites) {
                this.outputService.log(`[INFO] 🔍 Verifying EEPROM contents...`);
                const verifyBuffer = await eeprom.read(0, buffer.length);
                const verifyArray = new Uint8Array(verifyBuffer as any);

                let verificationFailed = false;
                for (let i = 0; i < writeData.length; i++) {
                    if (writeData[i] !== verifyArray[i]) {
                        this.outputService.log(`[ERROR] ❌ Verification failed at address 0x${i.toString(16).toUpperCase().padStart(4, '0')}: expected 0x${writeData[i].toString(16).toUpperCase().padStart(2, '0')}, got 0x${verifyArray[i].toString(16).toUpperCase().padStart(2, '0')}`);
                        verificationFailed = true;
                        break;
                    }
                }

                if (verificationFailed) {
                    vscode.window.showErrorMessage('EEPROM verification failed. Check Output panel for details.');
                    return;
                }

                this.outputService.log(`[SUCCESS] ✅ Successfully wrote and verified ${buffer.length} bytes to EEPROM`);
                vscode.window.showInformationMessage(`Successfully programmed ${buffer.length} bytes to EEPROM`);
            } else {
                this.outputService.log(`[SUCCESS] ✅ Successfully wrote ${buffer.length} bytes to EEPROM`);
                vscode.window.showInformationMessage(`Successfully programmed ${buffer.length} bytes to EEPROM`);
            }

        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error loading HEX file to EEPROM: ${error}`);
            vscode.window.showErrorMessage(`Error loading HEX file to EEPROM: ${error}`);
        }
    }

    public async programBank(item?: any): Promise<void> {
        if (!this.validateHardwareLimits()) return;

        try {
            const files = item && item.resourceUri ? [item.resourceUri] : await vscode.workspace.findFiles('**/*.spnbank', '**/node_modules/**');
            if (!files || files.length === 0) {
                vscode.window.showErrorMessage('No .spnbank files found');
                return;
            }

            // Save all dirty .spn and .spndiagram files before assembling
            const dirtyDocs = vscode.workspace.textDocuments.filter(doc =>
                doc.isDirty && (doc.fileName.endsWith('.spn') || doc.fileName.endsWith('.spndiagram'))
            );
            if (dirtyDocs.length > 0) {
                this.outputService.log(`[INFO] 💾 Saving ${dirtyDocs.length} unsaved file(s)...`);
                for (const doc of dirtyDocs) {
                    const saved = await doc.save();
                    if (!saved) {
                        vscode.window.showErrorMessage(`Failed to save ${path.basename(doc.fileName)}. Programming aborted.`);
                        return;
                    }
                }
            }

            const programsToDownload: Array<{ machineCode: number[], slotIndex: number, filePath: string }> = [];
            let hasAssemblyErrors = false;

            this.outputService.log(`Starting assembly phase for ${files.length} bank file(s)...`);

            for (const file of files) {
                const doc = await vscode.workspace.openTextDocument(file);
                const json = doc.getText() ? JSON.parse(doc.getText()) : {};
                const slots = Array.isArray(json.slots) ? json.slots : [];

                for (const s of slots) {
                    if (!s || !s.path) continue;
                    const bankDir = path.dirname(file.fsPath);
                    const fsPath = path.isAbsolute(s.path) ? s.path : path.resolve(bankDir, s.path);

                    if (!fs.existsSync(fsPath)) {
                        this.outputService.log(`[ERROR] ❌ Skipping slot ${s.slot}: file not found ${path.basename(fsPath)}`);
                        hasAssemblyErrors = true;
                        continue;
                    }

                    this.outputService.log(`[INFO] 🔧 Assembling slot ${s.slot}: ${path.basename(fsPath)}...`);
                    const result = await this.assemblyService.assembleFile(fsPath);

                    if (!result) {
                        hasAssemblyErrors = true;
                        continue;
                    }

                    if (result.problems.some((p: any) => p.isfatal)) {
                        this.outputService.log(`[ERROR] ❌ Slot ${s.slot} failed to assemble due to errors - ${path.basename(fsPath)}`);
                        result.problems.forEach((p: any) => {
                            if (p.isfatal) this.outputService.log(`[ERROR] ❌ ${p.message}`);
                        });
                        hasAssemblyErrors = true;
                    } else if (result.machineCode && result.machineCode.length > 0) {
                        programsToDownload.push({
                            machineCode: result.machineCode,
                            slotIndex: s.slot - 1,
                            filePath: fsPath
                        });
                        this.outputService.log(`[SUCCESS] ✅ Slot ${s.slot} assembled successfully - ${path.basename(fsPath)}`);
                    } else {
                        this.outputService.log(`[ERROR] ❌ Slot ${s.slot} produced no machine code - ${path.basename(fsPath)}`);
                    }
                }
            }

            if (hasAssemblyErrors) {
                vscode.window.showErrorMessage('Programming aborted: One or more programs failed to assemble. Check the Output panel for details.');
                this.outputService.log(`[ERROR] ❌ Assembly phase completed with errors. Programming aborted.`);
                return;
            }

            if (programsToDownload.length === 0) {
                vscode.window.showWarningMessage('No programs to download: All assigned slots are empty or failed to assemble.');
                this.outputService.log(`[WARNING] ⚠ No programs available for download.`);
                return;
            }

            this.outputService.log(`[SUCCESS] ✅ Assembly phase completed successfully. Programming ${programsToDownload.length} program(s)...`);

            for (const program of programsToDownload) {
                try {
                    this.outputService.log(`[INFO] 📡 Programming slot ${program.slotIndex + 1}: ${path.basename(program.filePath)}...`);
                    await this.programEeprom(program.machineCode, program.slotIndex);
                } catch (e) {
                    // programEeprom handles logging errors
                }
            }

            this.outputService.log(`[SUCCESS] ✅ Programming phase completed.`);

        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error programming bank: ${error}`);
            vscode.window.showErrorMessage(`Error programming bank: ${error}`);
        }
    }

    public async programSlotFromBank(item?: any): Promise<void> {
        if (!this.validateHardwareLimits()) return;

        try {
            let bankUri: vscode.Uri | undefined;
            let slotNum: number | undefined;
            if (item && item.bankUri) { bankUri = item.bankUri as vscode.Uri; slotNum = item.slot as number; }
            if (!bankUri || !slotNum) { vscode.window.showErrorMessage('No slot selected to program'); return; }

            const doc = await vscode.workspace.openTextDocument(bankUri!);
            const json = doc.getText() ? JSON.parse(doc.getText()) : {};
            const entry = json.slots && json.slots[slotNum - 1];
            if (!entry || !entry.path) {
                vscode.window.showErrorMessage(`Slot ${slotNum} is unassigned`);
                return;
            }

            const bankDir = path.dirname(bankUri!.fsPath);
            const fsPath = path.isAbsolute(entry.path) ? entry.path : path.resolve(bankDir, entry.path);

            this.outputService.log(`[INFO] 🔧 Assembling ${path.basename(fsPath)} for slot ${slotNum}...`);
            const result = await this.assemblyService.assembleFile(fsPath);

            if (result && result.machineCode && result.machineCode.length > 0 && !result.problems.some(p => p.isfatal)) {
                await this.programEeprom(result.machineCode, slotNum - 1);
            } else {
                vscode.window.showErrorMessage(`Assembly failed for slot ${slotNum}. Check Output panel.`);
            }
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Failed to program slot: ${error}`);
            vscode.window.showErrorMessage(`Failed to program slot: ${error}`);
        }
    }
}