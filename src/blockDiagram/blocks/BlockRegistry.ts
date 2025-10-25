/**
 * Central registry for all available block types
 * Blocks must be registered here to be available in the editor
 */

import { IBlockDefinition, BlockMetadata } from '../types/Block.js';
import { ADCLBlock } from './input/ADCLBlock.js';
import { ADCRBlock } from './input/ADCRBlock.js';
import { PotBlock } from './input/PotBlock.js';
import { DACLBlock } from './output/DACLBlock.js';
import { DACRBlock } from './output/DACRBlock.js';
import { VolumeBlock } from './math/VolumeBlock.js';
import { Mixer2Block } from './math/Mixer2Block.js';
import { Mixer3Block } from './math/Mixer3Block.js';
import { Mixer4Block } from './math/Mixer4Block.js';
import { GainBoostBlock } from './math/GainBoostBlock.js';
import { DelayBlock } from './effects/delay/DelayBlock.js';
import { PingPongDelayBlock } from './effects/delay/PingPongDelayBlock.js';
import { TapTempoBlock } from './effects/control/TapTempoBlock.js';
import { PhaserBlock } from './effects/modulation/PhaserBlock.js';
import { RingModulatorBlock } from './effects/modulation/RingModulatorBlock.js';

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
        
        // Effect blocks - Delay
        this.register(new DelayBlock());
        this.register(new PingPongDelayBlock());
        
        // Effect blocks - Modulation
        this.register(new PhaserBlock());
        this.register(new RingModulatorBlock());
        
        // Effect blocks - Control
        this.register(new TapTempoBlock());
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
