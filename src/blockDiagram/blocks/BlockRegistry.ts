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
import { ConstantBlock } from './control/ConstantBlock.js';
import { CrossfadeBlock } from './math/CrossfadeBlock.js';
import { Crossfade2Block } from './math/Crossfade2Block.js';
import { Crossfade3Block } from './math/Crossfade3Block.js';
import { CoarseDelayBlock } from './effects/delay/CoarseDelayBlock.js';
import { MinReverbBlock } from './effects/reverb/MinReverbBlock.js';
import { RoomReverbBlock } from './effects/reverb/RoomReverbBlock.js';
import { SpringReverbBlock } from './effects/reverb/SpringReverbBlock.js';
import { PlateReverbBlock } from './effects/reverb/PlateReverbBlock.js';
import { ToneGenFixedBlock } from './other/ToneGenFixed.js';
import { ToneGenAdjustableBlock } from './other/ToneGenAdjustable.js';
import { StickyNoteBlock } from './other/StickyNoteBlock.js';
import { TemplateBlock } from './TemplateBlock.js';
import { BlockTemplateDefinition } from '../types/IR.js';
import * as fs from 'fs';
import * as path from 'path';

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
        this.register(new ToneGenFixedBlock());
        this.register(new ToneGenAdjustableBlock());
        this.register(new VolumeBlock());
        this.register(new GainBoostBlock());
        this.register(new Mixer2Block());
        this.register(new Mixer3Block());
        this.register(new Mixer4Block());
        this.register(new CrossfadeBlock());
        this.register(new Crossfade2Block());
        this.register(new Crossfade3Block());

        // Effect blocks - Delay
        this.register(new TripleTapDelayBlock());
        this.register(new CoarseDelayBlock());

        // Effect blocks - Modulation
        this.register(new ChorusBlock());
        this.register(new Chorus4VoiceBlock());
        this.register(new FlangerBlock());

        // Effect blocks - Filter
        this.register(new LowPassFilterBlock());
        this.register(new HighPassFilterBlock());
        this.register(new ShelvingHighPassBlock());
        this.register(new ShelvingLowPassBlock());
        this.register(new StateVariableFilter2PBlock());
        this.register(new StateVariableFilter2PAdjustableBlock());

        // Effect blocks - Reverb
        this.register(new MinReverbBlock());
        this.register(new RoomReverbBlock());
        this.register(new SpringReverbBlock());
        this.register(new PlateReverbBlock());

        // Control blocks
        this.register(new ConstantBlock());
        this.register(new ScaleOffsetBlock());
        this.register(new InvertBlock());
        this.register(new PowerBlock());
        this.register(new SinCosLFOBlock());
        this.register(new ControlSmootherBlock());
        this.register(new TremolizerBlock());

        // Dynamic block definitions
        this.registerDefinitions();
    }

    /**
     * Register dynamic block definitions from JSON or ATL files
     */
    private registerDefinitions(): void {
        const definitionsPath = path.resolve(__dirname, '../../../resources/blocks');

        if (fs.existsSync(definitionsPath)) {
            const files = fs.readdirSync(definitionsPath);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const content = fs.readFileSync(path.join(definitionsPath, file), 'utf8');
                        const definition = JSON.parse(content) as BlockTemplateDefinition;
                        this.register(new TemplateBlock(definition));
                    } catch (e) {
                        console.error(`Failed to load block definition ${file}: ${e}`);
                    }
                } else if (file.endsWith('.atl')) {
                    try {
                        const content = fs.readFileSync(path.join(definitionsPath, file), 'utf8');
                        const definition = this.parseATL(content);
                        this.register(new TemplateBlock(definition));
                    } catch (e) {
                        console.error(`Failed to load ATL block ${file}: ${e}`);
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
