/**
 * Extension-side wiring for the FV-1 MCP server (src/mcp/server.ts → dist/mcp-server.cjs).
 *
 * Two delivery paths, one bundle:
 *
 *  - Copilot / VS Code MCP host: contributed via `vscode.lm.registerMcpServerDefinitionProvider`
 *    (paired with the `mcpServerDefinitionProviders` contribution in package.json). Auto-discovered
 *    when the extension is installed; the user enables it once from VS Code's MCP UI. Guarded so
 *    the extension still loads on VS Code builds that predate the MCP provider API.
 *
 *  - Claude Code: has its own MCP client and does NOT read VS Code's provider registrations, so we
 *    bootstrap it by writing a project-scoped `.mcp.json` at the workspace root (behind an explicit,
 *    friendly opt-in command). If an entry already exists we silently refresh its path on activation
 *    so extension updates — which change the install path — don't leave a stale command behind.
 *
 * The launched command is VS Code's own Node (Electron run as Node) for the Copilot path so no
 * system Node is required; the Claude Code `.mcp.json` uses `node` from PATH.
 */

import * as vscode from 'vscode';
import { resolveCustomBlockPaths, getAgentWriteDir } from '../blockDiagram/blockLoading.js';

const PROVIDER_ID = 'audiofab-fv1';
const SERVER_LABEL = 'Audiofab FV-1 Patch Builder';
const CLAUDE_OFFER_KEY = 'fv1.mcp.claudeCodeOffered';

/** Absolute path to the bundled stdio server. */
function serverPath(context: vscode.ExtensionContext): string {
    return vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp-server.cjs').fsPath;
}

/**
 * Full argv for the stdio server: the bundle path, one `--custom-block-path` per directory the
 * registry loads (the fv1.customBlockPaths setting + managed fallback), and `--agent-block-path`
 * naming the single dir the server may write new blocks into.
 */
function serverArgs(context: vscode.ExtensionContext): string[] {
    const args = [serverPath(context)];
    for (const p of resolveCustomBlockPaths()) {
        args.push('--custom-block-path', p);
    }
    const writeDir = getAgentWriteDir();
    if (writeDir) {
        args.push('--agent-block-path', writeDir);
    }
    return args;
}

/**
 * Public entry point — call from activate(). Registers the Copilot provider (if the API exists),
 * the Claude Code setup command, and a silent path-refresh for an existing `.mcp.json`.
 */
export function registerMcpIntegration(context: vscode.ExtensionContext): void {
    registerCopilotProvider(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('fv1.setupClaudeCodeMcp', () =>
            setupClaudeCodeMcp(context, /* interactive */ true),
        ),
    );

    // Keep an already-configured Claude Code entry pointing at the current install path.
    void refreshClaudeCodeMcpIfPresent(context);

    // First-run, low-friction nudge (only when a workspace is open, only once).
    void maybeOfferClaudeCodeSetup(context);
}

// ---------------------------------------------------------------------------
// Copilot / VS Code MCP host
// ---------------------------------------------------------------------------
function registerCopilotProvider(context: vscode.ExtensionContext): void {
    const lm = vscode.lm as any;
    const StdioDef = (vscode as any).McpStdioServerDefinition;
    if (typeof lm?.registerMcpServerDefinitionProvider !== 'function' || typeof StdioDef !== 'function') {
        // VS Code too old for the MCP provider API — Copilot integration simply stays dormant.
        // (The Claude Code path and the standalone bundle are unaffected.)
        return;
    }

    const didChange = new vscode.EventEmitter<void>();
    context.subscriptions.push(didChange);

    const provider = {
        onDidChangeMcpServerDefinitions: didChange.event,
        provideMcpServerDefinitions: () => {
            // Run VS Code's bundled Electron as plain Node so no system Node install is needed.
            return [
                new StdioDef(SERVER_LABEL, process.execPath, serverArgs(context), {
                    ELECTRON_RUN_AS_NODE: '1',
                }),
            ];
        },
    };

    try {
        context.subscriptions.push(lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider));
    } catch (err) {
        console.error('[fv1-mcp] failed to register Copilot MCP provider:', err);
        return;
    }

    // Custom-block changes alter the launch args → ask the host to re-read the definition.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('fv1.customBlockPaths')) {
                didChange.fire();
            }
        }),
    );
}

// ---------------------------------------------------------------------------
// Claude Code (.mcp.json)
// ---------------------------------------------------------------------------
function workspaceRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function mcpJsonUri(root: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(root, '.mcp.json');
}

/**
 * The server entry we manage inside `.mcp.json`. Launched via VS Code's own bundled Node
 * (Electron run as Node) so Claude Code needs no separate Node install — just this extension's
 * host. The path is machine-specific (both the VS Code binary and the extension install dir), so
 * `.mcp.json` is inherently local and shouldn't be committed; refreshClaudeCodeMcpIfPresent keeps
 * it current across updates.
 */
