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
import { SpnBankEditorProvider } from './SpnBankEditorProvider.js';
import { BlockDiagramEditorProvider } from './blockDiagram/editor/BlockDiagramEditorProvider.js';
import { FV1HoverProvider } from './fv1HoverProvider.js';
import { FV1DefinitionProvider } from './fv1DefinitionProvider.js';
import { FV1DocumentManager } from './fv1DocumentManager.js';
import { BlockDiagramDocumentManager } from './blockDiagram/BlockDiagramDocumentManager.js';
import { GraphCompiler } from './blockDiagram/compiler/GraphCompiler.js';
import { blockRegistry } from './blockDiagram/blocks/BlockRegistry.js';
import { BlockGraph } from './blockDiagram/types/Graph.js';
import { FV1QuickActionsProvider } from './FV1QuickActionsProvider.js';

const FV1_EEPROM_SLOT_SIZE_BYTES = 512; // Each FV-1 slot is 512 bytes

async function outputWindow(outputChannel: vscode.OutputChannel, message: string, isLine: boolean = true): Promise<void> {
    const config = vscode.workspace.getConfiguration('fv1');
    const showOutputWindow: boolean | undefined = config.get<boolean>('autoShowOutputWindow');
    if (showOutputWindow ?? true) outputChannel.show(true);
    isLine ? outputChannel.appendLine(message) : outputChannel.append(message);
}

/**
 * Compile a .spndiagram file to .spn assembly code
 * Returns the assembly code as a string, or null if compilation failed
 */
async function compileBlockDiagram(
    diagramPath: string, 
    outputChannel: vscode.OutputChannel,
    blockDiagramDocMgr: BlockDiagramDocumentManager
): Promise<string | null> {
    try {
        outputWindow(outputChannel, `[INFO] 🔧 Compiling block diagram ${path.basename(diagramPath)}...`);
        
        // Open or get the document
        const uri = vscode.Uri.file(diagramPath);
        let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
        if (!document) {
            document = await vscode.workspace.openTextDocument(uri);
        }
        
        // Use the document manager to get cached compilation result
        const result = blockDiagramDocMgr.getCompilationResult(document);
        
        if (result.success && result.assembly) {
            const stats = result.statistics!;
            outputWindow(outputChannel, 
                `[SUCCESS] ✅ Block diagram compiled successfully - ` +
                `Instructions: ${stats.instructionsUsed}/128, ` +
                `Registers: ${stats.registersUsed}/32, ` +
                `Memory: ${stats.memoryUsed}/32768`
            );
            
            // Show warnings if any
            if (result.warnings && result.warnings.length > 0) {
                result.warnings.forEach(warn => 
                    outputWindow(outputChannel, `[WARNING] ⚠ ${warn}`)
                );
            }
            
            return result.assembly;
        } else {
            const errors = result.errors || ['Unknown compilation error'];
            outputWindow(outputChannel, `[ERROR] ❌ Block diagram compilation failed:`);
            errors.forEach(err => outputWindow(outputChannel, `  • ${err}`));
            return null;
        }
    } catch (e) {
        outputWindow(outputChannel, `[ERROR] ❌ Failed to compile block diagram: ${e}`);
        return null;
    }
}

