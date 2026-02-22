import * as vscode from 'vscode';
import * as path from 'path';
import { FV1Assembler, FV1AssemblerResult } from '../FV1Assembler.js';
import { FV1DocumentManager } from '../fv1DocumentManager.js';
import { BlockDiagramDocumentManager } from '../blockDiagram/BlockDiagramDocumentManager.js';
import { OutputService } from './OutputService.js';
import { getActiveDocumentUri } from '../utils/editor-utils.js';

export class AssemblyService {
    constructor(
        private outputService: OutputService,
        private fv1DocumentManager: FV1DocumentManager,
        private blockDiagramDocumentManager: BlockDiagramDocumentManager
    ) { }

    public async compileBlockDiagram(diagramPath: string): Promise<string | null> {
        try {
            this.outputService.log(`[INFO] 🔧 Compiling block diagram ${path.basename(diagramPath)}...`);

            const uri = vscode.Uri.file(diagramPath);
            let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
            if (!document) {
                document = await vscode.workspace.openTextDocument(uri);
            }

            const result = this.blockDiagramDocumentManager.getCompilationResult(document);

            if (result.success && result.assembly) {
                const stats = result.statistics!;
                const config = vscode.workspace.getConfiguration('fv1');
                const maxInstructions = config.get<number>('hardware.progSize') ?? 128;
                const maxRegisters = config.get<number>('hardware.regCount') ?? 32;
                const maxMemory = config.get<number>('hardware.delaySize') ?? 32768;

                this.outputService.log(
                    `[SUCCESS] ✅ Block diagram compiled successfully - ` +
                    `Instructions: ${stats.instructionsUsed}/${maxInstructions}, ` +
                    `Registers: ${stats.registersUsed}/${maxRegisters}, ` +
                    `Memory: ${stats.memoryUsed}/${maxMemory}`
                );

                if (result.warnings && result.warnings.length > 0) {
                    result.warnings.forEach(warn => this.outputService.log(`[WARNING] ⚠ ${warn}`));
                }

                return result.assembly;
            } else {
                const errors = result.errors || ['Unknown compilation error'];
                this.outputService.log(`[ERROR] ❌ Block diagram compilation failed:`);
                errors.forEach(err => this.outputService.log(`  • ${err}`));
                return null;
            }
        } catch (e) {
            this.outputService.log(`[ERROR] ❌ Failed to compile block diagram: ${e}`);
            return null;
        }
    }

    public async assembleActiveDocument(): Promise<FV1AssemblerResult | undefined> {
        const verbose: boolean = vscode.workspace.getConfiguration('fv1').get<boolean>('verbose') ?? false;
        const fileUri = getActiveDocumentUri();

        if (!fileUri) {
            vscode.window.showErrorMessage('No active editor');
            return undefined;
        }

        const filePath = fileUri.fsPath;

        // Handle Block Diagram
        if (filePath.endsWith('.spndiagram')) {
            const assembly = await this.compileBlockDiagram(filePath);
            if (!assembly) return undefined;

            const config = vscode.workspace.getConfiguration('fv1');
            const assembler = new FV1Assembler({
                fv1AsmMemBug: config.get<boolean>('spinAsmMemBug') ?? true,
                clampReals: config.get<boolean>('clampReals') ?? true,
                regCount: config.get<number>('hardware.regCount') ?? 32,
                progSize: config.get<number>('hardware.progSize') ?? 128,
                delaySize: config.get<number>('hardware.delaySize') ?? 32768,
            });
            const result = assembler.assemble(assembly);
            this.logAssemblyResult(result, path.basename(filePath), verbose);
            return result;
        }

        // Handle .spn file
        if (!filePath.endsWith('.spn')) {
            vscode.window.showErrorMessage('Active file is not an FV-1 assembly file (.spn) or block diagram (.spndiagram)');
            return undefined;
        }

        let document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
        if (!document) {
            vscode.window.showErrorMessage('Could not access document');
            return undefined;
        }

        if (document.isDirty) {
            if (!(await document.save())) {
                vscode.window.showErrorMessage('Failed to save document. Assembly aborted.');
                return undefined;
            }
            this.outputService.log(`[INFO] 💾 Saved ${path.basename(document.fileName)}`);
        }

        this.outputService.log(`[INFO] 🔧 Assembling ${path.basename(document.fileName)}...`);
        const result = this.fv1DocumentManager.getAssemblyResult(document);
        this.logAssemblyResult(result, path.basename(document.fileName), verbose);
        return result;
    }

    private logAssemblyResult(result: FV1AssemblerResult, fileName: string, verbose: boolean) {
        let hasErrors = false;
        result.problems.forEach((p: any) => {
            const prefix = p.isfatal ? '[ERROR]' : '[WARNING]';
            const icon = p.isfatal ? '❌' : '⚠';
            const lineInfo = p.line > 0 ? ` (Line ${p.line})` : '';
            this.outputService.log(`${prefix} ${icon}${lineInfo}: ${p.message}`);
            if (p.isfatal) hasErrors = true;
        });

        if (!hasErrors && result.machineCode && result.machineCode.length > 0) {
            if (verbose) this.outputService.log(FV1Assembler.formatMachineCode(result.machineCode));
            const regCount = result.usedRegistersCount;
            const config = vscode.workspace.getConfiguration('fv1');
            const maxRegisters = config.get<number>('hardware.regCount') ?? 32;
            this.outputService.log(`[SUCCESS] ✅ Assembly completed successfully - ${fileName} (${result.machineCode.length} instructions, ${regCount}/${maxRegisters} registers used)`);
        } else if (hasErrors) {
            this.outputService.log(`[ERROR] ❌ Assembly failed with errors - ${fileName}`);
        } else {
            this.outputService.log(`[ERROR] ❌ Assembly produced no machine code - ${fileName}`);
        }
    }

    public async assembleFile(fsPath: string): Promise<FV1AssemblerResult | undefined> {
        try {
            if (fsPath.toLowerCase().endsWith('.spndiagram')) {
                const assembly = await this.compileBlockDiagram(fsPath);
                if (!assembly) return undefined;

                const config = vscode.workspace.getConfiguration('fv1');
                const assembler = new FV1Assembler({
                    fv1AsmMemBug: config.get<boolean>('spinAsmMemBug') ?? true,
                    clampReals: config.get<boolean>('clampReals') ?? true,
                    regCount: config.get<number>('hardware.regCount') ?? 32,
                    progSize: config.get<number>('hardware.progSize') ?? 128,
                    delaySize: config.get<number>('hardware.delaySize') ?? 32768,
                });
                return assembler.assemble(assembly);
            } else {
                const uri = fsPath.includes(':') && !path.isAbsolute(fsPath) ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
                const document = await vscode.workspace.openTextDocument(uri);
                return this.fv1DocumentManager.getAssemblyResult(document);
            }
        } catch (error) {
            this.outputService.log(`[ERROR] ❌ Error assembling file ${fsPath}: ${error}`);
            return undefined;
        }
    }
}