import * as vscode from 'vscode';
import { OutputService } from './services/OutputService.js';
import { AssemblyService } from './services/AssemblyService.js';
import { ProgrammerService } from './services/ProgrammerService.js';
import { StatusBarService } from './services/StatusBarService.js';
import { CommandRegistry } from './services/CommandRegistry.js';
import { FV1DocumentManager } from './fv1DocumentManager.js';
import { BlockDiagramDocumentManager } from './blockDiagram/BlockDiagramDocumentManager.js';
import { blockRegistry } from './blockDiagram/blocks/BlockRegistry.js';
import { FV1QuickActionsProvider } from './FV1QuickActionsProvider.js';
import { SpnBankEditorProvider } from './SpnBankEditorProvider.js';
import { BlockDiagramEditorProvider } from './blockDiagram/editor/BlockDiagramEditorProvider.js';
import { FV1HoverProvider } from './fv1HoverProvider.js';
import { FV1DefinitionProvider } from './fv1DefinitionProvider.js';
import { IntelHexService } from './services/IntelHexService.js';
import { FV1DebugSession } from './simulator/FV1DebugSession.js';

export function activate(context: vscode.ExtensionContext) {
    console.log('Audiofab FV-1 Extension is now active!');

    // 0. Register Debugging Support
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('fv1-debug', {
            createDebugAdapterDescriptor(_session) {
                console.log('Creating FV1 Debug Adapter Session');
                return new vscode.DebugAdapterInlineImplementation(new FV1DebugSession(context));
            }
        })
    );

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('fv1-debug', new FV1DebugConfigurationProvider())
    );

    // 1. Initialize Core Services
    // OutputService is a singleton that manages the Output Channel
    const outputService = new OutputService('FV-1 Assembler');
    context.subscriptions.push(outputService);

    // 2. Initialize Document Managers (Singletons)
    // These manage the state of open documents and their diagnostics
    const fv1Diagnostics = vscode.languages.createDiagnosticCollection('fv1-assembler');
    const blockDiagramDiagnostics = vscode.languages.createDiagnosticCollection('block-diagram');
    context.subscriptions.push(fv1Diagnostics, blockDiagramDiagnostics);

    const fv1DocumentManager = new FV1DocumentManager(fv1Diagnostics);
    const blockDiagramDocumentManager = new BlockDiagramDocumentManager(blockDiagramDiagnostics, blockRegistry);

    // 3. Initialize Domain Services
    // Services encapsulate business logic and use the singletons above
    const assemblyService = new AssemblyService(outputService, fv1DocumentManager, blockDiagramDocumentManager);
    const programmerService = new ProgrammerService(outputService, assemblyService);
    const intelHexService = new IntelHexService(outputService, programmerService, assemblyService);
    const statusBarService = new StatusBarService(fv1DocumentManager, blockDiagramDocumentManager);
    context.subscriptions.push(statusBarService);

    // 4. Register Providers
    // Providers hook into VS Code's UI features (Hover, Definition, Custom Editors)
    const quickActionsProvider = new FV1QuickActionsProvider(context);
    const quickActionsView = vscode.window.createTreeView('fv1-quick-actions', {
        treeDataProvider: quickActionsProvider
    });
    context.subscriptions.push(quickActionsView);

    // Register virtual document provider for assembly view
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
            if (result.assembly) {
                // Show assembly even if there are errors (e.g., exceeds instruction limit)
                // Prepend error/warning comments if present
                let output = '';
                if (result.errors && result.errors.length > 0) {
                    output += result.errors.map(e => `; ERROR: ${e}`).join('\n') + '\n\n';
                }
                if (result.warnings && result.warnings.length > 0) {
                    output += result.warnings.map(w => `; WARNING: ${w}`).join('\n') + '\n\n';
                }
                output += result.assembly;
                return output;
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
    blockDiagramDocumentManager.onCompilationChange((uri): void => {
        const virtualUri = vscode.Uri.parse(`fv1-assembly:${uri.fsPath}.spn`);
        assemblyDocumentProvider.onDidChangeEmitter.fire(virtualUri);
    });

    context.subscriptions.push(
        SpnBankEditorProvider.register(context),
        BlockDiagramEditorProvider.register(context, blockDiagramDocumentManager),
        vscode.languages.registerHoverProvider({ language: 'fv1-assembly', scheme: 'file' }, new FV1HoverProvider(fv1DocumentManager)),
        vscode.languages.registerHoverProvider({ language: 'fv1-assembly', scheme: 'fv1-assembly' }, new FV1HoverProvider(fv1DocumentManager)),
        vscode.languages.registerDefinitionProvider({ language: 'fv1-assembly', scheme: 'file' }, new FV1DefinitionProvider(fv1DocumentManager)),
        vscode.languages.registerDefinitionProvider({ language: 'fv1-assembly', scheme: 'fv1-assembly' }, new FV1DefinitionProvider(fv1DocumentManager))
    );

    // 5. Register Commands
    // The CommandRegistry binds VS Code commands to the services
    const commandRegistry = new CommandRegistry(context, outputService, assemblyService, programmerService, intelHexService, blockDiagramDocumentManager);
    commandRegistry.registerCommands();

    // Register manual debug command
    context.subscriptions.push(vscode.commands.registerCommand('fv1.startDebugger', async () => {
        const doc = vscode.window.activeTextEditor?.document;
        if (doc && doc.languageId === 'fv1-assembly') {
            await vscode.debug.startDebugging(undefined, {
                type: 'fv1-debug',
                name: 'Debug current .spn file',
                request: 'launch',
                program: doc.uri.fsPath,
                stopOnEntry: true
            });
        }
    }));

    // Setup document event listeners for live diagnostics
    const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
        fv1DocumentManager.onDocumentOpen(document);
        blockDiagramDocumentManager.onDocumentChange(document);
    });

    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
        fv1DocumentManager.onDocumentChange(event.document);
        blockDiagramDocumentManager.onDocumentChange(event.document);
    });

    const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument((document) => {
        fv1DocumentManager.onDocumentClose(document);
        if (document.fileName.toLowerCase().endsWith('.spndiagram')) {
            blockDiagramDocumentManager.clearCache(document.uri);
        }
    });

    // Process already open documents
    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'fv1-assembly') {
            fv1DocumentManager.onDocumentOpen(document);
        }
        if (document.fileName.toLowerCase().endsWith('.spndiagram')) {
            blockDiagramDocumentManager.onDocumentChange(document);
        }
    }

    // Listen for configuration changes
    const onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('fv1.spinAsmMemBug') || event.affectsConfiguration('fv1.clampReals')) {
            fv1DocumentManager.refreshAll();
        }
    });

    context.subscriptions.push(
        onDidOpenTextDocument,
        onDidChangeTextDocument,
        onDidCloseTextDocument,
        onDidChangeConfiguration
    );
}

class FV1DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    /**
     * Massage a debug configuration before it is used to launch a debug session.
     */
    resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, _token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        console.log('Resolving debug configuration for FV-1');
        // If config actually has nothing, it means the user just pressed F5 on an .spn file
        // We should fill in the defaults.
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'fv1-assembly') {
                config.type = 'fv1-debug';
                config.name = 'Launch';
                config.request = 'launch';
                config.program = '${file}';
                config.stopOnEntry = true;
            }
        }

        if (!config.program) {
            return vscode.window.showInformationMessage("Cannot find a program to debug").then((): undefined => {
                return undefined;	// abort launch
            });
        }

        return config;
    }
}
