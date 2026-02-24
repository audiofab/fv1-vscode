/**
 * FV-1 Assembly Hover Provider
 * Provides hover tooltips for instructions and symbols
 */

import * as vscode from 'vscode';
import { getInstructionDoc } from '../core/fv1InstructionDocs.js';
import { FV1DocumentManager } from '../core/fv1DocumentManager.js';

export class FV1HoverProvider implements vscode.HoverProvider {
    private documentManager: FV1DocumentManager;

    constructor(documentManager: FV1DocumentManager) {
        this.documentManager = documentManager;
    }

    /**
     * Provide hover information
     */
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {

        // Get the word at the current position
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_^#]*/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const wordLower = word.toLowerCase();

        // Check if it's an instruction
        const instructionDoc = getInstructionDoc(wordLower);
        if (instructionDoc) {
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**${instructionDoc.name}** - ${instructionDoc.description}\n\n`);
            markdown.appendMarkdown(`**Syntax:** \`${instructionDoc.syntax}\`\n\n`);

            if (instructionDoc.operands) {
                markdown.appendMarkdown(`**Operands:** ${instructionDoc.operands}\n\n`);
            }

            if (instructionDoc.example) {
                markdown.appendCodeblock(instructionDoc.example, 'fv1-assembly');
            }

            return new vscode.Hover(markdown, wordRange);
        }

        // Get symbols from document manager
        const symbols = this.documentManager.getSymbols(document);

        // Build symbol lookup map
        const symbolMap = new Map<string, { value: string; original: string }>();
        for (const symbol of symbols) {
            symbolMap.set(symbol.name.toLowerCase(), { value: symbol.value, original: symbol.original });
        }

        // Check if it's a symbol
        let symbolValue = symbolMap.get(wordLower);
        if (!symbolValue) {
            if (wordLower.endsWith('#') || wordLower.endsWith('^')) {
                // Handle special cases for symbols ending with # or ^
                symbolValue = symbolMap.get(wordLower.slice(0, -1));
            }
        }

        if (symbolValue) {
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**Symbol:** \`${word}\``);
            if (symbolValue.original) {
                markdown.appendMarkdown(`\n\n**Defined as:** \`${symbolValue.original}\``);
            }
            markdown.appendMarkdown(`\n\n**Value:** \`${symbolValue.value}\``);

            // Try to evaluate numeric expressions
            try {
                // Simple evaluation for common cases
                const numericValue = this.evaluateExpression(symbolValue.value);
                if (numericValue !== null) {
                    markdown.appendMarkdown(`\n\n**Decimal:** ${numericValue}`);

                    // For memory addresses, show as hex too
                    if (Number.isInteger(numericValue) && numericValue >= 0) {
                        markdown.appendMarkdown(` (\`0x${numericValue.toString(16).toUpperCase()}\`)`);
                    }
                }
            } catch (e) {
                // Ignore evaluation errors
            }

            return new vscode.Hover(markdown, wordRange);
        }

        return undefined;
    }

    /**
     * Simple expression evaluator for numeric values
     */
    private evaluateExpression(expr: string): number | null {
        const trimmed = expr.trim();

        // Handle hex values ($XXXX)
        if (trimmed.startsWith('$')) {
            const hex = trimmed.substring(1);
            const value = parseInt(hex, 16);
            return isNaN(value) ? null : value;
        }

        // Handle hex values (0xXXXX)
        if (trimmed.toLowerCase().startsWith('0x')) {
            const value = parseInt(trimmed, 16);
            return isNaN(value) ? null : value;
        }

        // Handle register names (REG0-REG31)
        const regMatch = trimmed.match(/^REG(\d+)$/i);
        if (regMatch) {
            return parseInt(regMatch[1]);
        }

        // Handle decimal numbers
        const decimalValue = parseFloat(trimmed);
        if (!isNaN(decimalValue)) {
            return decimalValue;
        }

        // Handle simple integer math expressions
        try {
            // Only allow safe operations: +, -, *, /, numbers
            if (/^[\d+\-*/().\s]+$/.test(trimmed)) {
                // Use Function constructor as a safe eval alternative
                const result = Function(`"use strict"; return (${trimmed})`)();
                return typeof result === 'number' && !isNaN(result) ? result : null;
            }
        } catch (e) {
            // Evaluation failed
        }

        return null;
    }
}
