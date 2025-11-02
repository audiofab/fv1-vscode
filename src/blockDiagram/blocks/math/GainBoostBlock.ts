/**
 * Gain Boost Block - ported from SpinCAD GainBoostCADBlock
 * Provides gain in 6dB increments using cascaded SOF instructions
 * 
 * Algorithm: Each 6dB gain = SOF -2.0, 0
 * If odd number of stages, add final SOF -1.0, 0 to correct phase
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class GainBoostBlock extends BaseBlock {
    readonly type = 'math.gainboost';
    readonly category = 'Utility';
    readonly name = 'Gain Boost';
    readonly description = 'Gain in 6dB increments (uses cascaded SOF)';
    readonly color = '#2468f2';  // SpinCAD blue color
    readonly width = 150;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Audio Input', type: 'audio', required: true }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Audio Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'gain',
                name: 'Gain (6dB steps)',
                type: 'number',
                default: 1,
                min: 1,
                max: 8,
                step: 1,
                description: 'Number of 6dB gain stages (1 = 6dB, 2 = 12dB, etc.)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): void {
                const inputReg = ctx.getInputRegister(this.type, 'in');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gain = this.getParameterValue<number>(ctx, this.type, 'gain', 1);
                        // Check if input is already in accumulator (optimization)
                // Check if we should preserve accumulator for next block
                        // Calculate total gain in dB
        const gainDB = gain * 6;
        
        ctx.pushMainCode(`; Gain Boost: ${gainDB} dB`);
        
        // Load input
        ctx.pushMainCode(`rdax ${inputReg}, 1.0`);
        
        // Apply cascaded SOF -2.0, 0 for each 6dB stage
        // Each SOF -2.0, 0 doubles the signal (6dB gain) but inverts phase
        for (let i = 0; i < gain; i++) {
            ctx.pushMainCode(`sof -2.0, 0  ; +6dB gain stage ${i + 1}`);
        }
        
        // If odd number of stages, correct phase inversion
        if ((gain & 1) === 1) {
            ctx.pushMainCode(`sof -1.0, 0  ; Phase correction`);
        }
        
        ctx.pushMainCode(`wrax ${outputReg}, 0.0`);
        ctx.pushMainCode('');    }
}
