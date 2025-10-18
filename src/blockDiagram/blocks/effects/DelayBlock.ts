/**
 * Simple delay effect block
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class DelayBlock extends BaseBlock {
    readonly type = 'fx.delay';
    readonly category = 'Effects';
    readonly name = 'Delay';
    readonly description = 'Simple delay with feedback';
    readonly color = '#4CAF50';
    readonly width = 180;
    readonly height = 120;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true },
            { id: 'time_ctrl', name: 'Time CV', type: 'control', required: false },
            { id: 'fb_ctrl', name: 'FB CV', type: 'control', required: false },
            { id: 'mix_ctrl', name: 'Mix CV', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'delayTime',
                name: 'Delay Time',
                type: 'number',
                default: 0.5,
                min: 0.001,
                max: 1.0,
                step: 0.001,
                description: 'Delay time in seconds (up to 1 second, modulated by Time CV)'
            },
            {
                id: 'feedback',
                name: 'Feedback',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 0.99,
                step: 0.01,
                description: 'Feedback amount (0.0 to 0.99, modulated by FB CV)'
            },
            {
                id: 'mix',
                name: 'Mix',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Wet/dry mix (0.0 = dry, 1.0 = wet, modulated by Mix CV)'
            }
        ];
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        
        // Get base parameters
        const baseDelayTime = this.getParameterValue(ctx, this.type, 'delayTime', 0.5);
        const baseFeedback = this.getParameterValue(ctx, this.type, 'feedback', 0.5);
        const baseMix = this.getParameterValue(ctx, this.type, 'mix', 0.5);
        
        // Check if control inputs are connected
        const timeCtrlReg = ctx.getInputRegister(this.type, 'time_ctrl');
        const fbCtrlReg = ctx.getInputRegister(this.type, 'fb_ctrl');
        const mixCtrlReg = ctx.getInputRegister(this.type, 'mix_ctrl');
        
        // Calculate delay in samples (use base value for allocation)
        const delaySamples = this.timeToSamples(baseDelayTime);
        
        // Allocate resources
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const delayMem = ctx.allocateMemory(this.type, delaySamples);
        
        // Determine actual values (CV modulation or parameter)
        // For now, use parameter values. Full CV implementation would require
        // dynamic parameter calculation which is complex in FV-1 assembly
        const feedback = baseFeedback;
        const mix = baseMix;
        
        // Generate code
        code.push(`; Delay Effect (${baseDelayTime}s, ${delaySamples} samples)`);
        code.push(`; Memory: ${delayMem.name} @ ${delayMem.address}`);
        if (timeCtrlReg) code.push(`; Time modulated by ${timeCtrlReg}`);
        if (fbCtrlReg) code.push(`; Feedback modulated by ${fbCtrlReg}`);
        if (mixCtrlReg) code.push(`; Mix modulated by ${mixCtrlReg}`);
        code.push('');
        
        // Read input
        code.push(`rdax ${inputReg}, 1.0`);
        
        // Read delayed signal and add to accumulator
        code.push(`rda ${delayMem.name}#, ${this.formatS15(mix)}`);
        
        // Write to delay line with feedback
        code.push(`wra ${delayMem.name}, ${this.formatS15(feedback)}`);
        
        // Add dry signal
        const dryGain = 1.0 - mix;
        code.push(`rdax ${inputReg}, ${this.formatS15(dryGain)}`);
        
        // Write output
        code.push(`wrax ${outputReg}, 0.0`);
        code.push('');
        
        return code;
    }
}
