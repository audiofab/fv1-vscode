/**
 * Central registry for all available block types
 * Blocks must be registered here to be available in the editor
 */

import { IBlockDefinition, BlockMetadata } from '../types/Block.js';
import { ADCBlock } from './io/ADCBlock.js';
import { PotBlock } from './io/PotBlock.js';
import { DACBlock } from './io/DACBlock.js';
import { VolumeBlock } from './math/VolumeBlock.js';
import { Mixer2Block } from './math/Mixer2Block.js';
import { Mixer3Block } from './math/Mixer3Block.js';
import { Mixer4Block } from './math/Mixer4Block.js';
import { GainBoostBlock } from './math/GainBoostBlock.js';
import { TripleTapDelayBlock } from './effects/delay/TripleTapDelayBlock.js';
import { ChorusBlock } from './effects/modulation/ChorusBlock.js';
import { FlangerBlock } from './effects/modulation/FlangerBlock.js';
import { Chorus4VoiceBlock } from './effects/modulation/Chorus4VoiceBlock.js';
import { LowPassFilterBlock } from './effects/filter/LowPassFilterBlock.js';
import { HighPassFilterBlock } from './effects/filter/HighPassFilterBlock.js';
import { ShelvingHighPassBlock } from './effects/filter/ShelvingHighPassBlock.js';
import { ShelvingLowPassBlock } from './effects/filter/ShelvingLowPassBlock.js';
import { StateVariableFilter2PBlock } from './effects/filter/StateVariableFilter2PBlock.js';
import { StateVariableFilter2PAdjustableBlock } from './effects/filter/StateVariableFilter2PAdjustableBlock.js';
import { ScaleOffsetBlock } from './control/ScaleOffsetBlock.js';
import { InvertBlock } from './control/InvertBlock.js';
import { PowerBlock } from './control/PowerBlock.js';
import { SinCosLFOBlock } from './control/SinCosLFOBlock.js';
import { ControlSmootherBlock } from './control/ControlSmootherBlock.js';
import { TremolizerBlock } from './control/TremolizerBlock.js';
import { CrossfadeBlock } from './math/CrossfadeBlock.js';
import { Crossfade2Block } from './math/Crossfade2Block.js';
import { Crossfade3Block } from './math/Crossfade3Block.js';
import { CoarseDelayBlock } from './effects/delay/CoarseDelayBlock.js';
import { StickyNoteBlock } from './other/StickyNoteBlock.js';

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
        this.register(new ADCBlock());
        this.register(new PotBlock());
        
        // Output blocks
        this.register(new DACBlock());
        
        // Utility blocks
        this.register(new StickyNoteBlock());
        
        // Math blocks
        this.register(new VolumeBlock());
        this.register(new GainBoostBlock());
        this.register(new Mixer2Block());
        this.register(new Mixer3Block());
        this.register(new Mixer4Block());
        this.register(new CrossfadeBlock());
        this.register(new Crossfade2Block());
        this.register(new Crossfade3Block());
        
        // Effect blocks - Delay
        // this.register(new DelayBlock());
        // this.register(new PingPongDelayBlock());
        this.register(new TripleTapDelayBlock());
        this.register(new CoarseDelayBlock());
        
        // Effect blocks - Modulation
        // this.register(new PhaserBlock());
        // this.register(new RingModulatorBlock());
        this.register(new ChorusBlock());
        this.register(new FlangerBlock());
        this.register(new Chorus4VoiceBlock());
        
        // Effect blocks - Filter
        this.register(new LowPassFilterBlock());
        this.register(new HighPassFilterBlock());
        this.register(new ShelvingHighPassBlock());
        this.register(new ShelvingLowPassBlock());
        this.register(new StateVariableFilter2PBlock());
        this.register(new StateVariableFilter2PAdjustableBlock());
        
        // Control blocks
        this.register(new ScaleOffsetBlock());
        this.register(new InvertBlock());
        this.register(new PowerBlock());
        this.register(new SinCosLFOBlock());
        this.register(new ControlSmootherBlock());
        this.register(new TremolizerBlock());
        
        // Effect blocks - Control
        // this.register(new TapTempoBlock());
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
