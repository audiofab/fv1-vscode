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

/**
 * Robustly resolve a path or URI string to a vscode.Uri object.
 * Handles local filesystem paths, file:/// URIs, and other schemes.
 */
export function resolveToUri(pathOrUri: string): vscode.Uri {
    if (pathOrUri.includes('://')) {
        try {
            return vscode.Uri.parse(pathOrUri);
        } catch {
            // Fallback to file if parse fails
            return vscode.Uri.file(pathOrUri);
        }
    }
    return vscode.Uri.file(pathOrUri);
}
