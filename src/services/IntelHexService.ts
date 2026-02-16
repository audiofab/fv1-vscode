import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OutputService } from './OutputService.js';
import { ProgrammerService } from './ProgrammerService.js';
import { AssemblyService } from './AssemblyService.js';
import { IntelHexParser } from '../hexParser.js';
import { FV1Assembler } from '../FV1Assembler.js';
import { getActiveDocumentUri } from '../utils/editor-utils.js';

const FV1_EEPROM_SLOT_SIZE_BYTES = 512;

export class IntelHexService {
    constructor(
        private outputService: OutputService,
        private programmerService: ProgrammerService,
        private assemblyService: AssemblyService
    ) {}

    public async outputIntelHexFile(machineCode: number[]): Promise<void> {
        const fileUri = getActiveDocumentUri();
        if (!fileUri) { 
            vscode.window.showErrorMessage('No active editor'); 
            return; 
        }
        
        const sourceFile = fileUri.fsPath;
        
        if (!sourceFile.endsWith('.spn') && !sourceFile.endsWith('.spndiagram')) { 
            vscode.window.showErrorMessage('Active file is not an FV-1 assembly file (.spn) or block diagram (.spndiagram)'); 
            return; 
        }
        
        const outputFile = sourceFile.replace(/\.(spn|spndiagram)$/, '.hex');

        const selectedSlot = await this.programmerService.selectProgramSlot();
        if (selectedSlot === undefined) { 
            vscode.window.showWarningMessage('No program slot was selected, aborting'); 
            return; 
        }

        try {
            this.outputService.log(`[INFO] 📄 Generating Intel HEX file for slot ${selectedSlot + 1}...`);
            const hexFileString = IntelHexParser.generate(Buffer.from(FV1Assembler.toUint8Array(machineCode)), selectedSlot * FV1_EEPROM_SLOT_SIZE_BYTES, 4);
            fs.writeFileSync(outputFile, hexFileString, 'utf8');
            if (fs.existsSync(outputFile)) { 
                this.outputService.log(`[SUCCESS] ✅ Intel HEX file saved: ${path.basename(outputFile)}`); 
                return; 
            }
            this.outputService.log(`[ERROR] ❌ Failed to save HEX file: ${path.basename(outputFile)}`);
            vscode.window.showErrorMessage('Failed to save HEX file');
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error creating Intel HEX file: ${error}`);
            vscode.window.showErrorMessage(`Error creating .hex file: ${error}`);
        }
    }

    public async exportBankToHex(item?: any): Promise<void> {
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
                this.outputService.log(`[INFO] 💾 Saving ${dirtyDocs.length} unsaved file(s)...`);
                for (const doc of dirtyDocs) {
                    const saved = await doc.save();
                    if (!saved) {
                        vscode.window.showErrorMessage(`Failed to save ${path.basename(doc.fileName)}. Export aborted.`);
                        return;
                    }
                }
            }
            
            const doc = await vscode.workspace.openTextDocument(bankUri);
            const json = doc.getText() ? JSON.parse(doc.getText()) : {};
            const slots = Array.isArray(json.slots) ? json.slots : [];
            
            const segments: Array<{data: Buffer, address: number}> = [];
            const bankDir = path.dirname(bankUri.fsPath);
            let processedSlots = 0;

            this.outputService.log(`[INFO] 📄 Starting bank export to Intel HEX format...`);

            for (const slot of slots) {
                if (!slot || !slot.path) continue;
                
                const fsPath = path.isAbsolute(slot.path) ? slot.path : path.resolve(bankDir, slot.path);
                
                if (!fs.existsSync(fsPath)) {
                    this.outputService.log(`[WARNING] ⚠ Skipping slot ${slot.slot}: file not found ${path.basename(fsPath)}`);
                    continue;
                }

                let content: string;
                const isBlockDiagram = fsPath.toLowerCase().endsWith('.spndiagram');
                
                if (isBlockDiagram) {
                    const assembly = await this.assemblyService.compileBlockDiagram(fsPath);
                    if (!assembly) {
                        this.outputService.log(`[ERROR] ❌ Skipping slot ${slot.slot}: failed to compile block diagram ${path.basename(fsPath)}`);
                        continue;
                    }
                    content = assembly;
                } else {
                    content = fs.readFileSync(fsPath, 'utf8');
                }

                const assembler = new FV1Assembler({ 
                    fv1AsmMemBug: vscode.workspace.getConfiguration('fv1').get<boolean>('spinAsmMemBug') ?? true,
                    clampReals: vscode.workspace.getConfiguration('fv1').get<boolean>('clampReals') ?? true,
                });
                
                this.outputService.log(`[INFO] 🔧 Assembling slot ${slot.slot}: ${path.basename(fsPath)}...`);
                const result = assembler.assemble(content);

                if (result.problems.some((p: any) => p.isfatal)) {
                    this.outputService.log(`[ERROR] ❌ Slot ${slot.slot} failed to assemble - skipping: ${path.basename(fsPath)}`);
                    result.problems.forEach((p: any) => {
                        if (p.isfatal) {
                            this.outputService.log(`[ERROR] ❌ ${p.message}`);
                        }
                    });
                    continue;
                }

                if (!result.machineCode || result.machineCode.length === 0) {
                    this.outputService.log(`[WARNING] ⚠ Slot ${slot.slot} produced no machine code - skipping: ${path.basename(fsPath)}`);
                    continue;
                }

                const machineCodeBuffer = Buffer.from(FV1Assembler.toUint8Array(result.machineCode));
                const slotAddress = (slot.slot - 1) * FV1_EEPROM_SLOT_SIZE_BYTES;
                segments.push({
                    data: machineCodeBuffer,
                    address: slotAddress
                });

                this.outputService.log(`[SUCCESS] ✅ Slot ${slot.slot} assembled successfully: ${path.basename(fsPath)}`);
                processedSlots++;
            }

            if (segments.length === 0) {
                vscode.window.showWarningMessage('No programs to export: All assigned slots are empty or failed to assemble.');
                this.outputService.log(`[WARNING] ⚠ No programs available for export.`);
                return;
            }

            const bankName = path.basename(bankUri.fsPath, '.spnbank');
            const outputFile = path.join(path.dirname(bankUri.fsPath), `${bankName}.hex`);

            this.outputService.log(`[INFO] 📄 Generating multi-segment Intel HEX file with ${segments.length} program(s)...`);
            const hexFileString = IntelHexParser.generateMultiSegment(segments, 16);
            
            fs.writeFileSync(outputFile, hexFileString, 'utf8');
            
            if (fs.existsSync(outputFile)) {
                this.outputService.log(`[SUCCESS] ✅ Bank exported to Intel HEX: ${path.basename(outputFile)}`);
                this.outputService.log(`[INFO] 📄 Export summary: ${segments.length} program(s) exported from ${processedSlots} assigned slot(s)`);
                vscode.window.showInformationMessage(`Bank exported successfully to ${path.basename(outputFile)}`);
            } else {
                this.outputService.log(`[ERROR] ❌ Failed to save HEX file: ${path.basename(outputFile)}`);
                vscode.window.showErrorMessage('Failed to save HEX file');
            }

        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error exporting bank to HEX: ${error}`);
            vscode.window.showErrorMessage(`Error exporting bank to HEX: ${error}`);
        }
    }
}
