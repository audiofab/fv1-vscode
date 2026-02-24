/**
 * FV-1 Document Manager
 * 
 * Centralized manager for parsing/assembling FV-1 documents.
 * Provides cached assembly results to hover providers, definition providers, and diagnostics.
 * Automatically re-assembles documents when they change.
 */

import * as vscode from 'vscode';
import { FV1Assembler, FV1AssemblerResult } from '../assembler/FV1Assembler.js';

interface DocumentInfo {
    version: number;
    result: FV1AssemblerResult;
}

export class FV1DocumentManager {
    private assembler: FV1Assembler;
    private documentCache: Map<string, DocumentInfo> = new Map();
    private diagnosticCollection: vscode.DiagnosticCollection;
    private changeListeners: Set<(uri: vscode.Uri) => void> = new Set();

    constructor(diagnosticCollection: vscode.DiagnosticCollection) {
        const config = vscode.workspace.getConfiguration('fv1');
        this.assembler = new FV1Assembler({
            fv1AsmMemBug: config.get<boolean>('spinAsmMemBug') ?? true,
            clampReals: config.get<boolean>('clampReals') ?? true,
            regCount: config.get<number>('hardware.regCount'),
            progSize: config.get<number>('hardware.progSize'),
            delaySize: config.get<number>('hardware.delaySize'),
        });
        this.diagnosticCollection = diagnosticCollection;
    }

    /**
     * Get the assembly result for a document.
     * Results are cached per document version.
     */
    public getAssemblyResult(document: vscode.TextDocument): FV1AssemblerResult {
        const documentUri = document.uri.toString();
        const cached = this.documentCache.get(documentUri);

        // Check if we have a valid cached result
        if (cached && cached.version === document.version) {
            return cached.result;
        }

        // Assemble the document
        const result = this.assembleDocument(document);

        // Cache the result
        this.documentCache.set(documentUri, {
            version: document.version,
            result: result
        });

        // Update diagnostics
        this.updateDiagnostics(document.uri, result);

        // Notify listeners
        this.notifyListeners(document.uri);

        return result;
    }

    /**
     * Assemble a document and return the result
     */
    private assembleDocument(document: vscode.TextDocument): FV1AssemblerResult {
        const content = document.getText();
        return this.assembler.assemble(content);
    }

    /**
     * Update diagnostics for a document based on assembly result
     */
    private updateDiagnostics(uri: vscode.Uri, result: FV1AssemblerResult): void {
        const diagnostics: vscode.Diagnostic[] = [];

        if (result.problems && result.problems.length > 0) {
            for (const problem of result.problems) {
                const line = Math.max(0, problem.line - 1); // Convert to 0-based
                const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
                const severity = problem.isfatal
                    ? vscode.DiagnosticSeverity.Error
                    : vscode.DiagnosticSeverity.Warning;

                const diagnostic = new vscode.Diagnostic(range, problem.message, severity);
                diagnostic.source = 'fv1-assembler';
                diagnostics.push(diagnostic);
            }
        }

        this.diagnosticCollection.set(uri, diagnostics);
    }

    /**
     * Handle document changes
     */
    public onDocumentChange(document: vscode.TextDocument): void {
        if (document.languageId !== 'fv1-assembly') {
            return;
        }

        // Trigger assembly and diagnostics update
        this.getAssemblyResult(document);
    }

    /**
     * Handle document close - clean up cache
     */
    public onDocumentClose(document: vscode.TextDocument): void {
        const documentUri = document.uri.toString();
        this.documentCache.delete(documentUri);
        this.diagnosticCollection.delete(document.uri);
    }

    /**
     * Handle document open - initial assembly
     */
    public onDocumentOpen(document: vscode.TextDocument): void {
        if (document.languageId !== 'fv1-assembly') {
            return;
        }

        // Trigger initial assembly
        this.getAssemblyResult(document);
    }

    /**
     * Register a listener to be notified when a document is assembled
     */
    public addChangeListener(listener: (uri: vscode.Uri) => void): vscode.Disposable {
        this.changeListeners.add(listener);
        return new vscode.Disposable(() => {
            this.changeListeners.delete(listener);
        });
    }

    /**
     * Notify all listeners that a document has been assembled
     */
    private notifyListeners(uri: vscode.Uri): void {
        for (const listener of this.changeListeners) {
            listener(uri);
        }
    }

    /**
     * Force re-assembly of all open documents
     * Useful when configuration changes
     */
    public refreshAll(): void {
        // Update assembler configuration
        const config = vscode.workspace.getConfiguration('fv1');
        this.assembler = new FV1Assembler({
            fv1AsmMemBug: config.get<boolean>('spinAsmMemBug') ?? true,
            clampReals: config.get<boolean>('clampReals') ?? true,
            regCount: config.get<number>('hardware.regCount'),
            progSize: config.get<number>('hardware.progSize'),
            delaySize: config.get<number>('hardware.delaySize'),
        });

        // Clear cache
        this.documentCache.clear();

        // Re-assemble all open FV-1 documents
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId === 'fv1-assembly') {
                this.getAssemblyResult(document);
            }
        }
    }

    /**
     * Get symbol information from the assembly result
     */
    public getSymbols(document: vscode.TextDocument): Array<{ name: string; value: string; line?: number; original?: string }> {
        const result = this.getAssemblyResult(document);
        const symbols: Array<{ name: string; value: string; line?: number; original?: string }> = [];

        // Add EQU symbols
        if (result.symbols) {
            for (const symbol of result.symbols) {
                symbols.push({
                    name: symbol.name,
                    value: symbol.value,
                    line: symbol.line,
                    original: symbol.original
                });
            }
        }

        // Add labels
        if (result.labels) {
            for (const [name, info] of result.labels.entries()) {
                symbols.push({
                    name: name,
                    value: `Label at PC ${info.instructionLine}`,
                    line: info.line
                });
            }
        }

        // Add MEM symbols
        if (result.memories) {
            for (const memory of result.memories) {
                symbols.push({
                    name: memory.name,
                    value: `Delay memory block ${memory.start ?? 0}/${memory.end ?? 0} (start/end)`,
                    line: memory.line,
                    original: memory.original
                });
            }
        }

        return symbols;
    }
}
