/**
 * Block Diagram Document Manager
 * 
 * Centralized manager for compiling block diagrams.
 * Provides cached compilation results and resource tracking.
 * Automatically re-compiles documents when they change.
 */

import * as vscode from 'vscode';
import { BlockGraph } from './types/Graph.js';
import { GraphCompiler, CompilationResult } from './compiler/GraphCompiler.js';
import { BlockRegistry } from './blocks/BlockRegistry.js';

interface DocumentInfo {
    version: number;
    result: CompilationResult;
}

export class BlockDiagramDocumentManager {
    private compiler: GraphCompiler;
    private documentCache: Map<string, DocumentInfo> = new Map();
    private diagnosticCollection: vscode.DiagnosticCollection;
    private changeListeners: Set<(uri: vscode.Uri) => void> = new Set();

    constructor(diagnosticCollection: vscode.DiagnosticCollection, registry: BlockRegistry) {
        this.compiler = new GraphCompiler(registry);
        this.diagnosticCollection = diagnosticCollection;
    }

    /**
     * Get the compilation result for a document.
     * Results are cached per document version.
     */
    public getCompilationResult(document: vscode.TextDocument): CompilationResult {
        const documentUri = document.uri.toString();
        const cached = this.documentCache.get(documentUri);

        // Check if we have a valid cached result
        if (cached && cached.version === document.version) {
            return cached.result;
        }

        // Compile the document
        const result = this.compileDocument(document);

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
     * Compile a document and return the result
     */
    private compileDocument(document: vscode.TextDocument): CompilationResult {
        try {
            const content = document.getText();
            const graph: BlockGraph = JSON.parse(content);
            const config = vscode.workspace.getConfiguration('fv1');
            const hardwareOptions = {
                regCount: config.get<number>('hardware.regCount') ?? 32,
                progSize: config.get<number>('hardware.progSize') ?? 128,
                delaySize: config.get<number>('hardware.delaySize') ?? 32768
            };
            return this.compiler.compile(graph, hardwareOptions);
        } catch (error) {
            return {
                success: false,
                errors: [`Failed to parse block diagram: ${error}`]
            };
        }
    }

    /**
     * Update diagnostics for a document based on compilation result
     */
    private updateDiagnostics(uri: vscode.Uri, result: CompilationResult): void {
        const diagnostics: vscode.Diagnostic[] = [];

        // Add errors
        if (result.errors && result.errors.length > 0) {
            for (const error of result.errors) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(0, 0, 0, 1000),
                    error,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'block-diagram';
                diagnostics.push(diagnostic);
            }
        }

        // Add warnings
        if (result.warnings && result.warnings.length > 0) {
            for (const warning of result.warnings) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(0, 0, 0, 1000),
                    warning,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'block-diagram';
                diagnostics.push(diagnostic);
            }
        }

        this.diagnosticCollection.set(uri, diagnostics);
    }

    /**
     * Get cached compilation result by URI (if available).
     * Returns undefined if no cached result exists.
     */
    public getCachedCompilationResult(uri: vscode.Uri): CompilationResult | undefined {
        const cached = this.documentCache.get(uri.toString());
        return cached?.result;
    }

    /**
     * Handle document changes
     */
    public async onDocumentChange(document: vscode.TextDocument): Promise<void> {
        if (!document.fileName.toLowerCase().endsWith('.spndiagram')) {
            return;
        }

        // Auto-save dirty documents before compilation
        if (document.isDirty) {
            await document.save();
        }

        // Trigger compilation and diagnostics update
        this.getCompilationResult(document);
    }

    /**
     * Register a listener for compilation changes
     */
    public onCompilationChange(listener: (uri: vscode.Uri) => void): vscode.Disposable {
        this.changeListeners.add(listener);
        return new vscode.Disposable(() => {
            this.changeListeners.delete(listener);
        });
    }

    /**
     * Notify all listeners that a document was recompiled
     */
    private notifyListeners(uri: vscode.Uri): void {
        for (const listener of this.changeListeners) {
            listener(uri);
        }
    }

    /**
     * Clear cached result for a document
     */
    public clearCache(uri: vscode.Uri): void {
        this.documentCache.delete(uri.toString());
        this.diagnosticCollection.delete(uri);
    }

    /**
     * Clear all cached results
     */
    public clearAllCaches(): void {
        this.documentCache.clear();
        this.diagnosticCollection.clear();
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.clearAllCaches();
        this.changeListeners.clear();
    }
}
