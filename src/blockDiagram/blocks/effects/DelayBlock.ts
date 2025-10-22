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
                id: 'maxDelayTime',
                name: 'Max Delay Time',
                type: 'number',
                default: 1.0,
                min: 0.01,
                max: 1.0,
                step: 0.01,
                description: 'Maximum delay time in seconds (controls memory allocation)'
            },
            {
                id: 'delayTime',
                name: 'Delay Time',
                type: 'number',
                default: 0.5,
                min: 0.001,
                max: 1.0,
                step: 0.001,
                description: 'Delay time in seconds (modulated by Time CV)'
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
        const maxDelayTime = this.getParameterValue(ctx, this.type, 'maxDelayTime', 1.0);
        const baseDelayTime = this.getParameterValue(ctx, this.type, 'delayTime', 0.5);
        const baseFeedback = this.getParameterValue(ctx, this.type, 'feedback', 0.5);
        const baseMix = this.getParameterValue(ctx, this.type, 'mix', 0.5);
        
        // Check if control inputs are connected
        const timeCtrlReg = ctx.getInputRegister(this.type, 'time_ctrl');
        const fbCtrlReg = ctx.getInputRegister(this.type, 'fb_ctrl');
        const mixCtrlReg = ctx.getInputRegister(this.type, 'mix_ctrl');
        
        // Allocate memory based on user-specified maximum delay time
        const maxDelaySamples = this.timeToSamples(maxDelayTime);
        const baseDelaySamples = this.timeToSamples(baseDelayTime);
        
        // Allocate resources
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const delayMem = ctx.allocateMemory(this.type, maxDelaySamples);
        
        // Generate code
        code.push(`; Delay Effect (${baseDelayTime}s base, max ${maxDelayTime}s)`);
        code.push(`; Memory: ${delayMem.name} @ ${delayMem.address} (${maxDelaySamples} samples)`);
        if (timeCtrlReg) code.push(`; Time modulated by ${timeCtrlReg}`);
        if (fbCtrlReg) code.push(`; Feedback modulated by ${fbCtrlReg}`);
        if (mixCtrlReg) code.push(`; Mix modulated by ${mixCtrlReg}`);
        code.push('');
        
        // Setup for variable delay using RMPA if CV-controlled
        if (timeCtrlReg) {
            // Calculate delay offset from CV value and load into ADDR_PTR
            code.push(`; Calculate delay offset from CV`);
            code.push(`ldax ${timeCtrlReg}  ; Load CV (0.0 to 1.0)`);
            // Scale CV to delay memory offset (0 to maxDelaySamples-1)
            // CV=0 gives short delay, CV=1 gives max delay
            code.push(`sof ${this.formatS15(maxDelaySamples / 32768.0)}, 0.0  ; Scale to sample count`);
            code.push(`wrax ADDR_PTR, 0.0  ; Load into address pointer`);
            code.push('');
        }
        
        // Read input signal into accumulator  
        code.push(`rdax ${inputReg}, 1.0`);
        
        // Read delayed signal
        if (timeCtrlReg) {
            // Use RMPA to read from variable position set by ADDR_PTR
            code.push(`; Variable delay read using RMPA`);
            code.push(`rmpa 1.0  ; Read from delay[ADDR_PTR], coefficient 1.0`);
        } else {
            // Fixed delay - read from calculated offset
            const offset = maxDelaySamples - baseDelaySamples;
            if (offset > 0) {
                code.push(`rda ${delayMem.name} + ${offset}, 1.0`);
            } else {
                code.push(`rda ${delayMem.name}#, 1.0`);
            }
        }
        
        // Apply mix (wet level)
        if (mixCtrlReg) {
            code.push(`mulx ${mixCtrlReg}  ; Apply wet mix from CV`);
        } else {
            code.push(`sof ${this.formatS15(baseMix)}, 0.0  ; Apply wet mix`);
        }
        
        // Save wet signal temporarily and write to delay line
        const wetReg = ctx.getScratchRegister();
        code.push(`wrax ${wetReg}, 1.0  ; Save wet, keep in ACC`);
        
        // Add input for feedback and write to delay line
        code.push(`rdax ${inputReg}, 1.0`);
        if (fbCtrlReg) {
            code.push(`mulx ${fbCtrlReg}  ; Apply feedback from CV`);
        } else {
            code.push(`sof ${this.formatS15(baseFeedback)}, 0.0  ; Apply feedback`);
        }
        code.push(`wra ${delayMem.name}, 0.0  ; Write to delay line`);
        
        // Mix dry and wet signals
        code.push(`rdax ${wetReg}, 1.0  ; Get wet signal`);
        if (mixCtrlReg) {
            // Dry is complex with CV - simplified approach
            code.push(`rdax ${inputReg}, 0.5  ; Add some dry signal`);
        } else {
            const dryGain = 1.0 - baseMix;
            code.push(`rdax ${inputReg}, ${this.formatS15(dryGain)}  ; Add dry signal`);
        }
        
        // Write output
        code.push(`wrax ${outputReg}, 0.0`);
        code.push('');
        
        return code;
    }
}
