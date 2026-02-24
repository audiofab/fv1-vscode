import * as vscode from 'vscode';
import { FV1DocumentManager } from '../core/fv1DocumentManager.js';
import { BlockDiagramDocumentManager } from '../blockDiagram/BlockDiagramDocumentManager.js';
import { getActiveDocumentUri } from '../core/editor-utils.js';

export class StatusBarService implements vscode.Disposable {
    private instructionsStatusBar: vscode.StatusBarItem;
    private registersStatusBar: vscode.StatusBarItem;
    private memoryStatusBar: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private fv1DocumentManager: FV1DocumentManager,
        private blockDiagramDocumentManager: BlockDiagramDocumentManager
    ) {
        this.instructionsStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 103);
        this.registersStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
        this.memoryStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);

        this.instructionsStatusBar.tooltip = 'FV-1 Instructions Used';
        this.registersStatusBar.tooltip = 'FV-1 Registers Used';
        this.memoryStatusBar.tooltip = 'FV-1 Delay Memory Used';

        this.disposables.push(
            this.instructionsStatusBar,
            this.registersStatusBar,
            this.memoryStatusBar,
            vscode.window.onDidChangeActiveTextEditor(editor => this.update(editor?.document)),
            this.blockDiagramDocumentManager.onCompilationChange(uri => this.handleUriChange(uri)),
            this.fv1DocumentManager.addChangeListener(uri => this.handleUriChange(uri))
        );

        this.update(vscode.window.activeTextEditor?.document);
    }

    private handleUriChange(uri: vscode.Uri) {
        const activeUri = getActiveDocumentUri();
        if (activeUri && activeUri.toString() === uri.toString()) {
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
            if (doc) this.update(doc);
        }
    }

    public update(document: vscode.TextDocument | undefined) {
        if (!document) {
            this.hideAll();
            return;
        }

        const fileName = document.fileName.toLowerCase();
        let stats: { instructionsUsed: number; registersUsed: number; memoryUsed: number } | undefined;

        if (document.uri.scheme === 'fv1-assembly') {
            const originalPath = document.uri.path.replace(/\.spn$/, '');
            const originalUri = vscode.Uri.file(originalPath);
            const cachedResult = this.blockDiagramDocumentManager.getCachedCompilationResult(originalUri);
            if (cachedResult?.statistics) stats = cachedResult.statistics;
        } else if (fileName.endsWith('.spndiagram')) {
            const result = this.blockDiagramDocumentManager.getCompilationResult(document);
            if (result.statistics) stats = result.statistics;
        } else if (fileName.endsWith('.spn')) {
            const result = this.fv1DocumentManager.getAssemblyResult(document);
            if (result.machineCode && result.machineCode.length > 0) {
                const NOP_ENCODING = 0x00000011;
                const instructionCount = result.machineCode.filter(code => code !== NOP_ENCODING).length;
                stats = {
                    instructionsUsed: instructionCount,
                    registersUsed: result.usedRegistersCount,
                    memoryUsed: result.memories.reduce((total, mem) => total + mem.size, 0)
                };
            }
        }

        if (!stats) {
            this.hideAll();
            return;
        }

        const config = vscode.workspace.getConfiguration('fv1');
        const maxInstructions = config.get<number>('hardware.progSize') ?? 128;
        const maxRegisters = config.get<number>('hardware.regCount') ?? 32;
        const maxMemory = config.get<number>('hardware.delaySize') ?? 32768;

        this.updateItem(this.instructionsStatusBar, stats.instructionsUsed, maxInstructions, '$(circuit-board)');

        if (stats.registersUsed > 0 || fileName.endsWith('.spndiagram')) {
            this.updateItem(this.registersStatusBar, stats.registersUsed, maxRegisters, '$(database)');
        } else {
            this.registersStatusBar.hide();
        }

        this.updateItem(this.memoryStatusBar, stats.memoryUsed, maxMemory, '$(pulse)');
    }

    private updateItem(item: vscode.StatusBarItem, used: number, max: number, icon: string) {
        item.text = `${icon} ${used}/${max}`;
        const percent = used / max;
        if (used > max) {
            item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (percent >= 0.8) {
            item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            item.backgroundColor = undefined;
        }
        item.show();
    }

    private hideAll() {
        this.instructionsStatusBar.hide();
        this.registersStatusBar.hide();
        this.memoryStatusBar.hide();
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}