import * as vscode from 'vscode';
import { AssemblyService } from '../services/AssemblyService.js';

export class FV1DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private assemblyService: AssemblyService) { }

    async resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, _token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration | undefined> {
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'fv1-assembly') {
                config.type = 'fv1-debug';
                config.name = 'Launch FV-1 Simulator';
                config.request = 'launch';
                config.program = '${file}';
                config.stopOnEntry = true;
            }
        }

        if (!config.program) {
            vscode.window.showInformationMessage("Cannot find a program to debug");
            return undefined;
        }

        // Pre-launch validation: Check if the program compiles
        let programPath = config.program;
        if (programPath === '${file}' && vscode.window.activeTextEditor) {
            programPath = vscode.window.activeTextEditor.document.uri.fsPath;
        }

        const result = await this.assemblyService.assembleFile(programPath);
        if (!result || result.problems.some(p => p.isfatal)) {
            const errorMsg = result && result.problems.length > 0
                ? result.problems.find(p => p.isfatal)?.message
                : "Critical errors in program preventing simulation";

            const showProblems = 'Show Problems';
            vscode.window.showErrorMessage(`Simulation failed: ${errorMsg}`, showProblems).then(selection => {
                if (selection === showProblems) {
                    vscode.commands.executeCommand('workbench.action.problems.focus');
                }
            });

            // Returning undefined cancels the launch silently (no VS Code modal)
            return undefined;
        }

        return config;
    }
}
