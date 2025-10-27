/**
 * VS Code Custom Editor Provider for .spndiagram files
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BlockGraph, createEmptyGraph } from '../types/Graph.js';
import { GraphCompiler } from '../compiler/GraphCompiler.js';
import { blockRegistry } from '../blocks/BlockRegistry.js';

export class BlockDiagramEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'fv1.blockDiagramEditor';
    
    private static readonly webviewScriptUri = 'out/webview.js';
    
    constructor(
        private readonly context: vscode.ExtensionContext
    ) {}
    
    /**
     * Register this custom editor provider
     */
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new BlockDiagramEditorProvider(context);
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
        
        // Load and send the initial document content
        const updateWebview = () => {
            const graph = this.getDocumentAsGraph(document);
            webviewPanel.webview.postMessage({
                type: 'init',
                graph: graph
            });
        };
        
        // Hook up event handlers
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
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
                    return;
                    
                case 'update':
                    this.updateTextDocument(document, e.graph);
                    return;
                    
                case 'getBlockMetadata':
                    webviewPanel.webview.postMessage({
                        type: 'blockMetadata',
                        metadata: blockRegistry.getAllMetadata()
                    });
                    return;
                    
                case 'savePaletteState':
                    // Save the expanded categories to workspace state
                    await this.context.workspaceState.update('blockDiagram.expandedCategories', e.expandedCategories);
                    return;
                    
                case 'error':
                    vscode.window.showErrorMessage(e.message);
                    return;
            }
        });
        
        // Clean up when the editor is closed
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }
    
    /**
     * Get the HTML content for the webview
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        // Get the path to the webview script
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'out', 'webview.js'))
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
        
        /* Toolbar styles */
        .toolbar {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 48px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            padding: 0 12px;
            gap: 8px;
            z-index: 1000;
        }
        
        .toolbar button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 13px;
        }
        
        .toolbar button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .toolbar .stats {
            margin-left: auto;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        /* Block palette styles */
        .palette {
            position: absolute;
            left: 0;
            top: 48px;
            bottom: 0;
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
            top: 48px;
            right: 0;
            bottom: 0;
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
            top: 48px;
            bottom: 0;
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
        const result = compiler.compile(graph);
        
        if (result.success && result.assembly) {
            // Create .spn file path
            const spnPath = document.uri.fsPath.replace('.spndiagram', '.spn');
            
            // Write assembly to .spn file
            fs.writeFileSync(spnPath, result.assembly, 'utf8');
            
            // Show success message with statistics
            const stats = result.statistics!;
            vscode.window.showInformationMessage(
                `✅ Compiled successfully! ` +
                `Instructions: ${stats.instructionsUsed}/128, ` +
                `Registers: ${stats.registersUsed}/32, ` +
                `Memory: ${stats.memoryUsed}/32768`
            );
            
            // Open the .spn file
            const doc = await vscode.workspace.openTextDocument(spnPath);
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
            
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
