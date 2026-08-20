import * as vscode from 'vscode';
import { OutputService } from './services/OutputService.js';
import { AssemblyService } from './services/AssemblyService.js';
import { ProgrammerService } from './services/ProgrammerService.js';
import { StatusBarService } from './services/StatusBarService.js';
import { CommandRegistry } from './services/CommandRegistry.js';
import { FV1DocumentManager } from './core/fv1DocumentManager.js';
import { BlockDiagramDocumentManager } from './blockDiagram/BlockDiagramDocumentManager.js';
import { blockRegistry } from '@audiofab-io/fv1-core/blockDiagram';
import { reloadBlocks, getAgentWriteDir } from './blockDiagram/blockLoading.js';
import { FV1QuickActionsProvider } from './providers/FV1QuickActionsProvider.js';
import { BlockDiagramEditorProvider } from './blockDiagram/editor/BlockDiagramEditorProvider.js';
import { FV1HoverProvider } from './providers/fv1HoverProvider.js';
import { FV1DefinitionProvider } from './providers/fv1DefinitionProvider.js';
import { IntelHexService } from './services/IntelHexService.js';
import { EffectExportService } from './services/EffectExportService.js';
import { FV1DebugSession } from './simulator/FV1DebugSession.js';
import { FV1AudioEngine } from './simulator/FV1AudioEngine.js';
import { PedalSimulatorView } from './simulator/PedalSimulator/PedalSimulatorView.js';
import { FV1DebugConfigurationProvider } from './providers/FV1DebugConfigurationProvider.js';
import { registerMcpIntegration } from './mcp/mcpIntegration.js';

