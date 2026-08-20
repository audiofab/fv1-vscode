import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OutputService } from '../services/OutputService.js';
import { AssemblyService } from '../services/AssemblyService.js';
import { ProgrammerService } from '../services/ProgrammerService.js';
import { BlockDiagramDocumentManager } from '../blockDiagram/BlockDiagramDocumentManager.js';
import { IntelHexService } from './IntelHexService.js';
import { EffectExportService } from './EffectExportService.js';
import { getActiveDocumentUri, resolveToUri } from '../core/editor-utils.js';
import { PedalSimulatorView } from '../simulator/PedalSimulator/PedalSimulatorView.js';

export class CommandRegistry {
    constructor(
        private context: vscode.ExtensionContext,
        private outputService: OutputService,
        private assemblyService: AssemblyService,
        private programmerService: ProgrammerService,
        private intelHexService: IntelHexService,
        private effectExportService: EffectExportService,
        private blockDiagramDocMgr: BlockDiagramDocumentManager,
        private pedalSimulator: PedalSimulatorView,
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

        // Opening a bank straight into the simulator, from the explorer context
        // menu or the palette — saves a Load… round trip through a file dialog.
        this.register('fv1.openBankInSimulator', async (uriOrString?: vscode.Uri | string) => {
            let bankUri = typeof uriOrString === 'string' ? resolveToUri(uriOrString) : uriOrString;
            if (!bankUri) bankUri = getActiveDocumentUri();
            if (!bankUri || !bankUri.fsPath.toLowerCase().endsWith('.spnbank')) {
                vscode.window.showErrorMessage('Select a .spnbank file to open in the Pedal Simulator.');
                return;
            }
            await this.pedalSimulator.openBank(bankUri);
            // Reveal the view so the loaded bank is actually visible.
            await vscode.commands.executeCommand('fv1.pedalSimulator.focus');
        });

        this.register('fv1.backupPedal', async () => {
            await this.programmerService.backupPedal();
        });

        // Deliberately NOT declared in package.json `contributes.commands`, so it
        // stays out of the Command Palette and the marketplace contributions
        // list. It remains a diagnostic we can invoke with
        // `vscode.commands.executeCommand('fv1.readDeviceConfiguration')`.
        // Don't "helpfully" add a contribution for it.
        this.register('fv1.readDeviceConfiguration', async () => {
            await this.programmerService.readDeviceConfiguration();
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

        this.register('fv1.exportEffectJson', async () => {
            await this.effectExportService.exportActiveEffect();
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

        // Bank programming / hex export commands were tied to the old
        // .spnbank custom editor's tree-item context menu. The pedal
        // simulator view will dispatch these directly via ProgrammerService
        // and IntelHexService when its Program Pedal / Export buttons land.

        this.register('fv1.loadHexToEeprom', async () => {
            await this.programmerService.loadHexToEeprom();
        });

        // The pedal simulator handles live, real-time playback of the active
        // editor with no command needed. This DAP-based path is now reserved
        // for stepping through assembly with breakpoints and inspecting
        // registers — palette-only so we don't clutter the editor UI.
        this.register('fv1.launchDebugger', async (uriOrString?: vscode.Uri | string, options?: { stopOnEntry?: boolean }) => {
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

            // Check if a simulation is already running
            if (vscode.debug.activeDebugSession?.type === 'fv1-debug') {
                vscode.window.showWarningMessage('A simulation is already running. Please stop the current session before starting a new one.');
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

        this.register('fv1.openSimulator', async () => {
            // Reveal the pedal-simulator webview view in the activity bar.
            // VS Code auto-generates a `<viewId>.focus` command for every
            // registered view, which both reveals the view container and
            // gives the view focus.
            await vscode.commands.executeCommand(`${PedalSimulatorView.viewType}.focus`);
        });

        this.register('fv1.refreshBlocks', async () => {
            const { reloadBlocks } = await import('../blockDiagram/blockLoading.js');
            reloadBlocks();

            // Refresh all active documents
            this.blockDiagramDocMgr.refreshAll();

            vscode.window.showInformationMessage(`FV-1 Custom Blocks refreshed successfully.`);
        });
    }

    private register(command: string, callback: (...args: any[]) => any) {
        this.context.subscriptions.push(vscode.commands.registerCommand(command, callback));
    }
}