function claudeServerEntry(context: vscode.ExtensionContext) {
    return {
        command: process.execPath,
        args: serverArgs(context),
        env: { ELECTRON_RUN_AS_NODE: '1' },
    };
}

async function readJsonFile(uri: vscode.Uri): Promise<any | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
        return undefined; // missing or unreadable
    }
}

async function writeJsonFile(uri: vscode.Uri, value: unknown): Promise<void> {
    const text = JSON.stringify(value, null, 2) + '\n';
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}

/**
 * Create or update the `audiofab-fv1` entry in the workspace `.mcp.json`, merging with any
 * existing content. When interactive, prompts first and reports the outcome.
 */
async function setupClaudeCodeMcp(context: vscode.ExtensionContext, interactive: boolean): Promise<void> {
    const root = workspaceRoot();
    if (!root) {
        if (interactive) {
            vscode.window.showWarningMessage('Open a folder/workspace first — .mcp.json is written at its root.');
        }
        return;
    }

    const uri = mcpJsonUri(root);
    const existing = await readJsonFile(uri);

    // A malformed existing file: don't clobber it silently.
    if (existing !== undefined && typeof existing !== 'object') {
        if (interactive) {
            vscode.window.showErrorMessage('.mcp.json exists but is not a JSON object; leaving it untouched.');
        }
        return;
    }

    if (interactive) {
        const verb = existing?.mcpServers?.[PROVIDER_ID] ? 'Update' : 'Add';
        const choice = await vscode.window.showInformationMessage(
            `${verb} the Audiofab FV-1 patch-builder MCP server in ${vscode.workspace.asRelativePath(uri)} ` +
                `so Claude Code can build .spndiagram patches?`,
            { modal: true },
            'Yes',
        );
        if (choice !== 'Yes') {
            return;
        }
    }

    const doc = existing && typeof existing === 'object' ? existing : {};
    doc.mcpServers = doc.mcpServers && typeof doc.mcpServers === 'object' ? doc.mcpServers : {};
    doc.mcpServers[PROVIDER_ID] = claudeServerEntry(context);

    try {
        await writeJsonFile(uri, doc);
    } catch (err) {
        if (interactive) {
            vscode.window.showErrorMessage(`Failed to write .mcp.json: ${err}`);
        }
        return;
    }

    if (interactive) {
        vscode.window.showInformationMessage(
            'Claude Code MCP server configured. Reload/reopen the folder in Claude Code and approve the ' +
                'server when prompted. (Uses VS Code\'s bundled Node — no separate install needed.)',
        );
    }
}

/**
 * If `.mcp.json` already carries our entry, keep its command/args current (the install path changes
 * across extension updates). Silent — never creates the file, never prompts.
 */
async function refreshClaudeCodeMcpIfPresent(context: vscode.ExtensionContext): Promise<void> {
    const root = workspaceRoot();
    if (!root) {
        return;
    }
    const uri = mcpJsonUri(root);
    const existing = await readJsonFile(uri);
    if (!existing || typeof existing !== 'object' || !existing.mcpServers?.[PROVIDER_ID]) {
        return;
    }
    const desired = claudeServerEntry(context);
    const current = existing.mcpServers[PROVIDER_ID];
    if (JSON.stringify(current) === JSON.stringify(desired)) {
        return; // already up to date
    }
    existing.mcpServers[PROVIDER_ID] = desired;
    try {
        await writeJsonFile(uri, existing);
        console.error('[fv1-mcp] refreshed .mcp.json server path for Claude Code');
    } catch (err) {
        console.error('[fv1-mcp] failed to refresh .mcp.json:', err);
    }
}

/** One-time, dismissible offer to wire up Claude Code (only when a workspace is open). */
async function maybeOfferClaudeCodeSetup(context: vscode.ExtensionContext): Promise<void> {
    if (!workspaceRoot()) {
        return;
    }
    if (context.globalState.get<boolean>(CLAUDE_OFFER_KEY)) {
        return;
    }
    // Don't nag if it's already configured.
    const uri = mcpJsonUri(workspaceRoot()!);
    const existing = await readJsonFile(uri);
    if (existing?.mcpServers?.[PROVIDER_ID]) {
        await context.globalState.update(CLAUDE_OFFER_KEY, true);
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        'Enable AI patch building for Claude Code? This adds an FV-1 MCP server to this workspace so ' +
            'agents can create and validate .spndiagram patches.',
        'Enable',
        "Don't ask again",
    );
    if (choice === 'Enable') {
        await setupClaudeCodeMcp(context, /* interactive */ true);
        await context.globalState.update(CLAUDE_OFFER_KEY, true);
    } else if (choice === "Don't ask again") {
        await context.globalState.update(CLAUDE_OFFER_KEY, true);
    }
}
