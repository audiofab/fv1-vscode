/**
 * Room Reverb Block
 * Ported from SpinCAD's Reverb_Room block
 * 
 * Hall-style reverb with pre-delay, 4 input allpass filters,
 * 4 parallel delay loops with allpass filters and damping,
 * and LFO modulation for added depth.
 * 
 * Structure:
 * - Variable pre-delay (0-3276 samples)
 * - Early reflections tap delay (4000 samples)
 * - 4 input allpass filters
 * - 4 parallel delay loops with:
 *   - 2 allpass filters each
 *   - High-pass and low-pass damping
 *   - Feedback control
 * - LFO modulation on selected allpass filters
 * - Stereo outputs
 * 
 * Translation Notes:
 * - krt controls reverb time (feedback coefficient)
 * - hpdf controls high-frequency damping
 * - inputkap/dlkap are allpass coefficients
 * - Pre-delay controlled by CV or parameter
 * - Uses SIN0 LFO for chorus effect in allpass filters
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class RoomReverbBlock extends BaseBlock {
    readonly type = 'effects.reverb.room';
    readonly category = 'Reverb';
    readonly name = 'Room Reverb';
    readonly description = 'Hall-style reverb with pre-delay, damping, and stereo output';
    readonly color = '#7100FC';
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'input', name: 'Input', type: 'audio', required: true },
            { id: 'pre_delay', name: 'Pre Delay', type: 'control', required: false },
            { id: 'reverb_time', name: 'Reverb Time', type: 'control', required: false },
            { id: 'hf_loss', name: 'HF Loss', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'outputL', name: 'Output L', type: 'audio' },
            { id: 'outputR', name: 'Output R', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'inputGain',
                name: 'Input Gain',
                type: 'number',
                default: BaseBlock.dbToLinear(-6),
                min: BaseBlock.dbToLinear(-24),
                max: BaseBlock.dbToLinear(0),
                step: 0.01,
                displayMin: -24,
                displayMax: 0,
                displayStep: 0.1,
                displayDecimals: 1,
                displayUnit: 'dB',
                toDisplay: (linear: number) => BaseBlock.linearToDb(linear),
                fromDisplay: (db: number) => BaseBlock.dbToLinear(db),
                description: 'Input signal gain'
            },
            {
                id: 'reverbTime',
                name: 'Reverb Time',
                type: 'number',
                default: 0.5,
                min: 0.05,
                max: 0.95,
                step: 0.01,
                displayDecimals: 2,
                description: 'Reverb decay time coefficient (0.05-0.95)'
            },
            {
                id: 'hfDamping',
                name: 'HF Damping',
                type: 'number',
                default: this.hzToFilterCoeff(100),
                min: this.hzToFilterCoeff(40),
                max: this.hzToFilterCoeff(1000),
                step: 0.001,
                displayMin: 40,
                displayMax: 1000,
                displayStep: 10,
                displayDecimals: 0,
                displayUnit: 'Hz',
                toDisplay: (coeff: number) => this.filterCoeffToHz(coeff),
                fromDisplay: (hz: number) => this.hzToFilterCoeff(hz),
                description: 'High frequency damping cutoff frequency'
            },
            {
                id: 'inputAllpassCoeff',
                name: 'Input Allpass',
                type: 'number',
                default: 0.5,
                min: 0.05,
                max: 0.95,
                step: 0.01,
                displayDecimals: 2,
                description: 'Input allpass filter coefficient'
            },
            {
                id: 'delayAllpassCoeff',
                name: 'Delay Allpass',
                type: 'number',
                default: 0.5,
                min: 0.05,
                max: 0.95,
                step: 0.01,
                displayDecimals: 2,
                description: 'Delay loop allpass filter coefficient'
            },
            {
                id: 'lfoRate',
                name: 'LFO Rate',
                type: 'number',
                default: 20,
                min: 0,
                max: 511,
                step: 1,
                displayMin: 0.0,
                displayMax: this.lfoRateToHz(511),
                displayStep: 0.1,
                displayDecimals: 1,
                displayUnit: 'Hz',
                toDisplay: (rate: number) => this.lfoRateToHz(rate),
                fromDisplay: (hz: number) => this.hzToLfoRate(hz),
                description: 'LFO modulation rate'
            }
        ];
        
        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'input');
        const preDelayReg = ctx.getInputRegister(this.type, 'pre_delay');
        const reverbTimeReg = ctx.getInputRegister(this.type, 'reverb_time');
        const hfLossReg = ctx.getInputRegister(this.type, 'hf_loss');
        
        if (!inputReg) {
            ctx.pushMainCode(`; Room Reverb (no input connected)`);
            return;
        }
        
        // Get parameters
        const gain = this.getParameterValue(ctx, this.type, 'inputGain', 0.5);
        const krt = this.getParameterValue(ctx, this.type, 'reverbTime', 0.5);
        const hpdf = this.getParameterValue(ctx, this.type, 'hfDamping', 0.02);
        const inputkap = this.getParameterValue(ctx, this.type, 'inputAllpassCoeff', 0.5);
        const dlkap = this.getParameterValue(ctx, this.type, 'delayAllpassCoeff', 0.5);
        const rate1 = this.getParameterValue(ctx, this.type, 'lfoRate', 20);
        
        // Allocate delay memory - each needs unique identifier
        const pdel = ctx.allocateMemory(`pdel`, 3276);
        const tdel = ctx.allocateMemory(`tdel`, 4000);
        const ap1 = ctx.allocateMemory(`ap1`, 473);
        const ap2 = ctx.allocateMemory(`ap2`, 536);
        const ap3 = ctx.allocateMemory(`ap3`, 667);
        const ap4 = ctx.allocateMemory(`ap4`, 791);
        const tap1 = ctx.allocateMemory(`tap1`, 452);
        const tap2 = ctx.allocateMemory(`tap2`, 561);
        const lap1a = ctx.allocateMemory(`lap1a`, 878);
        const lap1b = ctx.allocateMemory(`lap1b`, 1287);
        const d1 = ctx.allocateMemory(`d1`, 1536);
        const lap2a = ctx.allocateMemory(`lap2a`, 968);
        const lap2b = ctx.allocateMemory(`lap2b`, 1367);
        const d2 = ctx.allocateMemory(`d2`, 1891);
        const lap3a = ctx.allocateMemory(`lap3a`, 678);
        const lap3b = ctx.allocateMemory(`lap3b`, 1127);
        const d3 = ctx.allocateMemory(`d3`, 1936);
        const lap4a = ctx.allocateMemory(`lap4a`, 1263);
        const lap4b = ctx.allocateMemory(`lap4b`, 1198);
        const d4 = ctx.allocateMemory(`d4`, 1781);
        
        // Allocate registers
        const apoutReg = ctx.allocateRegister(this.type, 'apout');
        const tempReg = ctx.allocateRegister(this.type, 'temp');
        const outputLReg = ctx.allocateRegister(this.type, 'outputL');
        const outputRReg = ctx.allocateRegister(this.type, 'outputR');
        const kdReg = ctx.allocateRegister(this.type, 'kd');
        const lp1Reg = ctx.allocateRegister(this.type, 'lp1');
        const lp2Reg = ctx.allocateRegister(this.type, 'lp2');
        const lp3Reg = ctx.allocateRegister(this.type, 'lp3');
        const lp4Reg = ctx.allocateRegister(this.type, 'lp4');
        const hp1Reg = ctx.allocateRegister(this.type, 'hp1');
        const hp2Reg = ctx.allocateRegister(this.type, 'hp2');
        const tlpReg = ctx.allocateRegister(this.type, 'tlp');
        
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        const negOne = ctx.getStandardConstant(-1.0);
        
        // Initialize registers and LFO on first run
        const labelInit = `room_reverb_${this.sanitizeLabelForAsm(this.type)}_init`;
        ctx.pushInitCode(`; Room Reverb init`);
        ctx.pushInitCode(`skp run, ${labelInit}`);
        ctx.pushInitCode(`wrax ${lp1Reg}, ${zero}`);
        ctx.pushInitCode(`wrax ${lp2Reg}, ${zero}`);
        ctx.pushInitCode(`wrax ${hp1Reg}, ${zero}`);
        ctx.pushInitCode(`wrax ${hp2Reg}, ${zero}`);
        ctx.pushInitCode(`wrax ${tlpReg}, ${zero}`);
        ctx.pushInitCode(`wlds SIN0, ${Math.floor(rate1)}, 100`);
        ctx.pushInitCode(`${labelInit}:`);
        
        ctx.pushMainCode(`; Room Reverb`);
        
        // Calculate pre-delay address pointer
        if (preDelayReg) {
            ctx.pushMainCode(`rdax ${preDelayReg}, ${this.formatS1_14(0.1)}`);
        } else {
            ctx.pushMainCode(`sof ${zero}, ${this.formatS1_14(0.025)}`);
        }
        ctx.pushMainCode(`wrax ADDR_PTR, ${zero}`);
        
        // Feed input to pre-delay
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(gain)}`);
        ctx.pushMainCode(`wra ${pdel.name}, ${zero}`);
        
        // Read pre-delay and write to tap delay
        ctx.pushMainCode(`rmpa ${one}`);
        ctx.pushMainCode(`wra ${tdel.name}, ${one}`);
        
        // 4 input allpass filters
        ctx.pushMainCode(`rda ${ap1.name}^, ${this.formatS1_14(inputkap)}`);
        ctx.pushMainCode(`wrap ${ap1.name}, ${this.formatS1_14(-inputkap)}`);
        ctx.pushMainCode(`rda ${ap2.name}^, ${this.formatS1_14(inputkap)}`);
        ctx.pushMainCode(`wrap ${ap2.name}, ${this.formatS1_14(-inputkap)}`);
        ctx.pushMainCode(`rda ${ap3.name}^, ${this.formatS1_14(inputkap)}`);
        ctx.pushMainCode(`wrap ${ap3.name}, ${this.formatS1_14(-inputkap)}`);
        ctx.pushMainCode(`rda ${ap4.name}^, ${this.formatS1_14(inputkap)}`);
        ctx.pushMainCode(`wrap ${ap4.name}, ${this.formatS1_14(-inputkap)}`);
        ctx.pushMainCode(`wrax ${apoutReg}, ${zero}`);
        
        // === Delay Loop 1 ===
        ctx.pushMainCode(`; Delay loop 1`);
        ctx.pushMainCode(`rda ${d4.name}^, ${this.formatS1_14(krt)}`);
        if (reverbTimeReg) {
            ctx.pushMainCode(`mulx ${reverbTimeReg}`);
        }
        ctx.pushMainCode(`rdax ${apoutReg}, ${one}`);
        ctx.pushMainCode(`rda ${lap1a.name}^, ${this.formatS1_14(dlkap)}`);
        ctx.pushMainCode(`wrap ${lap1a.name}, ${this.formatS1_14(-dlkap)}`);
        ctx.pushMainCode(`rda ${lap1b.name}^, ${this.formatS1_14(-dlkap)}`);
        ctx.pushMainCode(`wrap ${lap1b.name}, ${this.formatS1_14(dlkap)}`);
        ctx.pushMainCode(`rdfx ${hp1Reg}, ${this.formatS1_14(hpdf)}`);
        ctx.pushMainCode(`wrhx ${hp1Reg}, ${this.formatS1_14(-0.5)}`);
        ctx.pushMainCode(`wrax ${tempReg}, ${negOne}`);
        ctx.pushMainCode(`rdfx ${lp1Reg}, ${this.formatS1_14(0.5)}`);
        ctx.pushMainCode(`wrhx ${lp1Reg}, ${negOne}`);
        if (hfLossReg) {
            ctx.pushMainCode(`mulx ${hfLossReg}`);
        }
        ctx.pushMainCode(`rdax ${tempReg}, ${one}`);
        ctx.pushMainCode(`wra ${d1.name}, ${zero}`);
        
        // === Delay Loop 2 ===
        ctx.pushMainCode(`; Delay loop 2`);
        ctx.pushMainCode(`rda ${d1.name}^, ${this.formatS1_14(-krt)}`);
        if (reverbTimeReg) {
            ctx.pushMainCode(`mulx ${reverbTimeReg}`);
        }
        ctx.pushMainCode(`rdax ${apoutReg}, ${one}`);
        ctx.pushMainCode(`rda ${lap2a.name}^, ${this.formatS1_14(dlkap)}`);
        ctx.pushMainCode(`wrap ${lap2a.name}, ${this.formatS1_14(-dlkap)}`);
        ctx.pushMainCode(`rda ${lap2b.name}^, ${this.formatS1_14(dlkap)}`);
        ctx.pushMainCode(`wrap ${lap2b.name}, ${this.formatS1_14(-dlkap)}`);
        ctx.pushMainCode(`rdfx ${hp2Reg}, ${this.formatS1_14(hpdf)}`);
        ctx.pushMainCode(`wrhx ${hp2Reg}, ${this.formatS1_14(-0.5)}`);
        ctx.pushMainCode(`wrax ${tempReg}, ${negOne}`);
        ctx.pushMainCode(`rdfx ${lp2Reg}, ${this.formatS1_14(0.5)}`);
        ctx.pushMainCode(`wrhx ${lp2Reg}, ${negOne}`);
        if (hfLossReg) {
            ctx.pushMainCode(`mulx ${hfLossReg}`);
        }
        ctx.pushMainCode(`rdax ${tempReg}, ${one}`);
        ctx.pushMainCode(`wra ${d2.name}, ${zero}`);
        
        // === Delay Loop 3 ===
        ctx.pushMainCode(`; Delay loop 3`);
        ctx.pushMainCode(`rda ${d2.name}^, ${negOne}`);
        if (reverbTimeReg) {
            ctx.pushMainCode(`mulx ${reverbTimeReg}`);
        }
        ctx.pushMainCode(`rdax ${apoutReg}, ${one}`);
        ctx.pushMainCode(`rda ${lap3a.name}^, ${this.formatS1_14(dlkap)}`);
        ctx.pushMainCode(`wrap ${lap3a.name}, ${this.formatS1_14(-dlkap)}`);
        ctx.pushMainCode(`rda ${lap3b.name}^, ${this.formatS1_14(dlkap)}`);
        ctx.pushMainCode(`wrap ${lap3b.name}, ${this.formatS1_14(-dlkap)}`);
        ctx.pushMainCode(`rdfx ${hp2Reg}, ${this.formatS1_14(0.05)}`);
        ctx.pushMainCode(`wrhx ${hp2Reg}, ${this.formatS1_14(-0.5)}`);
        ctx.pushMainCode(`wrax ${tempReg}, ${negOne}`);
        ctx.pushMainCode(`rdfx ${lp3Reg}, ${this.formatS1_14(0.5)}`);
        ctx.pushMainCode(`wrhx ${lp3Reg}, ${negOne}`);
        ctx.pushMainCode(`mulx ${kdReg}`);
        ctx.pushMainCode(`rdax ${tempReg}, ${one}`);
        ctx.pushMainCode(`wra ${d3.name}, ${zero}`);
        
        // === Delay Loop 4 ===
        ctx.pushMainCode(`; Delay loop 4`);
        ctx.pushMainCode(`rda ${d3.name}^, ${negOne}`);
        if (reverbTimeReg) {
            ctx.pushMainCode(`mulx ${reverbTimeReg}`);
        }
        ctx.pushMainCode(`rdax ${apoutReg}, ${one}`);
        ctx.pushMainCode(`rda ${lap4a.name}^, ${this.formatS1_14(dlkap)}`);
        ctx.pushMainCode(`wrap ${lap4a.name}, ${this.formatS1_14(-dlkap)}`);
        ctx.pushMainCode(`rda ${lap4b.name}^, ${this.formatS1_14(dlkap)}`);
        ctx.pushMainCode(`wrap ${lap4b.name}, ${this.formatS1_14(-dlkap)}`);
        ctx.pushMainCode(`wrax ${tempReg}, ${negOne}`);
        ctx.pushMainCode(`rdfx ${lp4Reg}, ${this.formatS1_14(0.5)}`);
        ctx.pushMainCode(`wrhx ${lp4Reg}, ${negOne}`);
        ctx.pushMainCode(`mulx ${kdReg}`);
        ctx.pushMainCode(`rdax ${tempReg}, ${one}`);
        ctx.pushMainCode(`wra ${d4.name}, ${zero}`);
        
        // === Process tap delay with allpass filters ===
        ctx.pushMainCode(`; Tap delay processing`);
        ctx.pushMainCode(`rda ${tdel.name}+100, ${one}`);
        ctx.pushMainCode(`rda ${tap1.name}^, ${this.formatS1_14(0.5)}`);
        ctx.pushMainCode(`wrap ${tap1.name}, ${this.formatS1_14(-0.5)}`);
        ctx.pushMainCode(`wrax ${tempReg}, ${one}`);
        ctx.pushMainCode(`rdfx ${tlpReg}, ${this.formatS1_14(0.1)}`);
        ctx.pushMainCode(`wrhx ${tlpReg}, ${negOne}`);
        if (hfLossReg) {
            ctx.pushMainCode(`mulx ${hfLossReg}`);
        }
        ctx.pushMainCode(`rdax ${tempReg}, ${one}`);
        ctx.pushMainCode(`wra ${tdel.name}+101, ${zero}`);
        
        ctx.pushMainCode(`rda ${tdel.name}+1000, ${one}`);
        ctx.pushMainCode(`rda ${tap2.name}^, ${this.formatS1_14(0.5)}`);
        ctx.pushMainCode(`wrap ${tap2.name}, ${this.formatS1_14(-0.5)}`);
        ctx.pushMainCode(`wra ${tdel.name}+1001, ${zero}`);
        
        // === Mix outputs ===
        // Check if stereo output is connected
        const stereoOutput = ctx.isOutputConnected(this.type, 'outputR');
        
        ctx.pushMainCode(`; Left output mix`);
        ctx.pushMainCode(`rda ${tdel.name}+701, ${this.formatS1_14(0.7)}`);
        ctx.pushMainCode(`rda ${tdel.name}+956, ${this.formatS1_14(0.6)}`);
        ctx.pushMainCode(`rda ${tdel.name}+409, ${this.formatS1_14(0.5)}`);
        ctx.pushMainCode(`rda ${tdel.name}+1323, ${this.formatS1_14(0.4)}`);
        
        if (stereoOutput) {
            ctx.pushMainCode(`rda ${d1.name}, ${this.formatS1_14(1.5)}`);
        } else {
            ctx.pushMainCode(`rda ${d1.name}^, ${this.formatS1_14(0.7)}`);
            ctx.pushMainCode(`rda ${d2.name}^, ${this.formatS1_14(0.8)}`);
        }
        ctx.pushMainCode(`wrax ${outputLReg}, ${zero}`);
        
        if (stereoOutput) {
            ctx.pushMainCode(`; Right output mix`);
            ctx.pushMainCode(`rda ${tdel.name}+582, ${this.formatS1_14(0.7)}`);
            ctx.pushMainCode(`rda ${tdel.name}+956, ${this.formatS1_14(0.6)}`);
            ctx.pushMainCode(`rda ${tdel.name}+1047, ${this.formatS1_14(0.5)}`);
            ctx.pushMainCode(`rda ${tdel.name}+1323, ${this.formatS1_14(0.4)}`);
            ctx.pushMainCode(`rda ${d3.name}, ${this.formatS1_14(1.5)}`);
            ctx.pushMainCode(`wrax ${outputRReg}, ${zero}`);
        }
        
        // === LFO modulation on allpass filters ===
        ctx.pushMainCode(`; LFO chorus modulation`);
        ctx.pushMainCode(`cho rda, SIN0, REG|COMPC, ${lap1b.name}+100`);
        ctx.pushMainCode(`cho rda, SIN0, SIN, ${lap1b.name}+101`);
        ctx.pushMainCode(`wra ${lap1b.name}+200, ${zero}`);
        
        ctx.pushMainCode(`cho rda, SIN0, COS|REG|COMPC, ${lap3b.name}+100`);
        ctx.pushMainCode(`cho rda, SIN0, COS, ${lap3b.name}+101`);
        ctx.pushMainCode(`wra ${lap3b.name}+200, ${zero}`);
        
        ctx.pushMainCode('');
    }
}
