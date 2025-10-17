import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import HID from 'node-hid';
import { MCP2221 } from '@johntalton/mcp2221';
import { I2CBusMCP2221 } from '@johntalton/i2c-bus-mcp2221';
import { I2CAddressedBus } from '@johntalton/and-other-delights';
import { EEPROM, DEFAULT_EEPROM_ADDRESS, DEFAULT_WRITE_PAGE_SIZE } from '@johntalton/eeprom';
import { NodeHIDStreamSource } from './node-hid-stream.js';
import { FV1Assembler, FV1AssemblerResult } from './FV1Assembler.js';
import { IntelHexParser } from './hexParser.js';
import { SpnBankProvider } from './SpnBanksProvider.js';

const FV1_EEPROM_SLOT_SIZE_BYTES = 512; // Each FV-1 slot is 512 bytes

async function outputWindow(outputChannel: vscode.OutputChannel, message: string, isLine: boolean = true): Promise<void> {
    const config = vscode.workspace.getConfiguration('fv1');
    const showOutputWindow: boolean | undefined = config.get<boolean>('autoShowOutputWindow');
    if (showOutputWindow ?? true) outputChannel.show(true);
    isLine ? outputChannel.appendLine(message) : outputChannel.append(message);
}

async function assembleFV1(outputChannel: vscode.OutputChannel, diagnostics: vscode.DiagnosticCollection): Promise<FV1AssemblerResult | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return undefined;
    }
    const document = editor.document;
    if (!document.fileName.endsWith('.spn')) {
        vscode.window.showErrorMessage('Active file is not an FV-1 assembly file (.spn)');
        return undefined;
    }

    const content = document.getText();
    const assembler = new FV1Assembler({ fv1AsmMemBug: vscode.workspace.getConfiguration('fv1').get<boolean>('spinAsmMemBug') ?? true });
    outputWindow(outputChannel, `Assembling ${document.fileName}...`);
    const result = assembler.assemble(content);

    // publish diagnostics
    const fileUri = document.uri;
    diagnostics.delete(fileUri);
    const newDiagnostics: Array<vscode.Diagnostic> = [];
    if (result.problems.length > 0) {
        result.problems.forEach((p: any) => {
            const range = new vscode.Range(p.line - 1, 0, p.line - 1, Number.MAX_SAFE_INTEGER);
            const severity = p.isfatal ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
            const diagnostic = new vscode.Diagnostic(range, p.message, severity);
            diagnostic.source = 'fv1-assembler';
            newDiagnostics.push(diagnostic);
            outputWindow(outputChannel, `${p.isfatal ? 'Error' : 'Warning'}: ${p.message}`);
        });
        diagnostics.set(fileUri, newDiagnostics);
    }

    return result;
}

/**
 * Program the assembled machineCode into EEPROM via MCP2221/I2C.
 * If forcedSlot is provided it will be used (0-based), otherwise the user will be prompted.
 */
async function programEeprom(machineCode: number[], outputChannel: vscode.OutputChannel, forcedSlot?: number): Promise<void> {
    const config = vscode.workspace.getConfiguration('fv1');
    let verifyWrites: boolean | undefined = config.get<boolean>('verifyWrites');
    let eepromAddress: number | undefined = config.get<number>('i2cAddress');
    let pageSize: number | undefined = config.get<number>('writePageSize');

    if (verifyWrites === undefined) verifyWrites = true;
    if (isNaN(Number(eepromAddress)) || eepromAddress === undefined || eepromAddress < 0 || eepromAddress > 127) {
        eepromAddress = DEFAULT_EEPROM_ADDRESS;
    }
    if (isNaN(Number(pageSize)) || pageSize === undefined || pageSize < 0 || pageSize > 512) {
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
        const device = new MCP2221(source);
        const bus = new I2CBusMCP2221(device);

        await device.common.status({ opaque: 'Speed-Setup-400', i2cClock: 400 });

        const abus = new I2CAddressedBus(bus, eepromAddress!);
        const eeprom = new EEPROM(abus, { writePageSize: pageSize! });

        let selectedSlot = forcedSlot;
        if (selectedSlot === undefined) selectedSlot = await selectProgramSlot();
        if (selectedSlot === undefined) { vscode.window.showWarningMessage('No program slot was selected, aborting'); return; }

        const slotSize = FV1_EEPROM_SLOT_SIZE_BYTES;
        const startAddress = selectedSlot * slotSize;
        const writeData: Uint8Array = FV1Assembler.toUint8Array(machineCode);
        if (writeData.length !== slotSize) {
            vscode.window.showErrorMessage(`Unexpected machine code size (${writeData.length} bytes) expected (${slotSize} bytes)`);
            return;
        }

        await eeprom.write(startAddress, writeData);

        if (verifyWrites) {
            const verifyBuffer = await eeprom.read(startAddress, slotSize);
            const verifyArray = ArrayBuffer.isView(verifyBuffer) ?
                new Uint8Array((verifyBuffer as any).buffer, (verifyBuffer as any).byteOffset, (verifyBuffer as any).byteLength) :
                new Uint8Array(verifyBuffer as any, 0, (verifyBuffer as any).byteLength);
            for (let i = 0; i < writeData.length; i++) {
                if (writeData[i] !== verifyArray[i]) throw new Error(`Verification failed at byte ${i}`);
            }
            outputWindow(outputChannel, `Successfully wrote and verified program ${selectedSlot + 1}`);
        } else {
            outputWindow(outputChannel, `Successfully wrote to program ${selectedSlot + 1}`);
        }

    } catch (error) {
        vscode.window.showErrorMessage(`Error programming EEPROM: ${error}`);
        return;
    }
}

