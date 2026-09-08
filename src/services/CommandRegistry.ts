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
import { TemplateRepository, type DiagramTemplate } from './TemplateRepository.js';

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
    ) {
        this.templateRepository = new TemplateRepository();
    }

    private readonly templateRepository: TemplateRepository;


    /**
     * Choose a starting point for a new block diagram.
     *
     * Returns 'empty' for the blank diagram, a template to instantiate, or
     * undefined if the user cancelled.
     *
     * TWO LEVELS: categories first, then the templates inside one. The catalog
     * is expected to keep growing, and a single flat list of every effect is
     * unusable long before that becomes obvious. Back is offered twice -- the
     * titlebar arrow VS Code puts on a multi-step input, and a visible row at
     * the top of the list, because the arrow alone is easy to miss.
     *
     * The picker is shown immediately with the blank option and filled in once
     * the remote index arrives, so a slow or absent network never delays it.
     *
     * TRADEOFF: typing now filters whichever level you are on, so a template
     * name only matches once you are inside its category.
     */
    private async pickDiagramTemplate(): Promise<DiagramTemplate | 'empty' | undefined> {
        type Item = vscode.QuickPickItem & {
            template?: DiagramTemplate;
            category?: string;
            back?: boolean;
        };

        const blank: Item = {
            label: '$(file) Empty diagram',
            detail: 'Start from scratch with just an input and an output.',
            alwaysShow: true,
        };
        const backRow: Item = {
            label: '$(arrow-left) All categories',
            alwaysShow: true,
            back: true,
        };

        const quickPick = vscode.window.createQuickPick<Item>();
        quickPick.title = 'New Block Diagram';
        quickPick.placeholder = 'Choose a starting point';
        quickPick.matchOnDetail = true;
        quickPick.items = [blank];
        quickPick.busy = true;
        quickPick.show();

        /** Resolves on the next accept, Back button, or dismissal. */
        const nextAction = () => new Promise<
            { kind: 'accept'; item?: Item } | { kind: 'back' } | { kind: 'hide' }
        >(resolve => {
            const subs: vscode.Disposable[] = [];
            const done = (v: { kind: 'accept'; item?: Item } | { kind: 'back' } | { kind: 'hide' }) => {
                subs.forEach(d => d.dispose());
                resolve(v);
            };
            subs.push(quickPick.onDidAccept(() =>
                done({ kind: 'accept', item: quickPick.selectedItems[0] })));
            subs.push(quickPick.onDidTriggerButton(btn => {
                if (btn === vscode.QuickInputButtons.Back) done({ kind: 'back' });
            }));
            subs.push(quickPick.onDidHide(() => done({ kind: 'hide' })));
        });

        try {
            const { templates, remoteError } = await this.templateRepository.list();
            quickPick.busy = false;
            if (remoteError) {
                // Non-blocking: the blank diagram still works offline.
                quickPick.title = 'New Block Diagram — online templates unavailable';
                this.outputService.log(
                    `[templates] remote index unavailable: ${remoteError}`);
            } else if (templates.length === 0) {
                quickPick.title = 'New Block Diagram — no templates published yet';
            }

            // Captured after the error/empty cases above have had their say, so
            // returning from a category restores the right title instead of
            // keeping the category name.
            const baseTitle = quickPick.title;

            const byCategory = new Map<string, DiagramTemplate[]>();
            for (const t of templates) {
                const list = byCategory.get(t.category);
                if (list) list.push(t); else byCategory.set(t.category, [t]);
            }
            const categories = [...byCategory.keys()].sort((x, y) => x.localeCompare(y));

            const showCategories = () => {
                quickPick.buttons = [];
                quickPick.title = baseTitle;
                quickPick.placeholder = 'Choose a starting point';
                quickPick.value = '';
                const items: Item[] = [blank];
                if (categories.length > 0) {
                    items.push({ label: 'Templates', kind: vscode.QuickPickItemKind.Separator });
                    for (const c of categories) {
                        const n = byCategory.get(c)!.length;
                        items.push({
                            label: `$(folder) ${c}`,
                            description: `${n} template${n === 1 ? '' : 's'}`,
                            category: c,
                        });
                    }
                }
                quickPick.items = items;
            };

            const showCategory = (category: string) => {
                quickPick.buttons = [vscode.QuickInputButtons.Back];
                quickPick.title = `${baseTitle} — ${category}`;
                quickPick.placeholder = `Choose a template in ${category}`;
                quickPick.value = '';
                quickPick.items = [
                    backRow,
                    { label: category, kind: vscode.QuickPickItemKind.Separator },
                    ...byCategory.get(category)!.map(t => ({
                        label: t.name,
                        // Descriptions in these diagrams are long and genuinely
                        // useful, so they go in `detail` where there is room.
                        detail: t.description || undefined,
                        description: t.author,
                        template: t,
                    })),
                ];
            };

            showCategories();
            for (;;) {
                const action = await nextAction();
                if (action.kind === 'hide') return undefined;
                if (action.kind === 'back') { showCategories(); continue; }

                const picked = action.item;
                if (!picked) return undefined;
                if (picked.back) { showCategories(); continue; }
                if (picked.category) { showCategory(picked.category); continue; }
                if (picked.template) return picked.template;
                return 'empty';
            }
        } finally {
            quickPick.dispose();
        }
    }

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
            // Pick the starting point BEFORE the save dialog: choosing a template
            // and then cancelling the save is cheap, but naming a file and then
            // discovering the template list is empty is not.
            const chosen = await this.pickDiagramTemplate();
            if (chosen === undefined) return;          // cancelled

            const suggested = chosen === 'empty'
                ? 'new.spndiagram'
                : `${slugForFilename(chosen.name)}.spndiagram`;

            const saveUri = await vscode.window.showSaveDialog({
                filters: { 'FV-1 Block Diagram': ['spndiagram'] },
                defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.', suggested))
            });

            if (!saveUri) return;

            try {
                let source: string;
                if (chosen === 'empty') {
                    source = fs.readFileSync(
                        path.join(this.context.extensionPath, 'resources', 'templates', 'default-diagram.json'),
                        'utf8');
                } else {
                    source = await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: `Fetching "${chosen.name}"...` },
                        () => this.templateRepository.fetchSource(chosen));
                }

                const diagram = JSON.parse(source);
                // The file name is the user's choice and wins over the template's
                // own name, so two copies of one template are told apart.
                diagram.metadata = diagram.metadata ?? {};
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

/**
 * A template name turned into a sensible default file name.
 * "Multi Voice Chorus" -> "multi-voice-chorus"
 */
function slugForFilename(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'new';
}
