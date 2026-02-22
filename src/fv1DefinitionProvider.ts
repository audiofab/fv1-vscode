/**
 * FV-1 Assembly Definition Provider
 * Provides "Go to Definition" (Ctrl+Click) navigation for symbols
 */

import * as vscode from 'vscode';
import { FV1DocumentManager } from './fv1DocumentManager.js';

export class FV1DefinitionProvider implements vscode.DefinitionProvider {
    private documentManager: FV1DocumentManager;

    constructor(documentManager: FV1DocumentManager) {
        this.documentManager = documentManager;
    }

    /**
     * Provide definition location for a symbol
     */
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition> {
        // Get the word at the current position
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_\\.^#]*/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const wordLower = word.toLowerCase();

        console.log(`[Definition] Looking up definition for: "${word}"`);

        // Get symbols from document manager
        const symbols = this.documentManager.getSymbols(document);

        // Find the symbol
        let symbol = symbols.find(s => s.name.toLowerCase() === wordLower);
        if (!symbol) {
            if (wordLower.endsWith('#') || wordLower.endsWith('^')) {
                // Handle special cases for symbols ending with # or ^
                symbol = symbols.find(s => s.name.toLowerCase() === wordLower.slice(0, -1));
            }
        }

        if (symbol && symbol.line !== undefined) {
            console.log(`[Definition] Found symbol at line ${symbol.line}`);

            // Create a location pointing to the symbol definition
            // Line numbers from assembler are 1-based, VS Code uses 0-based
            const line = Math.max(0, symbol.line - 1);
            const position = new vscode.Position(line, 0);
            const location = new vscode.Location(document.uri, position);

            return location;
        }

        console.log(`[Definition] Symbol "${word}" not found in symbol table`);
        return undefined;
    }
}