function detectMCP2221(): Promise<HID.Device | undefined> {
    const config = vscode.workspace.getConfiguration('fv1');
    const vendorId = parseInt(config.get<string>('mcp2221VendorId') || '0x04D8', 16);
    const productId = parseInt(config.get<string>('mcp2221ProductId') || '0x00DD', 16);

    return new Promise((resolve) => {
        try {
            const devices = HID.devices();
            const mcp2221Devices = devices.filter(d => d.vendorId === vendorId && d.productId === productId);
            if (mcp2221Devices.length === 0) { vscode.window.showWarningMessage('No MCP2221 devices found'); resolve(undefined); return; }
            if (mcp2221Devices.length === 1) { resolve(mcp2221Devices[0]); return; }

            const items: Array<vscode.QuickPickItem & { device?: HID.Device }> = mcp2221Devices.map(d => ({ label: d.product || 'MCP2221', description: d.serialNumber ? `SN: ${d.serialNumber}` : undefined, detail: d.path, device: d }));
            vscode.window.showQuickPick(items, { placeHolder: 'Select MCP2221 device to use', canPickMany: false }).then(picked => {
                if (!picked) resolve(undefined); else resolve(picked.device);
            }, err => { vscode.window.showErrorMessage(`Error showing device picker: ${err}`); resolve(undefined); });
        } catch (error) { vscode.window.showErrorMessage(`Error detecting MCP2221: ${error}`); resolve(undefined); }
    });
}

async function outputIntelHexFile(machineCode: number[], outputChannel: vscode.OutputChannel): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) { vscode.window.showErrorMessage('No active editor'); return; }
    const document = activeEditor.document;
    if (!document.fileName.endsWith('.spn')) { vscode.window.showErrorMessage('Active file is not an FV-1 assembly file (.spn)'); return; }
    const sourceFile = document.fileName;
    const outputFile = sourceFile.replace(/\.(spn|fv1)$/, '.hex');

    const selectedSlot = await selectProgramSlot();
    if (selectedSlot === undefined) { vscode.window.showWarningMessage('No program slot was selected, aborting'); return; }

    try {
        const hexFileString = IntelHexParser.generate(Buffer.from(FV1Assembler.toUint8Array(machineCode)), selectedSlot * FV1_EEPROM_SLOT_SIZE_BYTES, 4);
        fs.writeFileSync(outputFile, hexFileString, 'utf8');
        if (fs.existsSync(outputFile)) { outputWindow(outputChannel, `Saved to file: ${path.basename(outputFile)}`); return; }
        vscode.window.showErrorMessage('Failed to save HEX file');
    } catch (error) {
        vscode.window.showErrorMessage(`Error creating .hex file: ${error}`);
    }
}

function selectProgramSlot(): Promise<number | undefined> {
    return new Promise<number | undefined>((resolve) => {
        try {
            const items: Array<vscode.QuickPickItem & { index?: number }> = Array.from({ length: 8 }, (_, i) => i + 1).map(i => ({ label: `Program ${i}`, description: `Program into EEPROM program slot ${i}`, index: i - 1 }));
            vscode.window.showQuickPick(items, { placeHolder: 'Select program to write to EEPROM (1-8)', canPickMany: false }).then(picked => {
                if (!picked) resolve(undefined); else resolve(picked.index);
            }, err => { vscode.window.showErrorMessage(`Error showing device picker: ${err}`); resolve(undefined); });
        } catch (error) { vscode.window.showErrorMessage(`Error selecting a program: ${error}`); resolve(undefined); }
    });
}

