/**
 * VS Code Custom Editor Provider for .spndiagram files
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BlockGraph, createEmptyGraph } from '../types/Graph.js';
import { GraphCompiler } from '../compiler/GraphCompiler.js';
import { blockRegistry } from '../blocks/BlockRegistry.js';
import { BlockDiagramDocumentManager } from '../BlockDiagramDocumentManager.js';

export class BlockDiagramEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'fv1.blockDiagramEditor';

    private static readonly webviewScriptUri = 'dist/webview.js';

    // Map from .spndiagram URI to virtual assembly document URI
    private assemblyDocuments = new Map<string, vscode.Uri>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly documentManager: BlockDiagramDocumentManager
    ) { }

    /**
     * Register this custom editor provider
     */
    public static register(
        context: vscode.ExtensionContext,
        documentManager: BlockDiagramDocumentManager
    ): vscode.Disposable {
        const provider = new BlockDiagramEditorProvider(context, documentManager);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            BlockDiagramEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: false,
            }
        );
        return providerRegistration;
    }

    /**
     * Called when a custom editor is opened
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup webview options
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Set the HTML content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Debounce timer for compilation - avoids recompiling during drag operations
        let compileTimeout: NodeJS.Timeout | undefined;

        // Load and send the initial document content
        const updateWebview = () => {
            const graph = this.getDocumentAsGraph(document);
            webviewPanel.webview.postMessage({
                type: 'init',
                graph: graph
            });
        };

        // Send resource statistics to webview
        const updateResourceStats = () => {
            const result = this.documentManager.getCompilationResult(document);
            if (result.success && result.statistics) {
                const config = vscode.workspace.getConfiguration('fv1');
                webviewPanel.webview.postMessage({
                    type: 'resourceStats',
                    statistics: {
                        ...result.statistics,
                        progSize: config.get<number>('hardware.progSize') ?? 128,
                        regCount: config.get<number>('hardware.regCount') ?? 32,
                        delaySize: config.get<number>('hardware.delaySize') ?? 32768
                    }
                });
            } else {
                // Send zeros if compilation failed
                const config = vscode.workspace.getConfiguration('fv1');
                webviewPanel.webview.postMessage({
                    type: 'resourceStats',
                    statistics: {
                        instructionsUsed: 0,
                        registersUsed: 0,
                        memoryUsed: 0,
                        blocksProcessed: 0,
                        progSize: config.get<number>('hardware.progSize') ?? 128,
                        regCount: config.get<number>('hardware.regCount') ?? 32,
                        delaySize: config.get<number>('hardware.delaySize') ?? 32768
                    }
                });
            }
        };

        // Subscribe to compilation changes
        const compilationListener = this.documentManager.onCompilationChange((uri) => {
            if (uri.toString() === document.uri.toString()) {
                updateResourceStats();
            }
        });

        // Hook up event handlers
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        const registrySubscription = blockRegistry.onDidChangeBlocks(() => {
            webviewPanel.webview.postMessage({
                type: 'blockMetadata',
                metadata: blockRegistry.getAllMetadata()
            });
            updateWebview();
            // Recompile immediately since blocks changed
            this.documentManager.onDocumentChange(document);
        });

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async e => {
            switch (e.type) {
                case 'ready':
                    // Webview is ready, send initial data
                    updateWebview();
                    webviewPanel.webview.postMessage({
                        type: 'blockMetadata',
                        metadata: blockRegistry.getAllMetadata()
                    });
                    // Send saved palette state
                    const savedState = this.context.workspaceState.get<string[]>('blockDiagram.expandedCategories', []);
                    webviewPanel.webview.postMessage({
                        type: 'paletteState',
                        expandedCategories: savedState
                    });
                    // Send initial resource stats
                    updateResourceStats();
                    return;

                case 'update':
                    await this.updateTextDocument(document, e.graph);

                    // Don't compile immediately during drag or active connection operations
                    const isInteracting = e.isDragging || e.isCreatingConnection;

                    if (isInteracting) {
                        // Clear any pending compilation
                        if (compileTimeout) {
                            clearTimeout(compileTimeout);
                        }
                    } else {
                        // Not interacting - schedule compilation after a short delay
                        if (compileTimeout) {
                            clearTimeout(compileTimeout);
                        }
                        compileTimeout = setTimeout(() => {
                            // Trigger compilation by notifying the document manager
                            this.documentManager.onDocumentChange(document);
                        }, 300); // 300ms debounce
                    }
                    return;

                case 'dragEnd':
                    // When drag ends, trigger immediate compilation
                    if (compileTimeout) {
                        clearTimeout(compileTimeout);
                    }
                    this.documentManager.onDocumentChange(document);
                    return;

                case 'getBlockMetadata':
                    webviewPanel.webview.postMessage({
                        type: 'blockMetadata',
                        metadata: blockRegistry.getAllMetadata()
                    });
                    return;

                case 'convertToDisplay':
                    // Convert code value to display value for a parameter
                    const blockDef = blockRegistry.getBlock(e.blockType);
                    if (blockDef) {
                        try {
                            const displayValue = blockDef.getDisplayValue(e.parameterId, e.codeValue);
                            webviewPanel.webview.postMessage({
                                type: 'convertToDisplayResponse',
                                requestId: e.requestId,
                                displayValue
                            });
                        } catch (error) {
                            webviewPanel.webview.postMessage({
                                type: 'convertToDisplayResponse',
                                requestId: e.requestId,
                                error: error instanceof Error ? error.message : 'Unknown error'
                            });
                        }
                    }
                    return;

                case 'convertToCode':
                    // Convert display value to code value for a parameter
                    const blockDefForCode = blockRegistry.getBlock(e.blockType);
                    if (blockDefForCode) {
                        try {
                            const codeValue = blockDefForCode.getCodeValue(e.parameterId, e.displayValue);
                            webviewPanel.webview.postMessage({
                                type: 'convertToCodeResponse',
                                requestId: e.requestId,
                                codeValue
                            });
                        } catch (error) {
                            webviewPanel.webview.postMessage({
                                type: 'convertToCodeResponse',
                                requestId: e.requestId,
                                error: error instanceof Error ? error.message : 'Unknown error'
                            });
                        }
                    }
                    return;

                case 'getCustomLabel':
                    // Get custom label for a block instance
                    const blockDefForLabel = blockRegistry.getBlock(e.blockType);
                    if (blockDefForLabel && blockDefForLabel.getCustomLabel) {
                        try {
                            const graph = this.getDocumentAsGraph(document);

                            // Mock context for connection checking in the UI
                            const uiCtx = {
                                getInputRegister: (blockId: string, portId: string) => {
                                    const conn = graph.connections.find(c =>
                                        c.to.blockId === blockId && c.to.portId === portId
                                    );
                                    return conn ? 'connected' : undefined;
                                }
                            };

                            const label = (blockDefForLabel as any).getCustomLabel(e.parameters, uiCtx, e.blockId);
                            webviewPanel.webview.postMessage({
                                type: 'customLabelResponse',
                                blockId: e.blockId,
                                label
                            });
                        } catch (error) {
                            console.error('Error getting custom label:', error);
                        }
                    }
                    return;

                case 'savePaletteState':
                    // Save the expanded categories to workspace state
                    await this.context.workspaceState.update('blockDiagram.expandedCategories', e.expandedCategories);
                    return;

                case 'showAssembly':
                    // Open assembly code in a side-by-side editor
                    await this.showAssemblyEditor(document);
                    return;

                case 'simulate':
                    // Trigger simulation using the diagram's URI to keep focus here
                    await vscode.commands.executeCommand('fv1.startSimulator', document.uri);
                    return;

                case 'error':
                    vscode.window.showErrorMessage(e.message);
                    return;
            }
        });

        // Clean up when the editor is closed
        webviewPanel.onDidDispose(() => {
            if (compileTimeout) {
                clearTimeout(compileTimeout);
            }
            compilationListener.dispose();
            changeDocumentSubscription.dispose();
            registrySubscription.dispose();
        });
    }

    /**
     * Show assembly code in a side-by-side editor
     */
    private async showAssemblyEditor(diagramDocument: vscode.TextDocument): Promise<void> {
        const result = this.documentManager.getCompilationResult(diagramDocument);
        const assembly = result.success && result.assembly
            ? result.assembly
            : `; Compilation ${result.success ? 'produced no output' : 'failed'}\n${result.errors?.map(e => `; ${e}`).join('\n') || ''}`;

        // Create a virtual document URI
        const assemblyUri = vscode.Uri.from({
            scheme: 'fv1-assembly',
            path: diagramDocument.uri.fsPath + '.spn'
        });
        this.assemblyDocuments.set(diagramDocument.uri.toString(), assemblyUri);

        // Check if assembly document is already open
        const existingEditor = vscode.window.visibleTextEditors.find(
            editor => editor.document.uri.toString() === assemblyUri.toString()
        );

        if (existingEditor) {
            // Already open, just show it
            await vscode.window.showTextDocument(existingEditor.document, existingEditor.viewColumn);
        } else {
            // Find the diagram editor's view column
            const diagramEditor = vscode.window.visibleTextEditors.find(
                editor => editor.document.uri.toString() === diagramDocument.uri.toString()
            );

            // Open in the SAME editor group as the diagram
            const targetColumn = diagramEditor?.viewColumn ?? vscode.ViewColumn.Active;

            // Open the assembly document in the same editor group
            const doc = await vscode.workspace.openTextDocument(assemblyUri);
            await vscode.window.showTextDocument(doc, {
                viewColumn: targetColumn,
                preserveFocus: true,  // Keep focus on diagram
                preview: false
            });
        }
    }

    /**
     * Get the HTML content for the webview
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        // Get the path to the webview script
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview.js'))
        );

        // Use a nonce to whitelist which scripts can be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>FV-1 Block Diagram Editor</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        
        #root {
            width: 100%;
            height: 100%;
        }
        
        /* Footer styles */
        .footer {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 24px;
            background-color: var(--vscode-statusBar-background);
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 12px;
            font-size: 11px;
            color: var(--vscode-statusBar-foreground);
            z-index: 1000;
        }
        
        .footer-section {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .resource-stats {
            font-weight: 500;
        }
        
        .resource-stats span {
            display: inline-block;
            padding: 2px 8px;
            background-color: var(--vscode-statusBarItem-prominentBackground);
            border-radius: 3px;
        }
        
        .resource-stats .over-limit {
            background-color: var(--vscode-statusBarItem-errorBackground);
            color: var(--vscode-statusBarItem-errorForeground);
        }
        
        /* View toolbar styles */
        .view-toolbar {
            position: absolute;
            top: 0;
            left: 250px;
            right: 0;
            height: 36px;
            background-color: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            padding: 0 12px;
            gap: 8px;
            z-index: 998;
            transition: left 0.2s ease;
        }
        
        .palette.collapsed ~ .view-toolbar {
            left: 0;
        }
        
        .view-button {
            padding: 6px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-family: var(--vscode-font-family);
            transition: background-color 0.15s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .view-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .view-button:active {
            background-color: var(--vscode-button-background);
            opacity: 0.9;
        }
        
        /* Block palette styles */
        .palette {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 24px;
            width: 250px;
            background-color: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-panel-border);
            overflow-y: auto;
            z-index: 999;
            transition: width 0.2s ease;
        }
        
        .palette.collapsed {
            width: 0;
            border-right: none;
        }
        
        .palette-toggle-handle {
            position: absolute;
            left: 250px;
            top: 50%;
            transform: translateY(-50%);
            width: 16px;
            height: 60px;
            background-color: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-left: none;
            border-radius: 0 4px 4px 0;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            transition: left 0.2s ease, background-color 0.15s ease;
            padding: 0;
        }
        
        .palette.collapsed ~ .palette-toggle-handle {
            left: 0;
        }
        
        .palette-toggle-handle:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .palette-toggle-icon {
            font-size: 14px;
            color: var(--vscode-foreground);
            user-select: none;
        }
        
        .palette-content {
            width: 250px;
        }
        
        .palette-category-section {
            /* Container for each category and its blocks */
        }
        
        .palette-category {
            padding: 8px 12px;
            font-weight: bold;
            font-size: 11px;
            text-transform: uppercase;
            color: var(--vscode-descriptionForeground);
            border-top: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            transition: background-color 0.1s;
        }
        
        .palette-category:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .palette-category-section:first-child .palette-category {
            border-top: none;
        }
        
        .category-toggle-icon {
            display: inline-block;
            width: 16px;
            margin-right: 4px;
            font-size: 10px;
        }
        
        .palette-category-blocks {
            /* Container for blocks within a category */
        }
        
        .palette-block {
            padding: 8px 12px;
            cursor: move;
            border-bottom: 1px solid var(--vscode-widget-border);
            transition: background-color 0.1s;
        }
        
        .palette-block:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .palette-block-name {
            font-weight: 500;
            margin-bottom: 2px;
        }
        
        .palette-block-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        
        /* Canvas container */
        .canvas-container {
            position: absolute;
            left: 250px;
            top: 36px;
            right: 0;
            bottom: 24px;
            overflow: hidden;
            transition: left 0.2s ease;
        }
        
        .canvas-container.palette-collapsed {
            left: 16px;
        }
        
        /* Property panel */
        .property-panel {
            position: absolute;
            right: 0;
            top: 36px;
            bottom: 24px;
            width: 300px;
            background-color: var(--vscode-sideBar-background);
            border-left: 1px solid var(--vscode-panel-border);
            padding: 16px;
            overflow-y: auto;
            z-index: 999;
        }
        
        .property-panel.hidden {
            display: none;
        }
        
        .property-panel h3 {
            margin-bottom: 16px;
            font-size: 14px;
        }
        
        .property-group {
            margin-bottom: 16px;
        }
        
        .property-label {
            display: block;
            margin-bottom: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .property-input {
            width: 100%;
            padding: 4px 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        
        .property-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        
        /* Hide number input spinner arrows */
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        
        input[type=number] {
            -moz-appearance: textfield;
            appearance: textfield;
        }
        
        /* Loading indicator */
        .loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div id="root">
        <div class="loading">Loading editor...</div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Parse document text as BlockGraph
     */
    private getDocumentAsGraph(document: vscode.TextDocument): BlockGraph {
        const text = document.getText();
        if (!text.trim()) {
            return createEmptyGraph('New Program');
        }

        try {
            return JSON.parse(text) as BlockGraph;
        } catch {
            return createEmptyGraph('New Program');
        }
    }

    /**
     * Update the document with new graph data
     */
    private updateTextDocument(document: vscode.TextDocument, graph: BlockGraph) {
        const edit = new vscode.WorkspaceEdit();

        // Replace entire document
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(graph, null, 2)
        );

        return vscode.workspace.applyEdit(edit);
    }

    /**
     * Compile the graph to FV-1 assembly
     */
    private async compileGraph(document: vscode.TextDocument, graph: BlockGraph) {
        const compiler = new GraphCompiler(blockRegistry);
        const config = vscode.workspace.getConfiguration('fv1');
        const hardwareOptions = {
            regCount: config.get<number>('hardware.regCount') ?? 32,
            progSize: config.get<number>('hardware.progSize') ?? 128,
            delaySize: config.get<number>('hardware.delaySize') ?? 32768
        };
        const result = compiler.compile(graph, hardwareOptions);

        if (result.success && result.assembly) {
            // Create .spn file path
            const spnPath = document.uri.fsPath.replace('.spndiagram', '.spn');

            // Write assembly to .spn file
            fs.writeFileSync(spnPath, result.assembly, 'utf8');

            // Show success message with statistics
            const stats = result.statistics!;
            const config = vscode.workspace.getConfiguration('fv1');
            const progSize = config.get<number>('hardware.progSize') ?? 128;
            const regCount = config.get<number>('hardware.regCount') ?? 32;
            const delaySize = config.get<number>('hardware.delaySize') ?? 32768;

            vscode.window.showInformationMessage(
                `✅ Compiled successfully! ` +
                `Instructions: ${stats.instructionsUsed}/${progSize}, ` +
                `Registers: ${stats.registersUsed}/${regCount}, ` +
                `Memory: ${stats.memoryUsed}/${delaySize}`
            );

            // Open the .spn file (or bring existing editor to front)
            const doc = await vscode.workspace.openTextDocument(spnPath);

            // Check if file is already open in an editor
            const existingEditor = vscode.window.visibleTextEditors.find(
                editor => editor.document.uri.toString() === doc.uri.toString()
            );

            if (existingEditor) {
                // File already open - bring that editor to the front
                await vscode.window.showTextDocument(doc, {
                    preview: false,
                    viewColumn: existingEditor.viewColumn
                });
            } else {
                // File not open - open beside current editor
                await vscode.window.showTextDocument(doc, {
                    preview: false,
                    viewColumn: vscode.ViewColumn.Beside
                });
            }

            // Show warnings if any
            if (result.warnings && result.warnings.length > 0) {
                vscode.window.showWarningMessage(`Warnings: ${result.warnings.join(', ')}`);
            }
        } else {
            // Show errors
            const errors = result.errors || ['Unknown compilation error'];
            vscode.window.showErrorMessage(`Compilation failed: ${errors[0]}`);

            // Show all errors in output channel
            const outputChannel = vscode.window.createOutputChannel('FV-1 Block Diagram');
            outputChannel.clear();
            outputChannel.appendLine('Compilation Errors:');
            errors.forEach(err => outputChannel.appendLine(`  • ${err}`));
            outputChannel.show();
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
