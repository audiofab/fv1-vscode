/**
 * Custom Editor Provider for .spnbank files
 * Provides a drag-and-drop interface for managing program slots in an FV-1 bank
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface BankData {
    name?: string;
    slots: Array<{ slot: number; path: string }>;
}

export class SpnBankEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new SpnBankEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            SpnBankEditorProvider.viewType,
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

    private static readonly viewType = 'audiofab.spnBankEditor';

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Called when our custom editor is opened.
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup initial webview content
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Parse and send initial bank data
        const bankData = this.parseDocument(document);
        webviewPanel.webview.postMessage({ type: 'init', data: bankData });

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async e => {
            switch (e.type) {
                case 'update':
                    await this.updateDocument(document, e.data);
                    return;
                
                case 'openFile':
                    this.openSlotFile(document, e.slotPath);
                    return;
                
                case 'assignSlotFromUri':
                    await this.assignSlotFromUri(document, e.slotNumber, e.uri, webviewPanel);
                    return;
                
                case 'programSlot':
                    await this.programSlot(document, e.slotNumber);
                    return;
                
                case 'createNewFile':
                    await this.createNewFile(document, e.slotNumber, e.fileType);
                    return;
                
                case 'programBank':
                    await this.programBank(document);
                    return;
                
                case 'exportToHex':
                    await this.exportToHex(document);
                    return;
            }
        });

        // Update webview when document changes externally
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                const updatedData = this.parseDocument(document);
                webviewPanel.webview.postMessage({ type: 'update', data: updatedData });
            }
        });

        // Clean up when webview is disposed
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    /**
     * Parse the document text as BankData
     */
    private parseDocument(document: vscode.TextDocument): BankData {
        const text = document.getText();
        if (!text.trim()) {
            return {
                name: path.basename(document.uri.fsPath, '.spnbank'),
                slots: new Array(8).fill(null).map((_, i) => ({ slot: i + 1, path: '' }))
            };
        }

        try {
            const json = JSON.parse(text);
            return {
                name: json.name || path.basename(document.uri.fsPath, '.spnbank'),
                slots: Array.isArray(json.slots)
                    ? json.slots
                    : new Array(8).fill(null).map((_, i) => ({ slot: i + 1, path: '' }))
            };
        } catch {
            return {
                name: path.basename(document.uri.fsPath, '.spnbank'),
                slots: new Array(8).fill(null).map((_, i) => ({ slot: i + 1, path: '' }))
            };
        }
    }

    /**
     * Update the document with new bank data
     */
    private async updateDocument(document: vscode.TextDocument, data: BankData) {
        const edit = new vscode.WorkspaceEdit();
        const json = JSON.stringify(data, null, 2);
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            json
        );
        await vscode.workspace.applyEdit(edit);
        // Auto-save after applying the edit
        await document.save();
    }

    /**
     * Assign a slot from a dropped URI (calculates relative path)
     */
    private async assignSlotFromUri(
        document: vscode.TextDocument, 
        slotNumber: number, 
        uriString: string,
        webviewPanel: vscode.WebviewPanel
    ) {
        try {
            // Parse the URI
            const fileUri = vscode.Uri.parse(uriString);
            const fileName = path.basename(fileUri.fsPath);
            
            // Check if it's a .spn or .spndiagram file
            if (!fileName.endsWith('.spn') && !fileName.endsWith('.spndiagram')) {
                vscode.window.showErrorMessage('Only .spn and .spndiagram files can be assigned to slots');
                return;
            }
            
            // Calculate relative path from bank file to dropped file
            const bankDir = path.dirname(document.uri.fsPath);
            const relativePath = path.relative(bankDir, fileUri.fsPath);
            
            // Update the bank data
            const bankData = this.parseDocument(document);
            const updatedSlots = bankData.slots.map(slot =>
                slot.slot === slotNumber ? { ...slot, path: relativePath } : slot
            );
            
            const updatedData: BankData = {
                ...bankData,
                slots: updatedSlots
            };
            
            // Save to document
            await this.updateDocument(document, updatedData);
            
            // Update webview
            webviewPanel.webview.postMessage({ type: 'update', data: updatedData });
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to assign slot: ${error}`);
        }
    }

    /**
     * Open the file assigned to a slot
     */
    private async openSlotFile(document: vscode.TextDocument, slotPath: string) {
        if (!slotPath) return;
        
        const bankDir = path.dirname(document.uri.fsPath);
        const fullPath = path.resolve(bankDir, slotPath);
        const uri = vscode.Uri.file(fullPath);
        
        try {
            // Check if it's a .spndiagram file and open with block diagram editor
            if (slotPath.toLowerCase().endsWith('.spndiagram')) {
                await vscode.commands.executeCommand('vscode.openWith', uri, 'fv1.blockDiagramEditor');
            } else {
                await vscode.window.showTextDocument(uri);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${slotPath}`);
        }
    }

    /**
     * Program a specific slot to hardware
     */
    private async programSlot(document: vscode.TextDocument, slotNumber: number) {
        // Trigger the fv1.programThisSlot command with the bank URI and slot number
        // Create a fake tree item to pass the context
        const treeItem = {
            bankUri: document.uri,
            slot: slotNumber
        };
        
        await vscode.commands.executeCommand('fv1.programThisSlot', treeItem);
    }

    /**
     * Program the entire bank to hardware
     */
    private async programBank(document: vscode.TextDocument) {
        // Create a context object with the resourceUri (like the tree view item would have)
        const context = {
            resourceUri: document.uri
        };
        
        await vscode.commands.executeCommand('fv1.programSpnBank', context);
    }

    /**
     * Export the bank to Intel HEX format
     */
    private async exportToHex(document: vscode.TextDocument) {
        // Create a context object with the resourceUri (like the tree view item would have)
        const context = {
            resourceUri: document.uri
        };
        
        await vscode.commands.executeCommand('fv1.exportBankToHex', context);
    }

    /**
     * Create a new file and assign it to the slot
     */
    private async createNewFile(document: vscode.TextDocument, slotNumber: number, fileType: 'spn' | 'spndiagram') {
        const bankDir = path.dirname(document.uri.fsPath);
        const extension = fileType === 'spn' ? '.spn' : '.spndiagram';
        const defaultName = `program${slotNumber}`;
        
        // Prompt for filename with pre-selected root name
        const fileName = await vscode.window.showInputBox({
            prompt: `Enter filename for new ${fileType.toUpperCase()} file`,
            placeHolder: `${defaultName}${extension}`,
            value: `${defaultName}${extension}`,
            valueSelection: [0, defaultName.length], // Select only the root name, not the extension
            validateInput: (value) => {
                if (!value) return 'Filename cannot be empty';
                if (!value.endsWith(extension)) return `Filename must end with ${extension}`;
                const fullPath = path.join(bankDir, value);
                if (fs.existsSync(fullPath)) return 'File already exists';
                return null;
            }
        });
        
        if (!fileName) return; // User cancelled
        
        const filePath = path.join(bankDir, fileName);
        
        try {
            // Create the file with appropriate content
            if (fileType === 'spn') {
                // Create a basic .spn template
                const spnTemplate = `; FV-1 Program - ${fileName}
; Created: ${new Date().toLocaleDateString()}

; Your code here
; Example:
; rdax ADCL, 1.0
; wrax DACL, 0
`;
                fs.writeFileSync(filePath, spnTemplate, 'utf8');
            } else {
                // Create a .spndiagram file using the template
                const templatePath = path.join(this.context.extensionPath, 'resources', 'templates', 'default-diagram.json');
                const templateContent = fs.readFileSync(templatePath, 'utf8');
                const template = JSON.parse(templateContent);
                
                // Update metadata
                template.metadata.name = path.basename(fileName, '.spndiagram');
                template.metadata.description = `Created: ${new Date().toLocaleDateString()}`;
                
                fs.writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf8');
            }
            
            // Update the bank data to assign this file to the slot
            const bankData = this.parseDocument(document);
            const updatedSlots = bankData.slots.map(slot =>
                slot.slot === slotNumber ? { ...slot, path: fileName } : slot
            );
            
            await this.updateDocument(document, {
                ...bankData,
                slots: updatedSlots
            });
            
            // Open the newly created file
            const fileUri = vscode.Uri.file(filePath);
            if (fileType === 'spndiagram') {
                await vscode.commands.executeCommand('vscode.openWith', fileUri, 'fv1.blockDiagramEditor');
            } else {
                await vscode.window.showTextDocument(fileUri);
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create file: ${error}`);
        }
    }

    /**
     * Get the HTML content for the webview
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'SpinBankWebView.js')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>FV-1 Program Bank</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        html, body {
            width: 100%;
            height: 100%;
            overflow: auto;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        
        #root {
            width: 100%;
            min-height: 100%;
            padding: 20px;
        }
        
        .bank-header {
            margin-bottom: 20px;
            display: flex;
            gap: 12px;
        }
        
        .bank-action-button {
            padding: 8px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: background-color 0.15s ease;
        }
        
        .bank-action-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .bank-action-button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .bank-action-button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .slots-container {
            display: grid;
            gap: 12px;
            max-width: 800px;
        }
        
        .slot {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            background-color: var(--vscode-list-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            cursor: default;
            transition: background-color 0.15s ease;
        }
        
        .slot.drag-over {
            background-color: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }
        
        .slot.assigned {
            background-color: var(--vscode-list-activeSelectionBackground);
        }
        
        .slot:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .slot-number {
            font-weight: 600;
            font-size: 14px;
            min-width: 80px;
            color: var(--vscode-foreground);
        }
        
        .slot-content {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .slot-icon {
            width: 16px;
            height: 16px;
            opacity: 0.7;
        }
        
        .slot-path {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
        }
        
        .slot-path:hover {
            text-decoration: underline;
        }
        
        .slot-empty {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            margin-bottom: 8px;
        }
        
        .create-buttons {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .create-file-button {
            padding: 4px 10px;
            background-color: transparent;
            color: var(--vscode-textLink-foreground);
            border: 1px solid var(--vscode-textLink-foreground);
            border-radius: 2px;
            cursor: pointer;
            font-size: 11px;
            transition: all 0.15s ease;
        }
        
        .create-file-button:hover {
            background-color: var(--vscode-textLink-foreground);
            color: var(--vscode-button-foreground);
        }
        
        .slot-actions {
            display: flex;
            gap: 8px;
        }
        
        .slot-button {
            padding: 4px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
        }
        
        .slot-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .slot-button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .slot-button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div id="root">
        <div class="bank-header">
            <button class="bank-action-button" id="programBankBtn">🔧 Program Bank</button>
            <button class="bank-action-button secondary" id="exportToHexBtn">💾 Export to .hex</button>
        </div>
        <div class="slots-container"></div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
