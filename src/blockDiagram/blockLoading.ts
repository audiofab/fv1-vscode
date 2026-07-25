/**
 * Centralized block-registry loading for the extension host.
 *
 * The registry is populated from:
 *   1. the built-in manifest (BUILTIN_BLOCKS),
 *   2. the user's `fv1.customBlockPaths` directories (the setting), and
 *   3. a managed fallback dir — `<workspaceRoot>/.fv1/blocks` — used only when the setting is
 *      empty, so agent-authored blocks still have somewhere to live with zero configuration.
 *
 * The MCP server writes `.atl` blocks it authors on the fly (src/mcp/server.ts create_custom_block)
 * into the **agent write dir** (see getAgentWriteDir): the first configured custom path if the
 * setting is set, otherwise the managed fallback. Keeping all of this in one place means
 * extension.ts, the `fv1.refreshBlocks` command, the MCP launch args, and the file watcher all
 * agree on exactly which directories are loaded and where new blocks are written.
 */

import * as vscode from 'vscode';
import { blockRegistry, BUILTIN_BLOCKS } from '@audiofab-io/fv1-core/blockDiagram';
import { loadBlocksFromDirectory } from '@audiofab-io/fv1-core/blockDiagram/node';

/** The user's `fv1.customBlockPaths` setting. */
export function getConfiguredBlockPaths(): string[] {
    return vscode.workspace.getConfiguration('fv1').get<string[]>('customBlockPaths') || [];
}

/**
 * Managed fallback dir for the current workspace (`<root>/.fv1/blocks`), or `undefined` when no
 * folder is open. Not created here — the MCP server creates it lazily on first write, and
 * `loadBlocksFromDirectory` tolerates a missing dir.
 */
export function getManagedBlockDir(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return root ? vscode.Uri.joinPath(root, '.fv1', 'blocks').fsPath : undefined;
}

/**
 * Where the agent writes new `.atl` blocks: the first configured custom path if the setting is
 * set (respecting the user's existing `fv1.customBlockPaths`), else the managed fallback.
 * `undefined` only when the setting is empty AND no workspace is open.
 */
export function getAgentWriteDir(): string | undefined {
    const configured = getConfiguredBlockPaths();
    return configured.length > 0 ? configured[0] : getManagedBlockDir();
}

/** All directories the registry should load from (deduped): configured paths + managed fallback. */
export function resolveCustomBlockPaths(): string[] {
    const paths = [...getConfiguredBlockPaths()];
    const managed = getManagedBlockDir();
    if (managed && !paths.includes(managed)) {
        paths.push(managed);
    }
    return paths;
}

/** Rebuild the shared registry from the manifest + all resolved custom directories. */
export function reloadBlocks(): void {
    blockRegistry.clear();
    blockRegistry.loadManifest(BUILTIN_BLOCKS);
    for (const dir of resolveCustomBlockPaths()) {
        loadBlocksFromDirectory(blockRegistry, dir);
    }
    blockRegistry.fireChanged();
}
