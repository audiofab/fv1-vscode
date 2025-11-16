/**
 * Plate Reverb Block
 * Based on Jon Dattorro's "Effect Design" paper
 * https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf
 * 
 * High-quality plate reverb with minimal resource requirements.
 * Features:
 * - Input diffusion network (4 allpass filters)
 * - Pre-delay
 * - Dual tank architecture with cross-coupling
 * - Modulated allpass filters in tank (LFO-driven)
 * - Adjustable damping (high-frequency loss)
 * - Adjustable decay time
 * - Stereo output with multiple taps
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class PlateReverbBlock extends BaseBlock {
    readonly type = 'effects.platereverb';
    readonly category = 'Reverb';
    readonly name = 'Plate Reverb';
    readonly description = 'High-quality plate reverb';
    readonly color = '#7100FC';
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio' },
            { id: 'dampingCV', name: 'Damping', type: 'control' },
            { id: 'decayTimeCV', name: 'Decay Time', type: 'control' },
            { id: 'mixCV', name: 'Mix', type: 'control' }
        ];
        
        this._outputs = [
            { id: 'outL', name: 'Left', type: 'audio' },
            { id: 'outR', name: 'Right', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'damping',
                name: 'Damping',
                type: 'number',
                default: 0.5,
                min: 0,
                max: 1,
                step: 0.01,
                description: 'High-frequency loss in tank (0=bright, 1=dark, overridden by CV input)'
            },
            {
                id: 'decayTime',
                name: 'Decay Time',
                type: 'number',
                default: 0.5,
                min: 0,
                max: 1,
                step: 0.01,
                description: 'Reverb decay time (0=short, 1=infinite, overridden by CV input)'
            },
            {
                id: 'mix',
                name: 'Mix',
                type: 'number',
                default: 0.5,
                min: 0,
                max: 1,
                step: 0.01,
                description: 'Dry/wet mix (0=dry, 1=wet, overridden by CV input)'
            },
            {
                id: 'preDelay',
                name: 'Pre-Delay',
                type: 'number',
                default: 655,
                min: 0,
                max: 3802,
                step: 1,
                displayMin: 0,
                displayMax: 116,
                displayStep: 0.1,
                displayDecimals: 1,
                displayUnit: 'ms',
                description: 'Pre-delay time before reverb (0-116ms)',
                toDisplay: (samples) => (samples / 32768) * 1000,
                fromDisplay: (ms) => Math.round((ms / 1000) * 32768)
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const dampingCVReg = ctx.getInputRegister(this.type, 'dampingCV');
        const decayTimeCVReg = ctx.getInputRegister(this.type, 'decayTimeCV');
        const mixCVReg = ctx.getInputRegister(this.type, 'mixCV');
        const outLReg = ctx.allocateRegister(this.type, 'outL');
        const outRReg = ctx.allocateRegister(this.type, 'outR');
        
        // Get parameters (used as defaults when CV inputs not connected)
        const damping = this.getParameterValue<number>(ctx, this.type, 'damping', 0.5);
        const decayTime = this.getParameterValue<number>(ctx, this.type, 'decayTime', 0.5);
        const mix = this.getParameterValue<number>(ctx, this.type, 'mix', 0.5);
        const preDelaySize = Math.round(this.getParameterValue<number>(ctx, this.type, 'preDelay', 655));
        
        // Allocate registers
        const krlReg = ctx.allocateRegister(this.type, 'krl');  // reverb level
        const decayReg = ctx.allocateRegister(this.type, 'decay');  // decay coefficient
        const decayDiff2Reg = ctx.allocateRegister(this.type, 'decay_diffusion_2');
        const dampingReg = ctx.allocateRegister(this.type, 'damping');
        const oneMinusDmpgReg = ctx.allocateRegister(this.type, 'one_minus_dmpg');
        const lpInpReg = ctx.allocateRegister(this.type, 'lp_inp');
        const lp30_31Reg = ctx.allocateRegister(this.type, 'lp30_31');
        const lp54_55Reg = ctx.allocateRegister(this.type, 'lp54_55');
        const monoReg = ctx.allocateRegister(this.type, 'mono');
        const diffuseInReg = ctx.allocateRegister(this.type, 'diffuse_in');
        const tempReg = ctx.allocateRegister(this.type, 'temp');
        const temp2Reg = ctx.allocateRegister(this.type, 'temp2');
        
        // Constants from Dattorro paper
        const decayDiff1 = ctx.getStandardConstant(0.70);
        const inputDiff1 = ctx.getStandardConstant(0.75);
        const inputDiff2 = ctx.getStandardConstant(0.625);
        const k1_2kHz = ctx.getStandardConstant(0.68148);
        const bandwidth = ctx.getStandardConstant(1 - 0.68148);
        const excursion = 8;
        
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        const negOne = ctx.getStandardConstant(-1.0);
        const half = ctx.getStandardConstant(0.5);
        
        // Allocate memory for pre-delay (each needs unique name)
        const predelay = ctx.allocateMemory(`plate_predelay`, preDelaySize);
        
        // Input diffusion allpasses
        const ap13_14 = ctx.allocateMemory(`plate_ap13_14`, 156);
        const ap19_20 = ctx.allocateMemory(`plate_ap19_20`, 117);
        const ap15_16 = ctx.allocateMemory(`plate_ap15_16`, 417);
        const ap21_22 = ctx.allocateMemory(`plate_ap21_22`, 305);
        
        // Left tank
        const ap23_24 = ctx.allocateMemory(`plate_ap23_24`, 740 + excursion);
        const del24_30 = ctx.allocateMemory(`plate_del24_30`, 4903);
        const ap31_33 = ctx.allocateMemory(`plate_ap31_33`, 1982 + excursion);
        const del33_39 = ctx.allocateMemory(`plate_del33_39`, 4096);
        
        // Right tank
        const ap46_48 = ctx.allocateMemory(`plate_ap46_48`, 1000 + excursion);
        const del48_54 = ctx.allocateMemory(`plate_del48_54`, 4643);
        const ap55_59 = ctx.allocateMemory(`plate_ap55_59`, 2924 + excursion);
        const del59_63 = ctx.allocateMemory(`plate_del59_63`, 3483);
        
        // Initialize LFOs for allpass modulation
        ctx.pushInitCode('; Plate Reverb');
        ctx.pushInitCode('skp\tRUN,\tplatereverb_init_end');
        ctx.pushInitCode(`wlds\tSIN0,\t27,\t${excursion}\t; 1Hz LFO for AP modulation`);
        ctx.pushInitCode(`wlds\tSIN1,\t23,\t${excursion}\t; ~1Hz LFO for AP modulation`);
        ctx.pushInitCode('platereverb_init_end:');
        ctx.pushInitCode('');
        
        // Main processing
        ctx.pushMainCode('; Plate Reverb');
        
        // Calculate control coefficients from CV inputs or parameters
        ctx.pushMainCode(`; Calculate reverb level (squared)`);
        if (mixCVReg) {
            ctx.pushMainCode(`rdax\t${mixCVReg},\t${one}\t; Read mix from CV input`);
            ctx.pushMainCode(`mulx\t${mixCVReg}`);
        } else {
            const mixParam = ctx.getStandardConstant(mix);
            ctx.pushMainCode(`rdax\t${mixParam},\t${one}`);
            ctx.pushMainCode(`mulx\t${mixParam}`);
        }
        ctx.pushMainCode(`wrax\t${krlReg},\t${zero}`);
        ctx.pushMainCode('');
        
        const decayLimit = ctx.getStandardConstant(0.8);
        ctx.pushMainCode(`; Calculate decay time (limited to 0.8 max)`);
        if (decayTimeCVReg) {
            ctx.pushMainCode(`rdax\t${decayTimeCVReg},\t${one}\t; Read decay time from CV input`);
        } else {
            const decayParam = ctx.getStandardConstant(decayTime);
            ctx.pushMainCode(`rdax\t${decayParam},\t${one}`);
        }
        ctx.pushMainCode(`sof\t${decayLimit},\t${zero}`);
        ctx.pushMainCode(`wrax\t${decayReg},\t${one}`);
        ctx.pushMainCode('');
        
        // Calculate decay_diffusion_2 = decay + 0.15, clamped to [0.25, 0.5]
        const c0_35 = ctx.getStandardConstant(0.35);
        const c0_10 = ctx.getStandardConstant(0.10);
        const c0_25 = ctx.getStandardConstant(0.25);
        ctx.pushMainCode(`; Calculate decay_diffusion_2 (decay + 0.15, clamped to [0.25, 0.5])`);
        ctx.pushMainCode(`sof\t${one},\t-${c0_35}\t; Check ceiling`);
        ctx.pushMainCode(`skp\tNEG,\t1`);
        ctx.pushMainCode(`clr`);
        ctx.pushMainCode(`sof\t${one},\t${c0_35}`);
        ctx.pushMainCode(`sof\t${one},\t-${c0_10}\t; Check floor`);
        ctx.pushMainCode(`skp\tGEZ,\t1`);
        ctx.pushMainCode(`clr`);
        ctx.pushMainCode(`sof\t${one},\t${c0_25}`);
        ctx.pushMainCode(`wrax\t${decayDiff2Reg},\t${zero}`);
        ctx.pushMainCode('');
        
        // Calculate damping coefficients from CV input or parameter
        const c0_99 = ctx.getStandardConstant(0.99);
        const c0_999 = ctx.getStandardConstant(0.9990234375);
        ctx.pushMainCode(`; Calculate damping coefficients`);
        if (dampingCVReg) {
            ctx.pushMainCode(`rdax\t${dampingCVReg},\t${one}\t; Read damping from CV input`);
        } else {
            const dampParam = ctx.getStandardConstant(damping);
            ctx.pushMainCode(`rdax\t${dampParam},\t${one}`);
        }
        ctx.pushMainCode(`sof\t${negOne},\t${c0_99}\t; Invert damping`);
        ctx.pushMainCode(`wrax\t${dampingReg},\t${negOne}`);
        ctx.pushMainCode(`sof\t${one},\t${c0_999}`);
        ctx.pushMainCode(`wrax\t${oneMinusDmpgReg},\t${zero}`);
        ctx.pushMainCode('');
        
        // Sum inputs to mono
        ctx.pushMainCode(`; Sum inputs to mono`);
        ctx.pushMainCode(`rdax\t${inputReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${monoReg},\t${one}`);
        ctx.pushMainCode('');
        
        // Pre-delay
        ctx.pushMainCode(`; Pre-delay`);
        ctx.pushMainCode(`wra\t${predelay.name},\t${zero}`);
        ctx.pushMainCode('');
        
        // Input low-pass filter
        ctx.pushMainCode(`; Input low-pass filter`);
        ctx.pushMainCode(`rda\t${predelay.name}#,\t${bandwidth}`);
        ctx.pushMainCode(`rdax\t${lpInpReg},\t${one}-${bandwidth}`);
        ctx.pushMainCode(`wrax\t${lpInpReg},\t${one}`);
        ctx.pushMainCode('');
        
        // Input diffusion network (4 allpass filters)
        ctx.pushMainCode(`; Input diffusion network`);
        ctx.pushMainCode(`rda\t${ap13_14.name}#,\t-${inputDiff1}`);
        ctx.pushMainCode(`wrap\t${ap13_14.name},\t${inputDiff1}`);
        ctx.pushMainCode(`rda\t${ap19_20.name}#,\t-${inputDiff1}`);
        ctx.pushMainCode(`wrap\t${ap19_20.name},\t${inputDiff1}`);
        ctx.pushMainCode(`rda\t${ap15_16.name}#,\t-${inputDiff2}`);
        ctx.pushMainCode(`wrap\t${ap15_16.name},\t${inputDiff2}`);
        ctx.pushMainCode(`rda\t${ap21_22.name}#,\t-${inputDiff2}`);
        ctx.pushMainCode(`wrap\t${ap21_22.name},\t${inputDiff2}`);
        ctx.pushMainCode(`wrax\t${diffuseInReg},\t${zero}`);
        ctx.pushMainCode('');
        
        // Left side of tank
        ctx.pushMainCode(`; Left side of tank`);
        ctx.pushMainCode(`rda\t${del59_63.name}#,\t${one}`);
        ctx.pushMainCode(`mulx\t${decayReg}`);
        ctx.pushMainCode(`rdax\t${diffuseInReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${tempReg},\t${zero}`);
        ctx.pushMainCode('');
        
        // Modulated allpass
        ctx.pushMainCode(`cho\tRDA,\tSIN0,\tSIN|REG|COMPC,\t${ap23_24.name}#-${excursion}-1`);
        ctx.pushMainCode(`cho\tRDA,\tSIN0,\tSIN,\t${ap23_24.name}#-${excursion}`);
        ctx.pushMainCode(`wrax\t${temp2Reg},\t${decayDiff1}`);
        ctx.pushMainCode(`rdax\t${tempReg},\t${one}`);
        ctx.pushMainCode(`wra\t${ap23_24.name},\t-${decayDiff1}`);
        ctx.pushMainCode(`rdax\t${temp2Reg},\t${one}`);
        ctx.pushMainCode('');
        
        ctx.pushMainCode(`wra\t${del24_30.name},\t${zero}`);
        ctx.pushMainCode(`rda\t${del24_30.name}#,\t${one}`);
        ctx.pushMainCode('');
        
        // Tank low-pass filter
        ctx.pushMainCode(`; Tank low-pass filter`);
        ctx.pushMainCode(`mulx\t${oneMinusDmpgReg}`);
        ctx.pushMainCode(`wrax\t${tempReg},\t${zero}`);
        ctx.pushMainCode(`rdax\t${lp30_31Reg},\t${one}`);
        ctx.pushMainCode(`mulx\t${dampingReg}`);
        ctx.pushMainCode(`rdax\t${tempReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${lp30_31Reg},\t${one}`);
        ctx.pushMainCode(`mulx\t${decayReg}`);
        ctx.pushMainCode(`wrax\t${tempReg},\t${zero}`);
        ctx.pushMainCode('');
        
        // Another modulated allpass with variable coefficient
        ctx.pushMainCode(`cho\tRDA,\tSIN1,\tCOS|REG|COMPC,\t${ap31_33.name}#-${excursion}-1`);
        ctx.pushMainCode(`cho\tRDA,\tSIN1,\tCOS,\t${ap31_33.name}#-${excursion}`);
        ctx.pushMainCode(`wrax\t${temp2Reg},\t${negOne}`);
        ctx.pushMainCode(`mulx\t${decayDiff2Reg}`);
        ctx.pushMainCode(`rdax\t${tempReg},\t${one}`);
        ctx.pushMainCode(`wra\t${ap31_33.name},\t${one}`);
        ctx.pushMainCode(`mulx\t${decayDiff2Reg}`);
        ctx.pushMainCode(`rdax\t${temp2Reg},\t${one}`);
        ctx.pushMainCode('');
        
        ctx.pushMainCode(`wra\t${del33_39.name},\t${zero}`);
        ctx.pushMainCode(`rda\t${del33_39.name}#,\t${one}`);
        ctx.pushMainCode('');
        
        // Right side of tank
        ctx.pushMainCode(`; Right side of tank`);
        ctx.pushMainCode(`mulx\t${decayReg}`);
        ctx.pushMainCode(`rdax\t${diffuseInReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${tempReg},\t${zero}`);
        ctx.pushMainCode('');
        
        ctx.pushMainCode(`cho\tRDA,\tSIN0,\tCOS|REG|COMPC,\t${ap46_48.name}#-${excursion}-1`);
        ctx.pushMainCode(`cho\tRDA,\tSIN0,\tCOS,\t${ap46_48.name}#-${excursion}`);
        ctx.pushMainCode(`wrax\t${temp2Reg},\t${decayDiff1}`);
        ctx.pushMainCode(`rdax\t${tempReg},\t${one}`);
        ctx.pushMainCode(`wra\t${ap46_48.name},\t-${decayDiff1}`);
        ctx.pushMainCode(`rdax\t${temp2Reg},\t${one}`);
        ctx.pushMainCode('');
        
        ctx.pushMainCode(`wra\t${del48_54.name},\t${zero}`);
        ctx.pushMainCode(`rda\t${del48_54.name}#,\t${one}`);
        ctx.pushMainCode('');
        
        ctx.pushMainCode(`mulx\t${oneMinusDmpgReg}`);
        ctx.pushMainCode(`wrax\t${tempReg},\t${zero}`);
        ctx.pushMainCode(`rdax\t${lp54_55Reg},\t${one}`);
        ctx.pushMainCode(`mulx\t${dampingReg}`);
        ctx.pushMainCode(`rdax\t${tempReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${lp54_55Reg},\t${one}`);
        ctx.pushMainCode(`mulx\t${decayReg}`);
        ctx.pushMainCode(`wrax\t${tempReg},\t${zero}`);
        ctx.pushMainCode('');
        
        ctx.pushMainCode(`cho\tRDA,\tSIN1,\tSIN|REG|COMPC,\t${ap55_59.name}#-${excursion}-1`);
        ctx.pushMainCode(`cho\tRDA,\tSIN1,\tSIN,\t${ap55_59.name}#-${excursion}`);
        ctx.pushMainCode(`wrax\t${temp2Reg},\t${negOne}`);
        ctx.pushMainCode(`mulx\t${decayDiff2Reg}`);
        ctx.pushMainCode(`rdax\t${tempReg},\t${one}`);
        ctx.pushMainCode(`wra\t${ap55_59.name},\t${one}`);
        ctx.pushMainCode(`mulx\t${decayDiff2Reg}`);
        ctx.pushMainCode(`rdax\t${temp2Reg},\t${one}`);
        ctx.pushMainCode('');
        
        
        ctx.pushMainCode(`wra\t${del59_63.name},\t${zero}`);
        ctx.pushMainCode('');
        
        // Gather outputs from multiple taps (Left channel)
        const tap0_6 = ctx.getStandardConstant(0.6);
        const tapNeg0_6 = ctx.getStandardConstant(-0.6);
        
        ctx.pushMainCode(`; Gather left output from multiple taps`);
        ctx.pushMainCode(`rda\t${del48_54.name}+292,\t${tap0_6}`);
        ctx.pushMainCode(`rda\t${del48_54.name}+3274,\t${tap0_6}`);
        ctx.pushMainCode(`rda\t${ap55_59.name}+2107,\t${tapNeg0_6}`);
        ctx.pushMainCode(`rda\t${del59_63.name}+2198,\t${tap0_6}`);
        ctx.pushMainCode(`rda\t${del24_30.name}+2192,\t${tapNeg0_6}`);
        ctx.pushMainCode(`rda\t${ap31_33.name}+205,\t${tapNeg0_6}`);
        ctx.pushMainCode(`rda\t${del33_39.name}+1174,\t${tapNeg0_6}`);
        ctx.pushMainCode('');
        
        ctx.pushMainCode(`; Mix dry/wet for left channel`);
        ctx.pushMainCode(`rdax\t${monoReg},\t${negOne}`);
        ctx.pushMainCode(`mulx\t${krlReg}`);
        ctx.pushMainCode(`rdax\t${monoReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${outLReg},\t${zero}`);
        ctx.pushMainCode('');
        
        // Gather outputs from multiple taps (Right channel)
        ctx.pushMainCode(`; Gather right output from multiple taps`);
        ctx.pushMainCode(`rda\t${del24_30.name}+389,\t${tap0_6}`);
        ctx.pushMainCode(`rda\t${del24_30.name}+3993,\t${tap0_6}`);
        ctx.pushMainCode(`rda\t${ap31_33.name}+1352,\t${tapNeg0_6}`);
        ctx.pushMainCode(`rda\t${del33_39.name}+2943,\t${tap0_6}`);
        ctx.pushMainCode(`rda\t${del48_54.name}+2325,\t${tapNeg0_6}`);
        ctx.pushMainCode(`rda\t${ap55_59.name}+369,\t${tapNeg0_6}`);
        ctx.pushMainCode(`rda\t${del59_63.name}+133,\t${tapNeg0_6}`);
        ctx.pushMainCode('');
        
        ctx.pushMainCode(`; Mix dry/wet for right channel`);
        ctx.pushMainCode(`rdax\t${monoReg},\t${negOne}`);
        ctx.pushMainCode(`mulx\t${krlReg}`);
        ctx.pushMainCode(`rdax\t${monoReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${outRReg},\t${zero}`);
        ctx.pushMainCode('');
    }
}
