/**
 * Central registry for all available block types
 * Blocks must be registered here to be available in the editor
 */

import { IBlockDefinition, BlockMetadata } from '../types/Block.js';
import { ADCLBlock, ADCRBlock, PotBlock } from './input/InputBlocks.js';
import { DACLBlock, DACRBlock } from './output/OutputBlocks.js';
import { VolumeBlock } from './math/MathBlocks.js';
import { Mixer2Block, Mixer3Block, Mixer4Block } from './math/MixerBlocks.js';
import { GainBoostBlock } from './math/GainBoostBlock.js';
import { DelayBlock } from './effects/DelayBlock.js';

export class BlockRegistry {
    private blocks: Map<string, IBlockDefinition> = new Map();
    private categories: Map<string, string[]> = new Map();
    
    constructor() {
        this.registerDefaultBlocks();
    }
    
    /**
     * Register all default blocks
     */
    private registerDefaultBlocks(): void {
        // Input blocks
        this.register(new ADCLBlock());
        this.register(new ADCRBlock());
        this.register(new PotBlock());
        
        // Output blocks
        this.register(new DACLBlock());
        this.register(new DACRBlock());
        
        // Math blocks
        this.register(new VolumeBlock());
        this.register(new GainBoostBlock());
        this.register(new Mixer2Block());
        this.register(new Mixer3Block());
        this.register(new Mixer4Block());
        
        // Effect blocks
        this.register(new DelayBlock());
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
