/**
 * Minimum Reverb Block
 * Ported from SpinCAD's MinReverb block
 * 
 * Classic minimum reverb algorithm using 4 input allpass filters
 * followed by 2 parallel delay loops with allpass filters.
 * Based on "minimum reverb" from Spin Semiconductor website.
 * 
 * Structure:
 * - 4 series input allpass filters (122, 303, 553, 922 samples)
 * - 2 parallel delay loops:
 *   - Loop 1: AP (3823) → Delay (6512)
 *   - Loop 2: AP (4732) → Delay (5016)
 * 
 * Translation Notes:
 * - krt (reverb time) controls decay feedback in both loops
 * - kap (allpass coefficient) = 0.325 for all allpass filters
 * - Input is scaled by 0.25 to prevent clipping
 * - Loops use 1.99 gain to maintain energy
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class MinReverbBlock extends BaseBlock {
    readonly type = 'effects.reverb.min';
    readonly category = 'Reverb';
    readonly name = 'Simple Reverb';
    readonly description = 'Minimal reverb with 4 input allpass and 2 delay loops';
    readonly color = '#7100FC';
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'input', name: 'Audio Input', type: 'audio', required: true },
            { id: 'reverb_time', name: 'Reverb Time', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'output', name: 'Audio Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'reverbTime',
                name: 'Reverb Time',
                type: 'number',
                default: 0.13,
                min: 0.0,
                max: 0.99,
                step: 0.01,
                displayDecimals: 2,
                description: 'Reverb decay time coefficient (0-0.99)'
            }
        ];
        
        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'input');
        const reverbTimeReg = ctx.getInputRegister(this.type, 'reverb_time');
        
        if (!inputReg) {
            ctx.pushMainCode(`; Min Reverb (no input connected)`);
            return;
        }
        
        // Get parameters
        const krt = this.getParameterValue(ctx, this.type, 'reverbTime', 0.13);
        const kap = 0.325;  // Allpass coefficient (fixed)
        
        // Allocate delay memory for all stages - each needs a unique identifier
        const api1 = ctx.allocateMemory(`api1`, 122);
        const api2 = ctx.allocateMemory(`api2`, 303);
        const api3 = ctx.allocateMemory(`api3`, 553);
        const api4 = ctx.allocateMemory(`api4`, 922);
        const ap1 = ctx.allocateMemory(`ap1`, 3823);
        const del1 = ctx.allocateMemory(`del1`, 6512);
        const ap2 = ctx.allocateMemory(`ap2`, 4732);
        const del2 = ctx.allocateMemory(`del2`, 5016);
        
        // Allocate registers
        const apoutReg = ctx.allocateRegister(this.type, 'apout');
        const outputReg = ctx.allocateRegister(this.type, 'output');
        
        const zero = ctx.getStandardConstant(0.0);
        const negOne = ctx.getStandardConstant(-1.0);
        
        ctx.pushMainCode(`; Minimal reverb`);
        
        // Input with scaling to prevent clipping
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(0.25)}`);
        
        // 4 series input allpass filters
        // Each reads from END of delay (^), then writes back to START with inverted coefficient
        
        // Allpass 1 (122 samples)
        ctx.pushMainCode(`rda ${api1.name}^, ${this.formatS1_14(kap)}`);
        ctx.pushMainCode(`wrap ${api1.name}, ${negOne}`);
        
        // Allpass 2 (303 samples)
        ctx.pushMainCode(`rda ${api2.name}^, ${this.formatS1_14(kap)}`);
        ctx.pushMainCode(`wrap ${api2.name}, ${negOne}`);
        
        // Allpass 3 (553 samples)
        ctx.pushMainCode(`rda ${api3.name}^, ${this.formatS1_14(kap)}`);
        ctx.pushMainCode(`wrap ${api3.name}, ${negOne}`);
        
        // Allpass 4 (922 samples)
        ctx.pushMainCode(`rda ${api4.name}^, ${this.formatS1_14(kap)}`);
        ctx.pushMainCode(`wrap ${api4.name}, ${negOne}`);
        
        // Save allpass output for second loop
        ctx.pushMainCode(`wrax ${apoutReg}, ${this.formatS1_14(1.0)}`);
        
        // First loop delay
        // Read from second delay with reverb time
        if (reverbTimeReg) {
            ctx.pushMainCode(`rda ${del2.name}^, ${this.formatS1_14(1.0)}`);
            ctx.pushMainCode(`mulx ${reverbTimeReg}`);
        } else {
            ctx.pushMainCode(`rda ${del2.name}^, ${this.formatS1_14(krt)}`);
        }
        
        // Loop allpass 1
        ctx.pushMainCode(`rda ${ap1.name}^, ${this.formatS1_14(-kap)}`);
        ctx.pushMainCode(`wrap ${ap1.name}, ${this.formatS1_14(kap)}`);
        
        // Write to delay 1
        ctx.pushMainCode(`wra ${del1.name}, ${this.formatS1_14(1.99)}`);
        
        // Second loop delay
        // Start with saved allpass output
        ctx.pushMainCode(`rdax ${apoutReg}, ${this.formatS1_14(1.0)}`);
        
        // Read from first delay with reverb time
        if (reverbTimeReg) {
            ctx.pushMainCode(`rda ${del1.name}^, ${this.formatS1_14(1.0)}`);
            ctx.pushMainCode(`mulx ${reverbTimeReg}`);
        } else {
            ctx.pushMainCode(`rda ${del1.name}^, ${this.formatS1_14(krt)}`);
        }
        
        // Loop allpass 2
        ctx.pushMainCode(`rda ${ap2.name}^, ${this.formatS1_14(-kap)}`);
        ctx.pushMainCode(`wrap ${ap2.name}, ${this.formatS1_14(kap)}`);
        
        // Write to delay 2 and output
        ctx.pushMainCode(`wra ${del2.name}, ${this.formatS1_14(1.99)}`);
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        
        ctx.pushMainCode('');
    }
}