export function activate(context: vscode.ExtensionContext) {
    console.log('Audiofab FV-1 Extension is now active!');

    // 1. Initialize Core Services
    // OutputService is a singleton that manages the Output Channel
    const outputService = new OutputService('FV-1 Assembler');
    context.subscriptions.push(outputService);

    // 2. Initialize Document Managers (Singletons)
    // These manage the state of open documents and their diagnostics
    const fv1Diagnostics = vscode.languages.createDiagnosticCollection('fv1-assembler');
    const blockDiagramDiagnostics = vscode.languages.createDiagnosticCollection('block-diagram');
    context.subscriptions.push(fv1Diagnostics, blockDiagramDiagnostics);

    // Initialize the block registry with the built-in manifest, the user's custom directories,
    // and the managed agent-block dir (see blockLoading.ts).
    reloadBlocks();

    const fv1DocumentManager = new FV1DocumentManager(fv1Diagnostics);
    const blockDiagramDocumentManager = new BlockDiagramDocumentManager(blockDiagramDiagnostics, blockRegistry);

    // Expose the block catalog + graph compiler to AI agents (Copilot via VS Code's MCP host,
    // Claude Code via .mcp.json) so they can author and validate .spndiagram patches.
    registerMcpIntegration(context);

    // 3. Initialize Domain Services
    // Services encapsulate business logic and use the singletons above
    const assemblyService = new AssemblyService(outputService, fv1DocumentManager, blockDiagramDocumentManager);
    const programmerService = new ProgrammerService(outputService, assemblyService);
    const intelHexService = new IntelHexService(outputService, programmerService);
    const effectExportService = new EffectExportService(outputService, assemblyService);
    const statusBarService = new StatusBarService(fv1DocumentManager, blockDiagramDocumentManager);
    context.subscriptions.push(statusBarService);

    const fv1AudioEngine = new FV1AudioEngine();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('fv1Monitor', fv1AudioEngine)
    );

    // Pedal-shaped real-time simulator, mounted in the Audiofab Easy Spin
    // activity-bar container. retainContextWhenHidden keeps the AudioContext
    // alive so playback survives collapsing the view.
    const pedalSimulator = new PedalSimulatorView(
        context, blockDiagramDocumentManager, programmerService, intelHexService, outputService,
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            PedalSimulatorView.viewType,
            pedalSimulator,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('fv1-debug', new FV1DebugConfigurationProvider(assemblyService))
    );

    // 0. Register Debugging Support
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('fv1-debug', {
            createDebugAdapterDescriptor(_session) {
                console.log('Creating FV1 Debug Adapter Session');
                return new vscode.DebugAdapterInlineImplementation(
                    new FV1DebugSession(context, assemblyService, blockDiagramDocumentManager, fv1AudioEngine)
                );
            }
        })
    );

    // 4. Register Providers
    // Providers hook into VS Code's UI features (Hover, Definition, Custom Editors)
    const quickActionsProvider = new FV1QuickActionsProvider(context);
    const quickActionsView = vscode.window.createTreeView('fv1-quick-actions', {
        treeDataProvider: quickActionsProvider
    });
    context.subscriptions.push(quickActionsView);

    // Register virtual document provider for "View Assembly" feature
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('fv1-assembly', new AssemblyDocumentProvider(blockDiagramDocumentManager))
    );

    const assemblerSelector = [
        { language: 'fv1-assembly', scheme: 'file' },
        { language: 'fv1-assembly', scheme: 'fv1-assembly' }
    ];

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(assemblerSelector, new FV1HoverProvider(fv1DocumentManager))
    );

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(assemblerSelector, new FV1DefinitionProvider(fv1DocumentManager))
    );

    context.subscriptions.push(BlockDiagramEditorProvider.register(context, blockDiagramDocumentManager));

    // 5. Register Commands
    const commandRegistry = new CommandRegistry(context, outputService, assemblyService, programmerService, intelHexService, effectExportService, blockDiagramDocumentManager, pedalSimulator);
    commandRegistry.registerCommands();

    // 6. Handle Configuration Changes
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('fv1')) {
            if (e.affectsConfiguration('fv1.customBlockPaths')) {
                reloadBlocks();
                blockDiagramDocumentManager.refreshAll();
            }

            fv1DocumentManager.refreshAll();
            statusBarService.update(vscode.window.activeTextEditor?.document);
        }
    });

    // 6b. Watch the agent-block write dir so blocks the MCP server authors on the fly appear in
    // the registry (and open diagrams) live — the server is a separate process, so a file watcher
    // is how the extension host learns about them.
    const agentWriteDir = getAgentWriteDir();
    if (agentWriteDir) {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(agentWriteDir), '**/*.atl'),
        );
        const onAgentBlocksChanged = () => {
            reloadBlocks();
            blockDiagramDocumentManager.refreshAll();
        };
        watcher.onDidCreate(onAgentBlocksChanged);
        watcher.onDidChange(onAgentBlocksChanged);
        watcher.onDidDelete(onAgentBlocksChanged);
        context.subscriptions.push(watcher);
    }

    // 7. Handle Document Lifecycle
    vscode.workspace.onDidOpenTextDocument(doc => fv1DocumentManager.onDocumentOpen(doc));
    vscode.workspace.onDidCloseTextDocument(doc => fv1DocumentManager.onDocumentClose(doc));
    vscode.workspace.onDidChangeTextDocument(e => fv1DocumentManager.onDocumentChange(e.document));

    // Initial status bar update
    statusBarService.update(vscode.window.activeTextEditor?.document);
}



export function deactivate() { }

class AssemblyDocumentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private subscriptions: vscode.Disposable[] = [];

    constructor(private documentManager: BlockDiagramDocumentManager) {
        // Subscribe to compilation changes to trigger document refresh
        this.subscriptions.push(
            this.documentManager.onCompilationChange((uri) => {
                // The virtual URI is fv1-assembly:path/to/diagram.spndiagram.spn
                const virtualUri = vscode.Uri.from({
                    scheme: 'fv1-assembly',
                    path: uri.fsPath + '.spn'
                });
                this._onDidChange.fire(virtualUri);
            })
        );
    }

    dispose() {
        this.subscriptions.forEach(s => s.dispose());
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        // The URI is fv1-assembly:path/to/file.spndiagram.spn
        const diagramPath = uri.path.replace(/\.spn$/, '');
        const diagramUri = vscode.Uri.file(diagramPath);
        const result = this.documentManager.getCachedCompilationResult(diagramUri);
        return result?.assembly || '; No assembly available - please open the block diagram first';
    }
}
