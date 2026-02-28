/**
 * Central registry for all available block types
 * Blocks must be registered here to be available in the editor
 */

import { IBlockDefinition, BlockMetadata } from '../types/Block.js';
import { TemplateBlock } from './TemplateBlock.js';
import { BlockTemplateDefinition } from '../types/IR.js';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class BlockRegistry {
    private blocks: Map<string, IBlockDefinition> = new Map();
    private categories: Map<string, string[]> = new Map();
    private isInitialized = false;

    private _onDidChangeBlocks = new vscode.EventEmitter<void>();
    public readonly onDidChangeBlocks = this._onDidChangeBlocks.event;

    constructor() {
        // Initialization is now deferred to the init() method called from extension activate
    }

    /**
     * Initialize the registry with the extension path and optional custom paths
     */
    init(extensionPath?: string, customPaths: string[] = []): void {
        if (this.isInitialized) return;

        this.registerDefinitions(extensionPath, customPaths);
        this.isInitialized = true;
    }

    /**
     * Refresh the registry (e.g., when settings change or manually triggered)
     */
    refresh(extensionPath?: string, customPaths: string[] = []): void {
        this.blocks.clear();
        this.categories.clear();
        this.registerDefinitions(extensionPath, customPaths);
        this._onDidChangeBlocks.fire();
    }

    /**
     * Register dynamic block definitions from JSON or ATL files
     */
    private registerDefinitions(extensionPath?: string, customPaths: string[] = []): void {
        const possiblePaths = [];

        if (extensionPath) {
            possiblePaths.push(path.join(extensionPath, 'resources/blocks'));
        }

        // Fallback or development paths relative to __dirname
        possiblePaths.push(path.resolve(__dirname, '../../../resources/blocks')); // out/src/blockDiagram/blocks layout
        possiblePaths.push(path.resolve(__dirname, '../resources/blocks'));       // dist layout (dist/extension.cjs -> root)
        possiblePaths.push(path.resolve(__dirname, '../../resources/blocks'));    // deep dist layout

        let defaultDefinitionsPath = '';
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                defaultDefinitionsPath = p;
                break;
            }
        }

        const pathsToLoad = [];
        if (defaultDefinitionsPath) {
            pathsToLoad.push(defaultDefinitionsPath);
        } else {
            console.error('Failed to find core block definitions directory in any of:', possiblePaths);
        }

        // Add user configured custom paths
        for (const customPath of customPaths) {
            if (fs.existsSync(customPath)) {
                pathsToLoad.push(customPath);
            } else {
                console.warn(`Configured custom block path does not exist: ${customPath}`);
            }
        }

        for (const dir of pathsToLoad) {
            console.log(`Loading block definitions from: ${dir}`);
            this.loadDefinitionsRecursively(dir);
        }
    }

    /**
     * Recursively load block definitions from a directory
     */
    private loadDefinitionsRecursively(dir: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                this.loadDefinitionsRecursively(fullPath);
            } else if (entry.isFile()) {
                if (entry.name.endsWith('.json')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        const definition = JSON.parse(content) as BlockTemplateDefinition;
                        this.register(new TemplateBlock(definition));
                    } catch (e) {
                        console.error(`Failed to load block definition ${fullPath}: ${e}`);
                    }
                } else if (entry.name.endsWith('.atl')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        const definition = this.parseATL(content);
                        console.log(`Registering ATL block: ${definition.name} (${definition.type}) from ${entry.name}`);
                        this.register(new TemplateBlock(definition));
                    } catch (e) {
                        console.error(`Failed to load ATL block ${fullPath}: ${e}`);
                    }
                }
            }
        }
    }

    /**
     * Parse ATL file with Frontmatter
     * Format: 
     * ---
     * { json metadata }
     * ---
     * assembly code
     */
    private parseATL(content: string): BlockTemplateDefinition {
        const parts = content.split('---');
        if (parts.length < 3) {
            throw new Error('Invalid ATL format: missing frontmatter delimiters (---)');
        }

        const metadata = JSON.parse(parts[1].trim());
        const template = parts.slice(2).join('---').trim();

        return {
            ...metadata,
            template
        };
    }

    /**
     * Register a block type
     */
    register(block: IBlockDefinition): void {
        this.blocks.set(block.type, block);

        // Add to category index
        if (!this.categories.has(block.category)) {
            this.categories.set(block.category, []);
        }
        this.categories.get(block.category)!.push(block.type);
    }

    /**
     * Get a block definition by type
     */
    getBlock(type: string): IBlockDefinition | undefined {
        return this.blocks.get(type);
    }

    /**
     * Get all block types
     */
    getAllTypes(): string[] {
        return Array.from(this.blocks.keys());
    }

    /**
     * Get all blocks in a category
     */
    getBlocksByCategory(category: string): IBlockDefinition[] {
        const types = this.categories.get(category) || [];
        return types.map(type => this.blocks.get(type)!).filter(b => b !== undefined);
    }

    /**
     * Get all categories
     */
    getCategories(): string[] {
        return Array.from(this.categories.keys());
    }

    /**
     * Get metadata for all blocks (useful for UI)
     */
    getAllMetadata(): BlockMetadata[] {
        return Array.from(this.blocks.values()).map(block => block.getMetadata());
    }

    /**
     * Get metadata by category (useful for toolbox)
     */
    getMetadataByCategory(): Map<string, BlockMetadata[]> {
        const result = new Map<string, BlockMetadata[]>();

        for (const [category, types] of this.categories.entries()) {
            const metadata = types
                .map(type => this.blocks.get(type)?.getMetadata())
                .filter(m => m !== undefined) as BlockMetadata[];
            result.set(category, metadata);
        }

        return result;
    }
}

// Export singleton instance
export const blockRegistry = new BlockRegistry();