export function deactivate() { /* noop */ }

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('FV-1 Assembler');
    const fv1Diagnostics = vscode.languages.createDiagnosticCollection('fv1-assembler');

    const provider = new SpnBankProvider(vscode.workspace.workspaceFolders?.[0]?.uri);
    const spnBanksView = vscode.window.createTreeView('audiofab.spnBanks', { treeDataProvider: provider, dragAndDropController: provider });
    // give provider access to the TreeView so it can reveal items on change
    if ((provider as any).setTreeView) (provider as any).setTreeView(spnBanksView as vscode.TreeView<vscode.TreeItem>);

    const createCmd = vscode.commands.registerCommand('fv1.createSpnBank', async () => {
        const uris = await vscode.window.showSaveDialog({ filters: { 'SPN Bank': ['spnbank'] }, defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '.', 'new.spnbank')) });
        if (!uris) return;
        const content = JSON.stringify({ slots: Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, path: '' })) }, null, 2);
        await vscode.workspace.fs.writeFile(uris, Buffer.from(content, 'utf8'));
        provider.refresh();
    });

    const programAllCmd = vscode.commands.registerCommand('fv1.programSpnBank', async (item?: any) => {
        const files = item && item.resourceUri ? [item.resourceUri] : await vscode.workspace.findFiles('**/*.spnbank', '**/node_modules/**');
        if (!files || files.length === 0) { vscode.window.showErrorMessage('No .spnbank files found'); return; }
        for (const file of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const json = doc.getText() ? JSON.parse(doc.getText()) : {};
                const slots = Array.isArray(json.slots) ? json.slots : [];
                for (const s of slots) {
                    if (!s || !s.path) { continue; }
                    const bankDir = path.dirname(file.fsPath);
                    const fsPath = path.isAbsolute(s.path) ? s.path : path.resolve(bankDir, s.path);
                    if (!fs.existsSync(fsPath)) { outputWindow(outputChannel, `Skipping ${s.slot}: file not found ${fsPath}`); continue; }
                    const content = fs.readFileSync(fsPath, 'utf8');
                    const assembler = new FV1Assembler({ fv1AsmMemBug: vscode.workspace.getConfiguration('fv1').get<boolean>('spinAsmMemBug') ?? true });
                    outputWindow(outputChannel, `Assembling ${fsPath}...`);
                    const result = assembler.assemble(content);
                    const fileUri = vscode.Uri.file(fsPath);
                    fv1Diagnostics.delete(fileUri);
                    const newDiagnostics: Array<vscode.Diagnostic> = [];
                    if (result.problems.length !== 0) {
                        result.problems.forEach((p: any) => {
                            const range = new vscode.Range(p.line - 1, 0, p.line - 1, Number.MAX_SAFE_INTEGER);
                            const severity = p.isfatal ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
                            const diagnostic = new vscode.Diagnostic(range, p.message, severity);
                            diagnostic.source = 'fv1-assembler';
                            newDiagnostics.push(diagnostic);
                            outputWindow(outputChannel, `${p.isfatal ? 'Error' : 'Warning'}: ${p.message}`);
                        });
                        fv1Diagnostics.set(fileUri, newDiagnostics);
                    }
                    if (result.machineCode && result.machineCode.length > 0) {
                        await programEeprom(result.machineCode, outputChannel, s.slot - 1);
                    } else {
                        outputWindow(outputChannel, `Skipping ${s.slot}: assemble produced no machine code`);
                    }
                }
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to program spnbank: ${e}`);
            }
        }
    });

    const unassignCmd = vscode.commands.registerCommand('fv1.unassignSlot', async (item?: vscode.TreeItem) => {
        try {
            let bankUri: vscode.Uri | undefined;
            let slotNum: number | undefined;
            if (item && (item as any).bankUri) { bankUri = (item as any).bankUri; slotNum = (item as any).slot; }
            if (!bankUri || !slotNum) { vscode.window.showErrorMessage('No slot selected to unassign'); return; }
            // Read current manifest, update the slot and write directly to disk to avoid dirtying an open editor
            const doc = await vscode.workspace.openTextDocument(bankUri);
            const json = doc.getText() ? JSON.parse(doc.getText()) : {};
            json.slots = json.slots || new Array(8).fill(null).map((_, i) => ({ slot: i+1, path: '' }));
            json.slots[slotNum - 1] = { slot: slotNum, path: '' };
            const newContent = Buffer.from(JSON.stringify(json, null, 2), 'utf8');
            await vscode.workspace.fs.writeFile(bankUri, newContent);
            provider.refresh();
        } catch (e) { vscode.window.showErrorMessage(`Failed to unassign slot: ${e}`); }
    });

    const programThisSlotCmd = vscode.commands.registerCommand('fv1.programThisSlot', async (item?: vscode.TreeItem) => {
        try {
            let bankUri: vscode.Uri | undefined;
            let slotNum: number | undefined;
            if (item && (item as any).bankUri) { bankUri = (item as any).bankUri as vscode.Uri; slotNum = (item as any).slot as number; }
            if (!bankUri || !slotNum) {
                const files = await vscode.workspace.findFiles('**/*.spnbank', '**/node_modules/**');
                if (files.length === 0) { vscode.window.showErrorMessage('No .spnbank files in workspace'); return; }
                const pick = await vscode.window.showQuickPick(files.map(f => ({ label: vscode.workspace.asRelativePath(f), uri: f } as any)), { placeHolder: 'Select .spnbank file' });
                if (!pick) return;
                bankUri = pick.uri;
                const doc = await vscode.workspace.openTextDocument(bankUri);
                const json = doc.getText() ? JSON.parse(doc.getText()) : {};
                const slots = Array.isArray(json.slots) ? json.slots : [];
                const slotItems = slots.map((s:any) => ({ label: `Program ${s.slot}`, slot: s.slot, path: s.path }));
                const pickSlot = await vscode.window.showQuickPick(slotItems as any, { placeHolder: 'Select slot to program' }) as (typeof slotItems)[0] | undefined;
                if (!pickSlot) return;
                slotNum = pickSlot.slot;
            }
            const doc = await vscode.workspace.openTextDocument(bankUri!);
            const json = doc.getText() ? JSON.parse(doc.getText()) : {};
            const entry = json.slots && json.slots[slotNum - 1];
            if (!entry || !entry.path) { vscode.window.showErrorMessage(`Slot ${slotNum} is unassigned`); return; }
            const bankDir = path.dirname(bankUri!.fsPath);
            const fsPath = path.isAbsolute(entry.path) ? entry.path : path.resolve(bankDir, entry.path);
            if (!fs.existsSync(fsPath)) { vscode.window.showErrorMessage(`File not found: ${fsPath}`); return; }
            const content = fs.readFileSync(fsPath, 'utf8');
            const assembler = new FV1Assembler({ fv1AsmMemBug: vscode.workspace.getConfiguration('fv1').get<boolean>('spinAsmMemBug') ?? true });
            outputWindow(outputChannel, `Assembling ${fsPath}...`);
            const result = assembler.assemble(content);
            const fileUri = vscode.Uri.file(fsPath);
            fv1Diagnostics.delete(fileUri);
            const newDiagnostics: Array<vscode.Diagnostic> = [];
            if (result.problems.length !== 0) {
                result.problems.forEach((p:any) => {
                    const range = new vscode.Range(p.line - 1, 0, p.line - 1, Number.MAX_SAFE_INTEGER);
                    const severity = p.isfatal ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
                    const diagnostic = new vscode.Diagnostic(range, p.message, severity);
                    diagnostic.source = 'fv1-assembler';
                    newDiagnostics.push(diagnostic);
                    outputWindow(outputChannel, `${p.isfatal ? 'Error' : 'Warning'}: ${p.message}`);
                });
                fv1Diagnostics.set(fileUri, newDiagnostics);
            }
            if (result.machineCode && result.machineCode.length > 0) {
                await programEeprom(result.machineCode, outputChannel, slotNum - 1);
            } else {
                outputWindow(outputChannel, `Assemble produced no machine code for slot ${slotNum}`);
            }
        } catch (e) { vscode.window.showErrorMessage(`Failed to program slot: ${e}`); }
    });

    const assembleCommand = vscode.commands.registerCommand('fv1.assemble', async () => { await assembleFV1(outputChannel, fv1Diagnostics); });
    const assembleAndProgramCommand = vscode.commands.registerCommand('fv1.assembleAndProgram', async () => { const result = await assembleFV1(outputChannel, fv1Diagnostics); if (result && result.machineCode.length > 0) await programEeprom(result.machineCode, outputChannel); });
    const assembleToHexCommand = vscode.commands.registerCommand('fv1.assembleToHex', async () => { const result = await assembleFV1(outputChannel, fv1Diagnostics); if (result && result.machineCode.length > 0) await outputIntelHexFile(result.machineCode, outputChannel); });

    context.subscriptions.push(
        createCmd,
        programAllCmd,
        unassignCmd,
        programThisSlotCmd,
        assembleCommand,
        assembleToHexCommand,
        assembleAndProgramCommand,
        spnBanksView,
        provider,
        outputChannel,
        fv1Diagnostics,
    );
}
