/**
 * Tap Tempo control block
 * Ported from SpinCAD TapTempoCADBlock
 * 
 * Provides tap tempo functionality with debouncing and latching switch mechanism.
 * Takes a momentary switch input (via POT) and generates synchronized outputs:
 * - Latch: Toggles on each tap
 * - Ramp: Running ramp from 0 to 1 synchronized to taps
 * - Tap Tempo: Sampled/held tempo value
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class TapTempoBlock extends BaseBlock {
    readonly type = 'control.taptempo';
    readonly category = 'Control';
    readonly name = 'Tap Tempo';
    readonly description = 'Tap tempo with debouncing and latching outputs';
    readonly color = '#FF9800';  // Orange for control blocks
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'tap_in', name: 'Tap Switch', type: 'control', required: true }
        ];
        
        this._outputs = [
            { id: 'latch', name: 'Latch', type: 'control' },
            { id: 'ramp', name: 'Ramp', type: 'control' },
            { id: 'taptempo', name: 'Tap Tempo', type: 'control' }
        ];
        
        this._parameters = [
            {
                id: 'maxTime',
                name: 'Max Time',
                type: 'number',
                default: 1.0,
                min: 0.1,
                max: 5.0,
                step: 0.1,
                description: 'Maximum tempo time in seconds'
            },
            {
                id: 'defaultTime',
                name: 'Default Time',
                type: 'number',
                default: 0.33,
                min: 0.01,
                max: 5.0,
                step: 0.01,
                description: 'Default tempo time in seconds'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): void {
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        const half = ctx.getStandardConstant(0.5);
        const negOne = ctx.getStandardConstant(-1.0);

        // Initialize tap tempo
        const maxTime = this.getParameterValue(ctx, this.type, 'maxTime', 1.0);
        const defaultTime = this.getParameterValue(ctx, this.type, 'defaultTime', 0.33);
        
        // Get register allocations
        const latchReg = ctx.allocateRegister(this.type, 'latch');
        const rampReg = ctx.allocateRegister(this.type, 'ramp');
        
        ctx.pushInitCode(`; Tap Tempo Initialization`);
        ctx.pushInitCode(`or ${this.formatS1_14(4096 / 32768.0)}  ; Load RMP0 frequency`);
        ctx.pushInitCode(`wrax RMP0_RATE, ${this.formatS1_14(0.99)}  ; Set rate, load 0.99`);
        ctx.pushInitCode(`wrax ${latchReg}, ${this.formatS1_14(defaultTime / maxTime)}`);
        ctx.pushInitCode(`wrax ${rampReg}, 0`);
        
        // Generate main code
        const tapInputReg = ctx.getInputRegister(this.type, 'tap_in');
        
        if (!tapInputReg) {
            ctx.pushMainCode(`; Tap Tempo (no input connected)`);
            return;
        }
        
        // Allocate registers
        const dbReg = ctx.getScratchRegister();       // Debounce register
        const momReg = ctx.getScratchRegister();      // Momentary register
        const taptempoReg = ctx.allocateRegister(this.type, 'taptempo');
        
        const rampRate = 1.0 / maxTime / 16.0;
        const count = 0.01;
        
        ctx.pushMainCode(`; Tap Tempo Control`);
        ctx.pushMainCode(`;   Switch input: ${tapInputReg}`);
        ctx.pushMainCode('');
        
        // Switch debouncing and pot filtering workaround
        ctx.pushMainCode(`; Switch Debouncing`);
        ctx.pushMainCode(`ldax ${tapInputReg}  ; Load tap switch input`);
        ctx.pushMainCode(`sof 1.0, -0.5`);
        ctx.pushMainCode(`skp neg, 4`);
        ctx.pushMainCode(`ldax ${dbReg}`);
        ctx.pushMainCode(`sof 1.0, ${this.formatS10(count)}`);
        ctx.pushMainCode(`wrax ${dbReg}, 0`);
        ctx.pushMainCode(`skp zro, 3`);
        ctx.pushMainCode(`; DOWN:`);
        ctx.pushMainCode(`ldax ${dbReg}`);
        ctx.pushMainCode(`sof 1.0, ${this.formatS10(-count)}`);
        ctx.pushMainCode(`wrax ${dbReg}, 0`);
        ctx.pushMainCode('');
        
        // Latching switch - falling edge triggered flip-flop
        // Schmitt trigger action: <-0.9 is low, >0.9 is high, in-between ignored
        ctx.pushMainCode(`; Latching Switch (Schmitt Trigger)`);
        ctx.pushMainCode(`ldax ${dbReg}`);
        ctx.pushMainCode(`absa`);
        ctx.pushMainCode(`sof 1.0, -0.9`);
        ctx.pushMainCode(`skp neg, 13`);
        ctx.pushMainCode(`ldax ${dbReg}`);
        ctx.pushMainCode(`sof 1.0, -0.9`);
        ctx.pushMainCode(`skp neg, 3`);
        ctx.pushMainCode(`sof zero, 0.999`);
        ctx.pushMainCode(`wrax ${momReg}, 0`);
        ctx.pushMainCode(`skp zro, 7`);
        ctx.pushMainCode(`; LO:`);
        ctx.pushMainCode(`ldax ${momReg}`);
        ctx.pushMainCode(`skp neg, 5`);
        ctx.pushMainCode(`sof zero, -0.999`);
        ctx.pushMainCode(`wrax ${momReg}, 0`);
        ctx.pushMainCode(`ldax ${latchReg}`);
        ctx.pushMainCode(`sof negOne, 0`);
        ctx.pushMainCode(`wrax ${latchReg}, 0`);
        ctx.pushMainCode('');
        
        // Tap tempo - uses RMP0 as a 1 Hz rising ramp
        // Runs while latch is low, sampled and held when latch is high
        ctx.pushMainCode(`; Tap Tempo Processing`);
        ctx.pushMainCode(`ldax ${latchReg}`);
        ctx.pushMainCode(`skp neg, 4`);
        ctx.pushMainCode(`jam RMP0  ; Reset ramp`);
        ctx.pushMainCode(`ldax ${rampReg}`);
        ctx.pushMainCode(`wrax ${taptempoReg}, 0  ; Sample tempo`);
        ctx.pushMainCode(`skp zro, 12`);
        ctx.pushMainCode(`; LOW:`);
        ctx.pushMainCode(`sof zero, ${this.formatS10(rampRate)}`);
        ctx.pushMainCode(`wrax RMP0_RATE, 0  ; Set ramp rate`);
        ctx.pushMainCode(`cho rdal, RMP0  ; Read ramp value`);
        ctx.pushMainCode(`sof -2.0, 0.999`);
        ctx.pushMainCode(`sof 1.0, zero01`);
        ctx.pushMainCode(`wrax ${rampReg}, 1.0`);
        ctx.pushMainCode(`sof 1.0, -0.999`);
        ctx.pushMainCode(`skp neg, 4`);
        ctx.pushMainCode(`ldax ${taptempoReg}`);
        ctx.pushMainCode(`wrax ${rampReg}, 0`);
        ctx.pushMainCode(`sof zero, 0.999`);
        ctx.pushMainCode(`wrax ${latchReg}, 0`);
        ctx.pushMainCode('');    }
}
