import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OutputService } from './OutputService.js';
import { ProgrammerService } from './ProgrammerService.js';
import { IntelHexParser, FV1Assembler } from '@audiofab-io/fv1-core';
import { getActiveDocumentUri } from '../core/editor-utils.js';

const FV1_EEPROM_SLOT_SIZE_BYTES = 512;

export class IntelHexService {
    constructor(
        private outputService: OutputService,
        private programmerService: ProgrammerService,
    ) { }

    /**
     * Write the assembled program out as a raw 512-byte FV-1 binary
     * (`.bin`).  This is the format consumed by the Easy Spin LV2
     * plugin's "Program File" picker (and any other tool that wants
     * the raw EEPROM-slot contents — no Intel HEX wrapper, no offset).
     * Programs shorter than 128 instructions are zero-padded to 512
     * bytes so the output is always a single full slot.
     */
    public async outputBinFile(machineCode: number[]): Promise<void> {
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

        const outputFile = sourceFile.replace(/\.(spn|spndiagram)$/, '.bin');

        try {
            this.outputService.log(`[INFO] 📄 Generating .bin file...`);

            const bytes  = FV1Assembler.toUint8Array(machineCode);
            const padded = Buffer.alloc(FV1_EEPROM_SLOT_SIZE_BYTES, 0);
            bytes.subarray(0, Math.min(bytes.length, FV1_EEPROM_SLOT_SIZE_BYTES)).forEach((v, i) => {
                padded[i] = v;
            });

            fs.writeFileSync(outputFile, padded);
            if (fs.existsSync(outputFile)) {
                this.outputService.log(`[SUCCESS] ✅ Binary saved: ${path.basename(outputFile)} (${padded.length} bytes)`);
                return;
            }
            this.outputService.log(`[ERROR] ❌ Failed to save binary file: ${path.basename(outputFile)}`);
            vscode.window.showErrorMessage('Failed to save .bin file');
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error creating .bin file: ${error}`);
            vscode.window.showErrorMessage(`Error creating .bin file: ${error}`);
        }
    }

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

    /**
     * Write a set of already-assembled bank slots out as one multi-segment
     * Intel HEX file.
     *
     * **Sparse by design**: only the slots passed in become segments, so an
     * unassigned slot leaves whatever is already in that region of the pedal's
     * EEPROM untouched when the file is flashed. Deciding which slots are
     * assigned (and refusing to export a bank that does not assemble cleanly)
     * is the caller's job; this serialises exactly what it is given.
     */
    public async exportSlotsToHex(
        slots: Array<{ index: number; machineCode: number[] }>,
        defaultFileName: string,
        defaultDirectory?: string,
    ): Promise<void> {
        if (slots.length === 0) {
            vscode.window.showWarningMessage('No programs to export: the bank has no assigned slots.');
            this.outputService.log(`[WARNING] ⚠ No programs available for export.`);
            return;
        }

        try {
            const segments = slots.map(slot => ({
                data: Buffer.from(FV1Assembler.toUint8Array(slot.machineCode)),
                address: slot.index * FV1_EEPROM_SLOT_SIZE_BYTES,
            }));

            const directory = defaultDirectory
                ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
                ?? '.';
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(directory, defaultFileName)),
                filters: { 'Intel HEX files': ['hex'], 'All files': ['*'] },
                saveLabel: 'Export Bank',
            });

            if (!saveUri) {
                this.outputService.log(`[WARNING] ⚠ Bank export cancelled by user`);
                return;
            }

            this.outputService.log(`[INFO] 📄 Generating multi-segment Intel HEX file with ${segments.length} program(s)...`);
            const hexFileString = IntelHexParser.generateMultiSegment(segments, 16);
            fs.writeFileSync(saveUri.fsPath, hexFileString, 'utf8');

            if (!fs.existsSync(saveUri.fsPath)) {
                throw new Error('the file was not written');
            }

            this.outputService.log(`[SUCCESS] ✅ Bank exported to Intel HEX: ${path.basename(saveUri.fsPath)} (${segments.length} program(s))`);
            vscode.window.showInformationMessage(`Bank exported to ${path.basename(saveUri.fsPath)} (${segments.length} program(s)).`);
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error exporting bank to HEX: ${error}`);
            vscode.window.showErrorMessage(`Error exporting bank to HEX: ${error}`);
        }
    }
}
