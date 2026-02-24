import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OutputService } from '../services/OutputService.js';
import { AssemblyService } from '../services/AssemblyService.js';
import { ProgrammerService } from '../services/ProgrammerService.js';
import { BlockDiagramDocumentManager } from '../blockDiagram/BlockDiagramDocumentManager.js';
import { IntelHexService } from './IntelHexService.js';
import { getActiveDocumentUri, resolveToUri } from '../core/editor-utils.js';

export class CommandRegistry {
    constructor(
        private context: vscode.ExtensionContext,
        private outputService: OutputService,
        private assemblyService: AssemblyService,
        private programmerService: ProgrammerService,
        private intelHexService: IntelHexService,
        private blockDiagramDocMgr: BlockDiagramDocumentManager
    ) { }

    public registerCommands() {
        this.register('fv1.assemble', async () => {
            await this.assemblyService.assembleActiveDocument();
        });

        this.register('fv1.assembleAndProgram', async () => {
            const result = await this.assemblyService.assembleActiveDocument();
            if (result && result.machineCode.length > 0) {
                if (result.problems.some(p => p.isfatal)) {
                    vscode.window.showErrorMessage('Cannot program EEPROM: Program has errors');
                } else {
                    await this.programmerService.programEeprom(result.machineCode);
                }
            }
        });

        this.register('fv1.backupPedal', async () => {
            await this.programmerService.backupPedal();
        });

        this.register('fv1.assembleToHex', async () => {
            const result = await this.assemblyService.assembleActiveDocument();
            if (result && result.machineCode.length > 0) {
                if (result.problems.some(p => p.isfatal)) {
                    vscode.window.showErrorMessage('Cannot export to HEX: Program has errors');
                } else {
                    await this.intelHexService.outputIntelHexFile(result.machineCode);
                }
            }
        });

        this.register('fv1.createSpnBank', async () => {
            const uris = await vscode.window.showSaveDialog({ filters: { 'Easy Spin Bank': ['spnbank'] }, defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '.', 'new.spnbank')) });
            if (!uris) return;
            const content = JSON.stringify({ slots: Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, path: '' })) }, null, 2);
            await vscode.workspace.fs.writeFile(uris, Buffer.from(content, 'utf8'));
            await vscode.commands.executeCommand('vscode.open', uris);
        });

        this.register('fv1.createBlockDiagram', async () => {
            const saveUri = await vscode.window.showSaveDialog({
                filters: { 'FV-1 Block Diagram': ['spndiagram'] },
                defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.', 'new.spndiagram'))
            });

            if (!saveUri) return;

            try {
                const templatePath = path.join(this.context.extensionPath, 'resources', 'templates', 'default-diagram.json');
                let templateContent = fs.readFileSync(templatePath, 'utf8');

                const diagram = JSON.parse(templateContent);
                diagram.metadata.name = path.basename(saveUri.fsPath, '.spndiagram');

                const content = JSON.stringify(diagram, null, 2);
                await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));

                await vscode.commands.executeCommand('vscode.openWith', saveUri, 'fv1.blockDiagramEditor');
                vscode.window.showInformationMessage(`Created new block diagram: ${path.basename(saveUri.fsPath)}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create block diagram: ${error}`);
            }
        });

        this.register('fv1.programSpnBank', async (item?: any) => {
            await this.programmerService.programBank(item);
        });

        this.register('fv1.unassignSlot', async (item?: vscode.TreeItem) => {
            try {
                let bankUri: vscode.Uri | undefined;
                let slotNum: number | undefined;
                if (item && (item as any).bankUri) { bankUri = (item as any).bankUri; slotNum = (item as any).slot; }
                if (!bankUri || !slotNum) { vscode.window.showErrorMessage('No slot selected to unassign'); return; }

                const doc = await vscode.workspace.openTextDocument(bankUri);
                const json = doc.getText() ? JSON.parse(doc.getText()) : {};
                json.slots = json.slots || new Array(8).fill(null).map((_, i) => ({ slot: i + 1, path: '' }));
                json.slots[slotNum - 1] = { slot: slotNum, path: '' };
                const newContent = Buffer.from(JSON.stringify(json, null, 2), 'utf8');
                await vscode.workspace.fs.writeFile(bankUri, newContent);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to unassign slot: ${e}`);
            }
        });

        this.register('fv1.programThisSlot', async (item?: vscode.TreeItem) => {
            await this.programmerService.programSlotFromBank(item);
        });

        this.register('fv1.exportBankToHex', async (item?: any) => {
            await this.intelHexService.exportBankToHex(item);
        });

        this.register('fv1.loadHexToEeprom', async () => {
            await this.programmerService.loadHexToEeprom();
        });

        this.register('fv1.startSimulator', async (uriOrString?: vscode.Uri | string, options?: { stopOnEntry?: boolean }) => {
            let programUri: vscode.Uri | undefined;
            if (typeof uriOrString === 'string') {
                programUri = resolveToUri(uriOrString);
            } else {
                programUri = uriOrString;
            }

            if (!programUri) {
                programUri = getActiveDocumentUri();
            }

            if (!programUri) {
                vscode.window.showErrorMessage('No file selected to debug');
                return;
            }

            // Ensure Run/Debug view is visible to ensure debug session is properly initialized
            await vscode.commands.executeCommand('workbench.view.debug');

            const stopOnEntry = options?.stopOnEntry ?? vscode.workspace.getConfiguration('fv1.simulation').get<boolean>('stopOnEntry') ?? true;

            vscode.debug.startDebugging(undefined, {
                type: 'fv1-debug',
                name: `Debug ${path.basename(programUri.fsPath || programUri.path)}`,
                request: 'launch',
                program: programUri.toString(),
                stopOnEntry: stopOnEntry
            });
        });
    }

    private register(command: string, callback: (...args: any[]) => any) {
        this.context.subscriptions.push(vscode.commands.registerCommand(command, callback));
    }
}