async function assembleFV1(
    outputChannel: vscode.OutputChannel, 
    documentManager: FV1DocumentManager,
    blockDiagramDocMgr: BlockDiagramDocumentManager
): Promise<FV1AssemblerResult | undefined> {
    const verbose: boolean = vscode.workspace.getConfiguration('fv1').get<boolean>('verbose') ?? false;

    // Try to get the active file - could be a text editor or custom editor
    let fileUri: vscode.Uri | undefined;
    let document: vscode.TextDocument | undefined;
    
    // First, try active text editor
    if (vscode.window.activeTextEditor) {
        document = vscode.window.activeTextEditor.document;
        fileUri = document.uri;
    } else {
        // If no text editor, try to get the active tab (for custom editors like .spndiagram)
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (activeTab?.input) {
            const input = activeTab.input as any;
            if (input.uri) {
                fileUri = input.uri;
            }
        }
    }
    
    if (!fileUri) {
        vscode.window.showErrorMessage('No active editor');
        return undefined;
    }
    
    const filePath = fileUri.fsPath;
    
    // Check if it's a block diagram file
    if (filePath.endsWith('.spndiagram')) {
        // Compile block diagram first
        const assembly = await compileBlockDiagram(filePath, outputChannel, blockDiagramDocMgr);
        if (!assembly) {
            return undefined;
        }
        
        // Create a temporary in-memory document with the assembly code
        const tempAssemblyDoc = await vscode.workspace.openTextDocument({
            content: assembly,
            language: 'fv1-assembly'
        });
        
        // Assemble the generated assembly code
        const result = documentManager.getAssemblyResult(tempAssemblyDoc);
        
        // Output any problems
        let hasErrors = false;
        if (result.problems.length > 0) {
            result.problems.forEach((p: any) => {
                const prefix = p.isfatal ? '[ERROR]' : '[WARNING]';
                const icon = p.isfatal ? '❌' : '⚠';
                outputWindow(outputChannel, `${prefix} ${icon} ${p.message}`);
                if (p.isfatal) {
                    hasErrors = true;
                }
            });
        }
        
        if (!hasErrors && result.machineCode && result.machineCode.length > 0) {
            if (verbose) {
                outputWindow(outputChannel, FV1Assembler.formatMachineCode(result.machineCode));
            }
            outputWindow(outputChannel, `[SUCCESS] ✅ Block diagram assembled successfully - ${path.basename(filePath)}`);
        } else if (hasErrors) {
            outputWindow(outputChannel, `[ERROR] ❌ Assembly failed with errors - ${path.basename(filePath)}`);
        }
        
        return result;
    }
    
    // Original .spn file handling
    if (!filePath.endsWith('.spn')) {
        vscode.window.showErrorMessage('Active file is not an FV-1 assembly file (.spn) or block diagram (.spndiagram)');
        return undefined;
    }
    
    // At this point we must have a document for .spn files
    if (!document) {
        // Try to find it in open documents
        document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri!.toString());
        if (!document) {
            vscode.window.showErrorMessage('Could not access document');
            return undefined;
        }
    }

    // Save the document if it has unsaved changes
    if (document.isDirty) {
        const saved = await document.save();
        if (!saved) {
            vscode.window.showErrorMessage('Failed to save document. Assembly aborted.');
            return undefined;
        }
        outputWindow(outputChannel, `[INFO] 💾 Saved ${path.basename(document.fileName)}`);
    }

    outputWindow(outputChannel, `[INFO] 🔧 Assembling ${path.basename(document.fileName)}...`);
    
    // Get the cached assembly result from document manager
    const result = documentManager.getAssemblyResult(document);
    
    // Output any problems to the output channel
    let hasErrors = false;
    if (result.problems.length > 0) {
        result.problems.forEach((p: any) => {
            const prefix = p.isfatal ? '[ERROR]' : '[WARNING]';
            const icon = p.isfatal ? '❌' : '⚠';
            outputWindow(outputChannel, `${prefix} ${icon} ${p.message}`);
            if (p.isfatal) {
                hasErrors = true;
            }
        });
    }

    // Add success message if no errors
    if (!hasErrors && result.machineCode && result.machineCode.length > 0) {
        if (verbose) {
            outputWindow(outputChannel, FV1Assembler.formatMachineCode(result.machineCode));
        }
        outputWindow(outputChannel, `[SUCCESS] ✅ Assembly completed successfully - ${path.basename(document.fileName)}`);
    } else if (hasErrors) {
        outputWindow(outputChannel, `[ERROR] ❌ Assembly failed with errors - ${path.basename(document.fileName)}`);
    } else if (!result.machineCode || result.machineCode.length === 0) {
        outputWindow(outputChannel, `[ERROR] ❌ Assembly produced no machine code - ${path.basename(document.fileName)}`);
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
            outputWindow(outputChannel, `[SUCCESS] ✅ Successfully wrote and verified program slot ${selectedSlot + 1}`);
        } else {
            outputWindow(outputChannel, `[SUCCESS] ✅ Successfully wrote to program slot ${selectedSlot + 1}`);
        }

    } catch (error) {
        outputWindow(outputChannel, `[ERROR] ❌ Error programming EEPROM: ${error}`);
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
    const outputFile = sourceFile.replace(/\.(spn)$/, '.hex');

    const selectedSlot = await selectProgramSlot();
    if (selectedSlot === undefined) { vscode.window.showWarningMessage('No program slot was selected, aborting'); return; }

    try {
        outputWindow(outputChannel, `[INFO] 📄 Generating Intel HEX file for slot ${selectedSlot + 1}...`);
        const hexFileString = IntelHexParser.generate(Buffer.from(FV1Assembler.toUint8Array(machineCode)), selectedSlot * FV1_EEPROM_SLOT_SIZE_BYTES, 4);
        fs.writeFileSync(outputFile, hexFileString, 'utf8');
        if (fs.existsSync(outputFile)) { 
            outputWindow(outputChannel, `[SUCCESS] ✅ Intel HEX file saved: ${path.basename(outputFile)}`); 
            return; 
        }
        outputWindow(outputChannel, `[ERROR] ❌ Failed to save HEX file: ${path.basename(outputFile)}`);
        vscode.window.showErrorMessage('Failed to save HEX file');
    } catch (error) {
        outputWindow(outputChannel, `[ERROR] ❌ Error creating Intel HEX file: ${error}`);
        vscode.window.showErrorMessage(`Error creating .hex file: ${error}`);
    }
}

/**
 * Load an Intel HEX file and program it to EEPROM
 */
async function loadHexToEeprom(outputChannel: vscode.OutputChannel): Promise<void> {
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
        outputWindow(outputChannel, `[INFO] 📄 Loading Intel HEX file: ${path.basename(hexFilePath)}...`);

        // Read the HEX file content
        const hexContent = fs.readFileSync(hexFilePath, 'utf8');

        // Validate the HEX file
        const validation = IntelHexParser.validateHex(hexContent);
        if (!validation.valid) {
            outputWindow(outputChannel, `[ERROR] ❌ Invalid Intel HEX file:`);
            validation.errors.forEach(error => {
                outputWindow(outputChannel, `[ERROR] ❌   ${error}`);
            });
            vscode.window.showErrorMessage('Invalid Intel HEX file. Check Output panel for details.');
            return;
        }

        // Parse the HEX file
        outputWindow(outputChannel, `[INFO] 🔧 Parsing Intel HEX file...`);
        const buffer = IntelHexParser.parse(hexContent);
        outputWindow(outputChannel, `[SUCCESS] ✅ Parsed ${buffer.length} bytes from Intel HEX file`);

        // Get MCP2221 device
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

        // Initialize I2C communication
        const hidDevice = await HID.HIDAsync.open(selectedDevice.path!);
        const source = new NodeHIDStreamSource(hidDevice);
        const device = new MCP2221(source);
        const bus = new I2CBusMCP2221(device);

        await device.common.status({ opaque: 'Speed-Setup-400', i2cClock: 400 });

        const abus = new I2CAddressedBus(bus, eepromAddress!);
        const eeprom = new EEPROM(abus, { writePageSize: pageSize! });

        // Program the EEPROM
        outputWindow(outputChannel, `[INFO] 📡 Programming EEPROM with ${buffer.length} bytes...`);
        const writeData = new Uint8Array(buffer);
        await eeprom.write(0, writeData); // Write starting at address 0

        // Verify if enabled
        if (verifyWrites) {
            outputWindow(outputChannel, `[INFO] 🔍 Verifying EEPROM contents...`);
            const verifyBuffer = await eeprom.read(0, buffer.length);
            const verifyArray = ArrayBuffer.isView(verifyBuffer) ?
                new Uint8Array((verifyBuffer as any).buffer, (verifyBuffer as any).byteOffset, (verifyBuffer as any).byteLength) :
                new Uint8Array(verifyBuffer as any, 0, (verifyBuffer as any).byteLength);

            let verificationFailed = false;
            for (let i = 0; i < writeData.length; i++) {
                if (writeData[i] !== verifyArray[i]) {
                    outputWindow(outputChannel, `[ERROR] ❌ Verification failed at address 0x${i.toString(16).toUpperCase().padStart(4, '0')}: expected 0x${writeData[i].toString(16).toUpperCase().padStart(2, '0')}, got 0x${verifyArray[i].toString(16).toUpperCase().padStart(2, '0')}`);
                    verificationFailed = true;
                    break;
                }
            }

            if (verificationFailed) {
                vscode.window.showErrorMessage('EEPROM verification failed. Check Output panel for details.');
                return;
            }

            outputWindow(outputChannel, `[SUCCESS] ✅ Successfully wrote and verified ${buffer.length} bytes to EEPROM`);
            vscode.window.showInformationMessage(`Successfully programmed ${buffer.length} bytes to EEPROM`);
        } else {
            outputWindow(outputChannel, `[SUCCESS] ✅ Successfully wrote ${buffer.length} bytes to EEPROM`);
            vscode.window.showInformationMessage(`Successfully programmed ${buffer.length} bytes to EEPROM`);
        }

    } catch (error) {
        outputWindow(outputChannel, `[ERROR] ❌ Error loading HEX file to EEPROM: ${error}`);
        vscode.window.showErrorMessage(`Error loading HEX file to EEPROM: ${error}`);
    }
}

