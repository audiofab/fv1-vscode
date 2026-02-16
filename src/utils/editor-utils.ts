import * as vscode from 'vscode';

/**
 * Helper function to get the active document URI
 * Works for both text editors and custom editors (like .spndiagram)
 */
export function getActiveDocumentUri(): vscode.Uri | undefined {
    // First, try active text editor
    if (vscode.window.activeTextEditor) {
        return vscode.window.activeTextEditor.document.uri;
    }

    // If no text editor, try to get the active tab (for custom editors)
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab?.input) {
        const input = activeTab.input as any;
        if (input.uri) {
            return input.uri;
        }
    }

    return undefined;
}
