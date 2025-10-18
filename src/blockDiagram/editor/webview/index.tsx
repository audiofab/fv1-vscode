/**
 * Main webview React application entry point
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BlockDiagramEditor } from './components/BlockDiagramEditor';

// Get the VS Code API
declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

// Wait for DOM to be ready
console.log('[Webview] Script loaded');

function initializeApp() {
    console.log('[Webview] Initializing app...');
    const container = document.getElementById('root');
    
    if (!container) {
        console.error('[Webview] Root container not found!');
        return;
    }
    
    console.log('[Webview] Root container found, creating React root...');
    const root = createRoot(container);
    root.render(<BlockDiagramEditor vscode={vscode} />);
    console.log('[Webview] React app rendered');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
