/**
 * Coarse Delay Block
 * 
 * Simple delay line with variable delay time controlled by a control input or parameter.
 * The control signal (0.0 to 1.0) sweeps the entire delay line range.
 * 
 * Based on SpinCAD CoarseDelayCADBlock
 * 
 * Translation Notes:
 * - Uses ADDR_PTR and RMPA for variable delay reading
 * - Control input is scaled to sweep full delay range (0-1 → 0-delayLength)
 * - Delay length can be set up to 32767 samples (~1 second @ 32.768kHz)
 * - This is just a delay line - mixing and feedback should be done with other blocks
 * - Control signal smoothing is commented out in original (could add if needed)
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class CoarseDelayBlock extends BaseBlock {
    readonly type = 'effects.delay.coarse';
    readonly category = 'Delay';
    readonly name = 'Coarse Delay';
    readonly description = 'Simple variable delay line with control input (0-1 sweeps full range)';
    readonly color = '#6060c4';
    readonly width = 180;

    constructor() {
        super();

        this._inputs = [
            { id: 'audio_input', name: 'Audio Input', type: 'audio' },
            { id: 'delay_time', name: 'Delay Time', type: 'control' }
        ];

        this._outputs = [
            { id: 'audio_output', name: 'Audio Output', type: 'audio' }
        ];

        this._parameters = [
            {
                id: 'delayLength',
                name: 'Max Delay Length',
                type: 'number',
                default: 8192,
                min: 128,
                max: 32767,
                step: 1,
                displayMin: this.samplesToMs(128),
                displayMax: this.samplesToMs(32767),
                displayUnit: 'ms',
                displayDecimals: 1,
                toDisplay: (samples: number) => this.samplesToMs(samples),
                fromDisplay: (ms: number) => this.msToSamples(ms),
                description: 'Maximum delay length in samples (128-32767, displayed as milliseconds)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'audio_input');

        if (!inputReg) {
            ctx.pushMainCode(`; ${this.name} (no audio input connected)`);
            return;
        }

        const zero = this.formatS1_14(0.0);
        const outputReg = ctx.allocateRegister(this.type, 'audio_output');
        const delayTimeReg = ctx.getInputRegister(this.type, 'delay_time');

        // Get delay length parameter (user-selected maximum)
        const delayLength = Math.floor(this.getParameterValue(ctx, this.type, 'delayLength', 8192) as number);

        // Allocate delay memory based on user-selected delayLength (not parameter max)
        const memory = ctx.allocateMemory(this.type, delayLength);
        const delayOffset = memory.address;
        const memoryName = memory.name;

        ctx.pushMainCode(`; ${this.name} - length=${this.samplesToMs(delayLength).toFixed(1)}ms (${delayLength} samples)`);
        
        // Write input to delay line
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wra ${memoryName}, ${zero}`);

        // Set up delay read pointer
        ctx.pushMainCode(`; Set up variable delay read pointer`);
        
        if (delayTimeReg) {
            // Control input is connected - use it to modulate delay time (0-1 → 0-delayLength)
            // Load control signal and scale to delay range
            ctx.pushMainCode(`rdax ${delayTimeReg}, ${this.formatS1_14(1.0)}`);
            
            // Scale control (0-1) to actual delay range and add offset
            // scale = (delayLength - 1) / 32768, offset = delayOffset / 32768
            const scale = (delayLength - 1) / 32768.0;
            const offset = delayOffset / 32768.0;
            ctx.pushMainCode(`sof ${this.formatS1_14(scale)}, ${this.formatS10(offset)}`);
        } else {
            // No control - read from end of delay line (full delay)
            const address = (delayOffset + delayLength - 1) / 32768.0;
            ctx.pushMainCode(`clr`);
            ctx.pushMainCode(`sof ${zero}, ${this.formatS10(address)}`);
        }
        
        // Write to ADDR_PTR and read with RMPA
        ctx.pushMainCode(`wrax ADDR_PTR, ${zero}`);
        ctx.pushMainCode(`rmpa ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