/**
 * Backup all 8 program slots from the pedal's EEPROM to an Intel HEX file
 */
async function backupPedal(outputChannel: vscode.OutputChannel): Promise<void> {
    try {
        outputWindow(outputChannel, `[INFO] 💾 Starting pedal backup...`);

        // Get MCP2221 device
        const config = vscode.workspace.getConfiguration('fv1');
        let eepromAddress: number | undefined = config.get<number>('i2cAddress');
        let pageSize: number | undefined = config.get<number>('writePageSize');

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

        // Initialize I2C communication
        outputWindow(outputChannel, `[INFO] 🔌 Connecting to pedal...`);
        const hidDevice = await HID.HIDAsync.open(selectedDevice.path!);
        const source = new NodeHIDStreamSource(hidDevice);
        const device = new MCP2221(source);
        const bus = new I2CBusMCP2221(device);

        await device.common.status({ opaque: 'Speed-Setup-400', i2cClock: 400 });

        const abus = new I2CAddressedBus(bus, eepromAddress!);
        const eeprom = new EEPROM(abus, { writePageSize: pageSize! });

        // Read all 8 program slots (8 x 512 bytes = 4096 bytes)
        const totalBytes = 8 * FV1_EEPROM_SLOT_SIZE_BYTES;
        outputWindow(outputChannel, `[INFO] 📖 Reading ${totalBytes} bytes from EEPROM (8 program slots)...`);
        
        const readBuffer = await eeprom.read(0, totalBytes);
        const dataArray = ArrayBuffer.isView(readBuffer) ?
            new Uint8Array((readBuffer as any).buffer, (readBuffer as any).byteOffset, (readBuffer as any).byteLength) :
            new Uint8Array(readBuffer as any, 0, (readBuffer as any).byteLength);

        outputWindow(outputChannel, `[SUCCESS] ✅ Successfully read ${dataArray.length} bytes from EEPROM`);

        // Create segments for each program slot
        const segments: Array<{data: Buffer, address: number}> = [];
        for (let slot = 0; slot < 8; slot++) {
            const startOffset = slot * FV1_EEPROM_SLOT_SIZE_BYTES;
            const slotData = dataArray.slice(startOffset, startOffset + FV1_EEPROM_SLOT_SIZE_BYTES);
            segments.push({
                data: Buffer.from(slotData),
                address: startOffset
            });
            outputWindow(outputChannel, `[INFO] 📦 Prepared slot ${slot + 1} data (${FV1_EEPROM_SLOT_SIZE_BYTES} bytes at address 0x${startOffset.toString(16).toUpperCase().padStart(4, '0')})`);
        }

        // Prompt user for save location
        const defaultFileName = `pedal-backup-${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.hex`;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.';
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(workspaceFolder, defaultFileName)),
            filters: {
                'Intel HEX files': ['hex'],
                'All files': ['*']
            },
            saveLabel: 'Save Backup'
        });

        if (!saveUri) {
            outputWindow(outputChannel, `[WARNING] ⚠ Backup cancelled by user`);
            return;
        }

        // Generate multi-segment Intel HEX file
        outputWindow(outputChannel, `[INFO] 📄 Generating Intel HEX file...`);
        const hexFileString = IntelHexParser.generateMultiSegment(segments, 16);

        // Write the file
        fs.writeFileSync(saveUri.fsPath, hexFileString, 'utf8');

        if (fs.existsSync(saveUri.fsPath)) {
            outputWindow(outputChannel, `[SUCCESS] ✅ Pedal backup saved to: ${path.basename(saveUri.fsPath)}`);
            outputWindow(outputChannel, `[INFO] 📄 Backup contains all 8 program slots (${totalBytes} bytes total)`);
            vscode.window.showInformationMessage(`Pedal backup successfully saved to ${path.basename(saveUri.fsPath)}`);
            
            // Ask if user wants to open the file
            const openFile = await vscode.window.showInformationMessage(
                'Backup complete! Would you like to open the backup file?',
                'Open File',
                'Close'
            );
            
            if (openFile === 'Open File') {
                const doc = await vscode.workspace.openTextDocument(saveUri);
                await vscode.window.showTextDocument(doc);
            }
        } else {
            outputWindow(outputChannel, `[ERROR] ❌ Failed to save backup file: ${path.basename(saveUri.fsPath)}`);
            vscode.window.showErrorMessage('Failed to save backup file');
        }

    } catch (error) {
        outputWindow(outputChannel, `[ERROR] ❌ Error backing up pedal: ${error}`);
        vscode.window.showErrorMessage(`Error backing up pedal: ${error}`);
    }
}

/**
 * Export an entire .spnbank to a multi-segment Intel HEX file
 */
async function exportBankToHex(
    outputChannel: vscode.OutputChannel, 
    blockDiagramDocMgr: BlockDiagramDocumentManager,
    item?: any
): Promise<void> {
    try {
        const files = item && item.resourceUri ? [item.resourceUri] : await vscode.workspace.findFiles('**/*.spnbank', '**/node_modules/**');
        if (!files || files.length === 0) { 
            vscode.window.showErrorMessage('No .spnbank files found'); 
            return; 
        }

        let bankUri: vscode.Uri;
        if (files.length === 1) {
            bankUri = files[0];
        } else {
            const pick = await vscode.window.showQuickPick(
                files.map(f => ({ label: vscode.workspace.asRelativePath(f), uri: f })), 
                { placeHolder: 'Select .spnbank file to export' }
            );
            if (!pick) return;
            bankUri = pick.uri;
        }

        // Save all dirty .spn and .spndiagram files before assembling
        const dirtyDocs = vscode.workspace.textDocuments.filter(doc => 
            doc.isDirty && (doc.fileName.endsWith('.spn') || doc.fileName.endsWith('.spndiagram'))
        );
        if (dirtyDocs.length > 0) {
            outputWindow(outputChannel, `[INFO] 💾 Saving ${dirtyDocs.length} unsaved file(s)...`);
            for (const doc of dirtyDocs) {
                const saved = await doc.save();
                if (!saved) {
                    vscode.window.showErrorMessage(`Failed to save ${path.basename(doc.fileName)}. Export aborted.`);
                    return;
                }
            }
        }
        
        // Read and parse the bank file
        const doc = await vscode.workspace.openTextDocument(bankUri);
        const json = doc.getText() ? JSON.parse(doc.getText()) : {};
        const slots = Array.isArray(json.slots) ? json.slots : [];
        
        // Collect segments for multi-segment HEX generation
        const segments: Array<{data: Buffer, address: number}> = [];
        const bankDir = path.dirname(bankUri.fsPath);
        let processedSlots = 0;

        outputWindow(outputChannel, `[INFO] 📄 Starting bank export to Intel HEX format...`);

        for (const slot of slots) {
            if (!slot || !slot.path) continue; // Skip unassigned slots
            
            const fsPath = path.isAbsolute(slot.path) ? slot.path : path.resolve(bankDir, slot.path);
            
            if (!fs.existsSync(fsPath)) {
                outputWindow(outputChannel, `[WARNING] ⚠ Skipping slot ${slot.slot}: file not found ${path.basename(fsPath)}`);
                continue;
            }

            // Handle .spndiagram files - compile them first
            let content: string;
            const isBlockDiagram = fsPath.toLowerCase().endsWith('.spndiagram');
            
            if (isBlockDiagram) {
                const assembly = await compileBlockDiagram(fsPath, outputChannel, blockDiagramDocMgr);
                if (!assembly) {
                    outputWindow(outputChannel, `[ERROR] ❌ Skipping slot ${slot.slot}: failed to compile block diagram ${path.basename(fsPath)}`);
                    continue;
                }
                content = assembly;
            } else {
                content = fs.readFileSync(fsPath, 'utf8');
            }

            // Assemble the program
            const assembler = new FV1Assembler({ 
                fv1AsmMemBug: vscode.workspace.getConfiguration('fv1').get<boolean>('spinAsmMemBug') ?? true 
            });
            
            outputWindow(outputChannel, `[INFO] 🔧 Assembling slot ${slot.slot}: ${path.basename(fsPath)}...`);
            const result = assembler.assemble(content);

            // Check for assembly errors
            if (result.problems.some((p: any) => p.isfatal)) {
                outputWindow(outputChannel, `[ERROR] ❌ Slot ${slot.slot} failed to assemble - skipping: ${path.basename(fsPath)}`);
                result.problems.forEach((p: any) => {
                    if (p.isfatal) {
                        outputWindow(outputChannel, `[ERROR] ❌ ${p.message}`);
                    }
                });
                continue;
            }

            if (!result.machineCode || result.machineCode.length === 0) {
                outputWindow(outputChannel, `[WARNING] ⚠ Slot ${slot.slot} produced no machine code - skipping: ${path.basename(fsPath)}`);
                continue;
            }

            // Add this slot to the segments
            const machineCodeBuffer = Buffer.from(FV1Assembler.toUint8Array(result.machineCode));
            const slotAddress = (slot.slot - 1) * FV1_EEPROM_SLOT_SIZE_BYTES;
            segments.push({
                data: machineCodeBuffer,
                address: slotAddress
            });

            outputWindow(outputChannel, `[SUCCESS] ✅ Slot ${slot.slot} assembled successfully: ${path.basename(fsPath)}`);
            processedSlots++;
        }

        if (segments.length === 0) {
            vscode.window.showWarningMessage('No programs to export: All assigned slots are empty or failed to assemble.');
            outputWindow(outputChannel, `[WARNING] ⚠ No programs available for export.`);
            return;
        }

        // Generate the output filename
        const bankName = path.basename(bankUri.fsPath, '.spnbank');
        const outputFile = path.join(path.dirname(bankUri.fsPath), `${bankName}.hex`);

        // Generate multi-segment Intel HEX file
        outputWindow(outputChannel, `[INFO] 📄 Generating multi-segment Intel HEX file with ${segments.length} program(s)...`);
        const hexFileString = IntelHexParser.generateMultiSegment(segments, 16);
        
        // Write the file
        fs.writeFileSync(outputFile, hexFileString, 'utf8');
        
        if (fs.existsSync(outputFile)) {
            outputWindow(outputChannel, `[SUCCESS] ✅ Bank exported to Intel HEX: ${path.basename(outputFile)}`);
            outputWindow(outputChannel, `[INFO] 📄 Export summary: ${segments.length} program(s) exported from ${processedSlots} assigned slot(s)`);
            vscode.window.showInformationMessage(`Bank exported successfully to ${path.basename(outputFile)}`);
        } else {
            outputWindow(outputChannel, `[ERROR] ❌ Failed to save HEX file: ${path.basename(outputFile)}`);
            vscode.window.showErrorMessage('Failed to save HEX file');
        }

    } catch (error) {
        outputWindow(outputChannel, `[ERROR] ❌ Error exporting bank to HEX: ${error}`);
        vscode.window.showErrorMessage(`Error exporting bank to HEX: ${error}`);
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
    const blockDiagramDiagnostics = vscode.languages.createDiagnosticCollection('block-diagram');

    // Create centralized document manager for .spn files
    const documentManager = new FV1DocumentManager(fv1Diagnostics);
    
    // Create centralized document manager for .spndiagram files
    const blockDiagramDocumentManager = new BlockDiagramDocumentManager(blockDiagramDiagnostics, blockRegistry);
    
    // Register Quick Actions view
    const quickActionsProvider = new FV1QuickActionsProvider();
    const quickActionsView = vscode.window.createTreeView('fv1-quick-actions', {
        treeDataProvider: quickActionsProvider
    });
    context.subscriptions.push(quickActionsView);
    
    // Create status bar items for block diagram resource usage
    const instructionsStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 103);
    const registersStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
    const memoryStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    
    instructionsStatusBar.tooltip = 'FV-1 Instructions Used';
    registersStatusBar.tooltip = 'FV-1 Registers Used';
    memoryStatusBar.tooltip = 'FV-1 Delay Memory Used';
    
    context.subscriptions.push(instructionsStatusBar, registersStatusBar, memoryStatusBar);
    
    // Function to update status bar items
    const updateStatusBar = (document: vscode.TextDocument | undefined) => {
        if (!document) {
            instructionsStatusBar.hide();
            registersStatusBar.hide();
            memoryStatusBar.hide();
            return;
        }
        
        const fileName = document.fileName.toLowerCase();
        let stats: { instructionsUsed: number; registersUsed: number; memoryUsed: number } | undefined;
        
        // Get stats based on file type
        if (fileName.endsWith('.spndiagram')) {
            const result = blockDiagramDocumentManager.getCompilationResult(document);
            if (result.success && result.statistics) {
                stats = result.statistics;
            }
        } else if (fileName.endsWith('.spn')) {
            const result = documentManager.getAssemblyResult(document);
            // For .spn files, calculate stats from the assembly result
            if (result.machineCode && result.machineCode.length > 0) {
                // Count actual instructions (exclude NOP padding)
                const NOP_ENCODING = 0x00000011;
                const instructionCount = result.machineCode.filter(code => code !== NOP_ENCODING).length;
                
                stats = {
                    instructionsUsed: instructionCount,
                    registersUsed: 0, // .spn files don't track register usage
                    memoryUsed: result.memories.reduce((total, mem) => total + mem.size, 0)
                };
            }
        }
        
        if (!stats) {
            instructionsStatusBar.hide();
            registersStatusBar.hide();
            memoryStatusBar.hide();
            return;
        }
        
        // Instructions: 128 max
        instructionsStatusBar.text = `$(circuit-board) ${stats.instructionsUsed}/128`;
        const instructionsPercent = stats.instructionsUsed / 128;
        if (stats.instructionsUsed > 128) {
            instructionsStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (instructionsPercent >= 0.8) {
            instructionsStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            instructionsStatusBar.backgroundColor = undefined;
        }
        instructionsStatusBar.show();
        
        // Registers: 32 max (only show if we have register info)
        if (stats.registersUsed > 0 || fileName.endsWith('.spndiagram')) {
            registersStatusBar.text = `$(database) ${stats.registersUsed}/32`;
            const registersPercent = stats.registersUsed / 32;
            if (stats.registersUsed > 32) {
                registersStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else if (registersPercent >= 0.8) {
                registersStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else {
                registersStatusBar.backgroundColor = undefined;
            }
            registersStatusBar.show();
        } else {
            registersStatusBar.hide();
        }
        
        // Memory: 32768 max
        memoryStatusBar.text = `$(pulse) ${stats.memoryUsed}/32768`;
        const memoryPercent = stats.memoryUsed / 32768;
        if (stats.memoryUsed > 32768) {
            memoryStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (memoryPercent >= 0.8) {
            memoryStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            memoryStatusBar.backgroundColor = undefined;
        }
        memoryStatusBar.show();
    };
    
    // Helper to get active document URI (works for both text editors and custom editors)
    const getActiveDocumentUri = (): vscode.Uri | undefined => {
        // First try active text editor
        if (vscode.window.activeTextEditor) {
            return vscode.window.activeTextEditor.document.uri;
        }
        
        // If no text editor, try to get from active tab (for custom editors)
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (activeTab?.input) {
            const input = activeTab.input as any;
            if (input.uri) {
                return input.uri;
            }
        }
        
        return undefined;
    };
    
    // Update status bar when active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            updateStatusBar(editor?.document);
        }),
        vscode.window.tabGroups.onDidChangeTabGroups(() => {
            // Also update when active tab changes (for custom editors)
            const uri = getActiveDocumentUri();
            if (uri) {
                const fileName = uri.fsPath.toLowerCase();
                if (fileName.endsWith('.spndiagram') || fileName.endsWith('.spn')) {
                    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
                    if (doc) {
                        updateStatusBar(doc);
                    }
                }
            }
        })
    );
    
    // Update status bar when compilation changes (for .spndiagram files)
    blockDiagramDocumentManager.onCompilationChange((uri) => {
        const activeUri = getActiveDocumentUri();
        if (activeUri && activeUri.toString() === uri.toString()) {
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
            if (doc) {
                updateStatusBar(doc);
            }
        }
    });
    
    // Update status bar when .spn documents change
    documentManager.addChangeListener((uri: vscode.Uri) => {
        const activeUri = getActiveDocumentUri();
        if (activeUri && activeUri.toString() === uri.toString()) {
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
            if (doc) {
                updateStatusBar(doc);
            }
        }
    });
    
    // Initial update
    updateStatusBar(vscode.window.activeTextEditor?.document);
    
    // Register virtual document provider for assembly view
    const assemblyDocumentProvider = new class implements vscode.TextDocumentContentProvider {
        onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
        onDidChange = this.onDidChangeEmitter.event;
        
        provideTextDocumentContent(uri: vscode.Uri): string {
            // Extract the original .spndiagram path from the virtual URI
            const diagramPath = uri.path.replace(/\.spn$/, '');
            const diagramUri = vscode.Uri.file(diagramPath);
            
            // Find the diagram document
            const diagramDoc = vscode.workspace.textDocuments.find(
                doc => doc.uri.toString() === diagramUri.toString()
            );
            
            if (!diagramDoc) {
                return '; Unable to find source diagram document';
            }
            
            // Get compilation result
            const result = blockDiagramDocumentManager.getCompilationResult(diagramDoc);
            if (result.success && result.assembly) {
                return result.assembly;
            } else {
                const errors = result.errors?.map(e => `; ${e}`).join('\n') || '; Unknown error';
                return `; Compilation failed:\n${errors}`;
            }
        }
    };
    
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('fv1-assembly', assemblyDocumentProvider)
    );
    
    // Update virtual assembly documents when compilation changes
    blockDiagramDocumentManager.onCompilationChange((uri) => {
        const virtualUri = vscode.Uri.parse(`fv1-assembly:${uri.fsPath}.spn`);
        assemblyDocumentProvider.onDidChangeEmitter.fire(virtualUri);
    });
    
    // Register hover provider for FV-1 assembly files (both file and virtual schemes)
    const fv1HoverProvider = new FV1HoverProvider(documentManager);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'fv1-assembly', scheme: 'file' },
            fv1HoverProvider
        ),
        vscode.languages.registerHoverProvider(
            { language: 'fv1-assembly', scheme: 'fv1-assembly' },
            fv1HoverProvider
        )
    );
    
    // Register definition provider for FV-1 assembly files (Ctrl+Click navigation)
    const fv1DefinitionProvider = new FV1DefinitionProvider(documentManager);
    const definitionProvider = vscode.languages.registerDefinitionProvider(
        { language: 'fv1-assembly', scheme: 'file' },
        fv1DefinitionProvider
    );
    context.subscriptions.push(definitionProvider);
    
    // Setup document event listeners for live diagnostics
    const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
        documentManager.onDocumentOpen(document);
        blockDiagramDocumentManager.onDocumentChange(document);
    });
    
    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
        documentManager.onDocumentChange(event.document);
        blockDiagramDocumentManager.onDocumentChange(event.document);
    });
    
    const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument((document) => {
        documentManager.onDocumentClose(document);
        if (document.fileName.toLowerCase().endsWith('.spndiagram')) {
            blockDiagramDocumentManager.clearCache(document.uri);
        }
    });
    
    // Process already open documents
    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'fv1-assembly') {
            documentManager.onDocumentOpen(document);
        }
        if (document.fileName.toLowerCase().endsWith('.spndiagram')) {
            blockDiagramDocumentManager.onDocumentChange(document);
        }
    }
    
    // Listen for configuration changes
    const onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('fv1.spinAsmMemBug')) {
            documentManager.refreshAll();
        }
    });
    
    context.subscriptions.push(
        onDidOpenTextDocument,
        onDidChangeTextDocument,
        onDidCloseTextDocument,
        onDidChangeConfiguration
    );

    // Register custom editor for .spnbank files
    context.subscriptions.push(
        SpnBankEditorProvider.register(context)
    );

    const createCmd = vscode.commands.registerCommand('fv1.createSpnBank', async () => {
        const uris = await vscode.window.showSaveDialog({ filters: { 'Easy Spin Bank': ['spnbank'] }, defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '.', 'new.spnbank')) });
        if (!uris) return;
        const content = JSON.stringify({ slots: Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, path: '' })) }, null, 2);
        await vscode.workspace.fs.writeFile(uris, Buffer.from(content, 'utf8'));
        // Open the newly created bank file in the custom editor
        await vscode.commands.executeCommand('vscode.open', uris);
    });

    const createBlockDiagramCmd = vscode.commands.registerCommand('fv1.createBlockDiagram', async () => {
        const saveUri = await vscode.window.showSaveDialog({
            filters: { 'FV-1 Block Diagram': ['spndiagram'] },
            defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.', 'new.spndiagram'))
        });
        
        if (!saveUri) return;
        
        try {
            // Read the default template
            const templatePath = path.join(context.extensionPath, 'resources', 'templates', 'default-diagram.json');
            let templateContent = fs.readFileSync(templatePath, 'utf8');
            
            // Parse and update the diagram name
            const diagram = JSON.parse(templateContent);
            diagram.metadata.name = path.basename(saveUri.fsPath, '.spndiagram');
            
            // Write the diagram to the new file
            const content = JSON.stringify(diagram, null, 2);
            await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));
            
            // Open the newly created file with the custom editor
            await vscode.commands.executeCommand('vscode.openWith', saveUri, 'fv1.blockDiagramEditor');
            
            vscode.window.showInformationMessage(`Created new block diagram: ${path.basename(saveUri.fsPath)}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create block diagram: ${error}`);
            console.error('Error creating block diagram:', error);
        }
    });

    const programAllCmd = vscode.commands.registerCommand('fv1.programSpnBank', async (item?: any) => {
        const files = item && item.resourceUri ? [item.resourceUri] : await vscode.workspace.findFiles('**/*.spnbank', '**/node_modules/**');
        if (!files || files.length === 0) { vscode.window.showErrorMessage('No .spnbank files found'); return; }
        
        // Save all dirty .spn and .spndiagram files before assembling
        const dirtyDocs = vscode.workspace.textDocuments.filter(doc => 
            doc.isDirty && (doc.fileName.endsWith('.spn') || doc.fileName.endsWith('.spndiagram'))
        );
        if (dirtyDocs.length > 0) {
            outputWindow(outputChannel, `[INFO] 💾 Saving ${dirtyDocs.length} unsaved file(s)...`);
            for (const doc of dirtyDocs) {
                const saved = await doc.save();
                if (!saved) {
                    vscode.window.showErrorMessage(`Failed to save ${path.basename(doc.fileName)}. Programming aborted.`);
                    return;
                }
            }
        }
        
        // First phase: Assemble all programs and collect results
        const programsToDownload: Array<{ machineCode: number[], slotIndex: number, filePath: string }> = [];
        let hasAssemblyErrors = false;
        
        outputWindow(outputChannel, `Starting assembly phase for ${files.length} bank file(s)...`);
        
        for (const file of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const json = doc.getText() ? JSON.parse(doc.getText()) : {};
                const slots = Array.isArray(json.slots) ? json.slots : [];
                
                for (const s of slots) {
                    if (!s || !s.path) { continue; }
                    const bankDir = path.dirname(file.fsPath);
                    const fsPath = path.isAbsolute(s.path) ? s.path : path.resolve(bankDir, s.path);
                    
                    if (!fs.existsSync(fsPath)) { 
                        outputWindow(outputChannel, `[ERROR] ❌ Skipping slot ${s.slot}: file not found ${path.basename(fsPath)}`); 
                        hasAssemblyErrors = true;
                        continue; 
                    }
                    
                    const fileUri = vscode.Uri.file(fsPath);
                    const isBlockDiagram = fsPath.toLowerCase().endsWith('.spndiagram');
                    
                    // Open the document to ensure it's properly loaded
                    let programDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri.toString());
                    if (!programDoc) {
                        programDoc = await vscode.workspace.openTextDocument(fileUri);
                    }
                    
                    // Handle .spndiagram files - compile them first
                    let result: FV1AssemblerResult;
                    
                    if (isBlockDiagram) {
                        const assembly = await compileBlockDiagram(fsPath, outputChannel, blockDiagramDocumentManager);
                        if (!assembly) {
                            outputWindow(outputChannel, `[ERROR] ❌ Skipping slot ${s.slot}: failed to compile block diagram ${path.basename(fsPath)}`);
                            hasAssemblyErrors = true;
                            continue;
                        }
                        // Assemble the compiled output
                        const assembler = new FV1Assembler({ fv1AsmMemBug: vscode.workspace.getConfiguration('fv1').get<boolean>('spinAsmMemBug') ?? true });
                        outputWindow(outputChannel, `[INFO] 🔧 Assembling compiled block diagram for slot ${s.slot}...`);
                        result = assembler.assemble(assembly);
                    } else {
                        // Use the document manager for proper assembly with full context
                        outputWindow(outputChannel, `[INFO] 🔧 Assembling slot ${s.slot}: ${path.basename(fsPath)}...`);
                        result = documentManager.getAssemblyResult(programDoc);
                    }
                    
                    // Process diagnostics
                    fv1Diagnostics.delete(fileUri);
                    const newDiagnostics: Array<vscode.Diagnostic> = [];
                    
                    if (result.problems.length !== 0) {
                        result.problems.forEach((p: any) => {
                            const range = new vscode.Range(p.line - 1, 0, p.line - 1, Number.MAX_SAFE_INTEGER);
                            const severity = p.isfatal ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
                            const diagnostic = new vscode.Diagnostic(range, p.message, severity);
                            diagnostic.source = 'fv1-assembler';
                            newDiagnostics.push(diagnostic);
                            const prefix = p.isfatal ? '[ERROR]' : '[WARNING]';
                            const icon = p.isfatal ? '❌' : '⚠';
                            outputWindow(outputChannel, `${prefix} ${icon} ${p.message}`);
                            if (p.isfatal) {
                                hasAssemblyErrors = true;
                            }
                        });
                        fv1Diagnostics.set(fileUri, newDiagnostics);
                    }
                    
                    // Store successfully assembled programs
                    if (result.machineCode && result.machineCode.length > 0 && !result.problems.some((p: any) => p.isfatal)) {
                        programsToDownload.push({
                            machineCode: result.machineCode,
                            slotIndex: s.slot - 1,
                            filePath: fsPath
                        });
                        outputWindow(outputChannel, `[SUCCESS] ✅ Slot ${s.slot} assembled successfully - ${path.basename(fsPath)}`);
                    } else if (result.problems.some((p: any) => p.isfatal)) {
                        outputWindow(outputChannel, `[ERROR] ❌ Slot ${s.slot} failed to assemble due to errors - ${path.basename(fsPath)}`);
                    } else {
                        outputWindow(outputChannel, `[ERROR] ❌ Slot ${s.slot} produced no machine code - ${path.basename(fsPath)}`);
                    }
                }
            } catch (e) {
                outputWindow(outputChannel, `[ERROR] ❌ Error processing bank file ${path.basename(file.fsPath)}: ${e}`);
                hasAssemblyErrors = true;
            }
        }
        
        // Check if we can proceed to programming phase
        if (hasAssemblyErrors) {
            vscode.window.showErrorMessage('Programming aborted: One or more programs failed to assemble. Check the Output panel for details.');
            outputWindow(outputChannel, `[ERROR] ❌ Assembly phase completed with errors. Programming aborted.`);
            return;
        }
        
        if (programsToDownload.length === 0) {
            vscode.window.showWarningMessage('No programs to download: All assigned slots are empty or failed to assemble.');
            outputWindow(outputChannel, `[WARNING] ⚠ No programs available for download.`);
            return;
        }
        
        // Second phase: Program all successfully assembled code
        outputWindow(outputChannel, `[SUCCESS] ✅ Assembly phase completed successfully. Programming ${programsToDownload.length} program(s)...`);
        
        for (const program of programsToDownload) {
            try {
                outputWindow(outputChannel, `[INFO] 📡 Programming slot ${program.slotIndex + 1}: ${path.basename(program.filePath)}...`);
                await programEeprom(program.machineCode, outputChannel, program.slotIndex);
                outputWindow(outputChannel, `[SUCCESS] ✅ Slot ${program.slotIndex + 1} programmed successfully - ${path.basename(program.filePath)}`);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to program slot ${program.slotIndex + 1}: ${e}`);
                outputWindow(outputChannel, `[ERROR] ❌ Failed to program slot ${program.slotIndex + 1}: ${e}`);
            }
        }
        
        outputWindow(outputChannel, `[SUCCESS] ✅ Programming phase completed.`);
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
            // File will auto-update in the custom editor
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
            if (!entry || !entry.path) { 
                outputWindow(outputChannel, `[ERROR] ❌ Slot ${slotNum} is unassigned`);
                vscode.window.showErrorMessage(`Slot ${slotNum} is unassigned`); 
                return; 
            }
            
            const bankDir = path.dirname(bankUri!.fsPath);
            const fsPath = path.isAbsolute(entry.path) ? entry.path : path.resolve(bankDir, entry.path);
            if (!fs.existsSync(fsPath)) { 
                outputWindow(outputChannel, `[ERROR] ❌ File not found: ${fsPath}`);
                vscode.window.showErrorMessage(`File not found: ${fsPath}`); 
                return; 
            }
            
            const fileUri = vscode.Uri.file(fsPath);
            const isBlockDiagram = fsPath.toLowerCase().endsWith('.spndiagram');
            
            // Open the document to ensure it's properly loaded
            let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
            if (!document) {
                document = await vscode.workspace.openTextDocument(fileUri);
            }
            
            // Save if dirty
            if (document.isDirty) {
                outputWindow(outputChannel, `[INFO] 💾 Saving ${path.basename(fsPath)}...`);
                const saved = await document.save();
                if (!saved) {
                    vscode.window.showErrorMessage(`Failed to save ${path.basename(fsPath)}. Programming aborted.`);
                    return;
                }
            }
            
            // Handle .spndiagram files - compile them first
            let result: FV1AssemblerResult;
            
            if (isBlockDiagram) {
                const assembly = await compileBlockDiagram(fsPath, outputChannel, blockDiagramDocumentManager);
                if (!assembly) {
                    vscode.window.showErrorMessage(`Failed to compile block diagram: ${path.basename(fsPath)}`);
                    return;
                }
                // Assemble the compiled output
                const assembler = new FV1Assembler({ fv1AsmMemBug: vscode.workspace.getConfiguration('fv1').get<boolean>('spinAsmMemBug') ?? true });
                outputWindow(outputChannel, `[INFO] 🔧 Assembling compiled block diagram for slot ${slotNum}...`);
                result = assembler.assemble(assembly);
            } else {
                // Use the document manager for proper assembly with full context
                outputWindow(outputChannel, `[INFO] 🔧 Assembling ${path.basename(fsPath)} for slot ${slotNum}...`);
                result = documentManager.getAssemblyResult(document);
            }
            
            // Handle diagnostics and output
            if (result.problems.length !== 0) {
                result.problems.forEach((p:any) => {
                    outputWindow(outputChannel, `${p.isfatal ? '[ERROR] ❌' : '[WARNING] ⚠'} ${p.message}`);
                });
            }
            
            if (result.machineCode && result.machineCode.length > 0) {
                outputWindow(outputChannel, `[SUCCESS] ✅ Assembly completed for slot ${slotNum}`);
                await programEeprom(result.machineCode, outputChannel, slotNum - 1);
            } else {
                outputWindow(outputChannel, `[ERROR] ❌ Assembly produced no machine code for slot ${slotNum}`);
            }
        } catch (e) { 
            outputWindow(outputChannel, `[ERROR] ❌ Failed to program slot: ${e}`);
            vscode.window.showErrorMessage(`Failed to program slot: ${e}`); 
        }
    });

    const assembleCommand = vscode.commands.registerCommand('fv1.assemble', async () => { await assembleFV1(outputChannel, documentManager, blockDiagramDocumentManager); });
    const assembleAndProgramCommand = vscode.commands.registerCommand('fv1.assembleAndProgram', async () => { const result = await assembleFV1(outputChannel, documentManager, blockDiagramDocumentManager); if (result && result.machineCode.length > 0) await programEeprom(result.machineCode, outputChannel); });
    const assembleToHexCommand = vscode.commands.registerCommand('fv1.assembleToHex', async () => { const result = await assembleFV1(outputChannel, documentManager, blockDiagramDocumentManager); if (result && result.machineCode.length > 0) await outputIntelHexFile(result.machineCode, outputChannel); });
    const exportBankToHexCommand = vscode.commands.registerCommand('fv1.exportBankToHex', async (item?: any) => { await exportBankToHex(outputChannel, blockDiagramDocumentManager, item); });
    const loadHexToEepromCommand = vscode.commands.registerCommand('fv1.loadHexToEeprom', async () => { await loadHexToEeprom(outputChannel); });
    const backupPedalCommand = vscode.commands.registerCommand('fv1.backupPedal', async () => { await backupPedal(outputChannel); });

    // Register block diagram editor
    const blockDiagramEditorProvider = BlockDiagramEditorProvider.register(context, blockDiagramDocumentManager);

    context.subscriptions.push(
        createCmd,
        createBlockDiagramCmd,
        programAllCmd,
        unassignCmd,
        programThisSlotCmd,
        assembleCommand,
        assembleToHexCommand,
        assembleAndProgramCommand,
        exportBankToHexCommand,
        loadHexToEepromCommand,
        backupPedalCommand,
        blockDiagramEditorProvider,
        outputChannel,
        fv1Diagnostics,
    );
}
