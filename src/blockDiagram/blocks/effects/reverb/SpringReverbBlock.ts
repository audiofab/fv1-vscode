/**
 * Spring Reverb Block
 * Based on Don Stavely's spring reverb algorithm (2016)
 * Enhanced version with Abbey Road EMI RS127 pre-reverb filter
 * 
 * Simulates mechanical spring reverb with characteristic "boingy" sound
 * caused by dispersion (high frequencies travel slower than low frequencies).
 * 
 * Features:
 * - Two cross-coupled delay lines (simulating two springs)
 * - Allpass filters in reverb loops
 * - Spectral delay filter (37 stretched allpass filters) for chirp effect
 * - Abbey Road Studios EMI RS127 pre-reverb filter (600Hz-10kHz)
 * - Post-reverb tone shaping
 * - LFO modulation for smoothing
 * 
 * Modeled after Fender 6G15 reverb tank behavior
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class SpringReverbBlock extends BaseBlock {
    readonly type = 'effects.springreverb';
    readonly category = 'Reverb';
    readonly name = 'Spring Reverb';
    readonly description = 'Fender-style spring reverb with RS127 filtering';
    readonly color = '#7100FC';
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio' },
            { id: 'toneCV', name: 'Tone', type: 'control' },
            { id: 'reverbTimeCV', name: 'Reverb Time', type: 'control' },
            { id: 'mixCV', name: 'Mix', type: 'control' }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'tone',
                name: 'Tone',
                type: 'number',
                default: 0.5,
                min: 0,
                max: 1,
                step: 0.01,
                description: 'Post-reverb tone control (0=dark, 1=bright, overridden by CV input)'
            },
            {
                id: 'reverbTime',
                name: 'Reverb Time',
                type: 'number',
                default: 0.775,
                min: 0.7,
                max: 0.85,
                step: 0.01,
                description: 'Reverb decay time (overridden by CV input)'
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
                id: 'chirpFilters',
                name: 'Chirp Filters',
                type: 'number',
                default: 37,
                min: 7,
                max: 41,
                step: 1,
                description: 'Number of chirp allpass filters (7-41, affects program size)'
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const toneCVReg = ctx.getInputRegister(this.type, 'toneCV');
        const reverbTimeCVReg = ctx.getInputRegister(this.type, 'reverbTimeCV');
        const mixCVReg = ctx.getInputRegister(this.type, 'mixCV');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        
        // Get parameters (used as defaults when CV inputs not connected)
        const tone = this.getParameterValue<number>(ctx, this.type, 'tone', 0.5);
        const reverbTime = this.getParameterValue<number>(ctx, this.type, 'reverbTime', 0.775);
        const mix = this.getParameterValue<number>(ctx, this.type, 'mix', 0.5);
        const chirpFilterCount = Math.round(this.getParameterValue<number>(ctx, this.type, 'chirpFilters', 37));
        
        // Allocate registers
        const monoReg = ctx.allocateRegister(this.type, 'mono');
        const lp1Reg = ctx.allocateRegister(this.type, 'lp1');
        const lp2Reg = ctx.allocateRegister(this.type, 'lp2');
        const KRTReg = ctx.allocateRegister(this.type, 'KRT');  // reverb time
        const revinReg = ctx.allocateRegister(this.type, 'revin');  // RS127 filtered signal
        const kfilReg = ctx.allocateRegister(this.type, 'kfil');  // tone coefficient
        const lpf1Reg = ctx.allocateRegister(this.type, 'lpf1');  // RS127 LPF
        const hpf1Reg = ctx.allocateRegister(this.type, 'hpf1');  // RS127 HPF
        const springReg = ctx.allocateRegister(this.type, 'spring');  // reverb output
        const tempReg = ctx.allocateRegister(this.type, 'temp');  // temp for tone filter
        
        // Constants
        const KAP = ctx.getStandardConstant(-0.6);  // chirp allpass coefficient
        const KLAP = ctx.getStandardConstant(0.6);  // reverb allpass coefficient
        const KRF = ctx.getStandardConstant(0.55);  // reverb lpf freq
        const KRS = ctx.getStandardConstant(-1);    // reverb lpf shelf
        
        const one = ctx.getStandardConstant(1.0);
        const negOne = ctx.getStandardConstant(-1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // RS127 filter constants
        const rs127LPF = ctx.getStandardConstant(0.853);  // 10kHz LPF
        const rs127HPF = ctx.getStandardConstant(0.109);  // 600Hz HPF
        const rs127Shelf = ctx.getStandardConstant(-0.5);
        
        // Tone control mapping (0.1 to 0.5 from pot 0 to 1)
        const toneScale = ctx.getStandardConstant(0.4);
        const toneOffset = ctx.getStandardConstant(0.1);
        
        // Reverb time mapping (0.7 to 0.85 from 0 to 1)
        const rtScale = ctx.getStandardConstant(0.15);
        const rtOffset = ctx.getStandardConstant(0.7);
        
        // Chirp filter lengths
        const LEN1 = 5;
        const LEN2 = 6;
        const LEN3 = 6;
        const LEN4 = 7;
        const LEN5 = 7;
        const LEN6 = 8;
        
        // Allocate memory for reverb delays (each needs unique name)
        const lap1a = ctx.allocateMemory(`lap1a`, 404);
        const lap1b = ctx.allocateMemory(`lap1b`, 967);
        const d1 = ctx.allocateMemory(`d1`, 1445);
        
        const lap2a = ctx.allocateMemory(`lap2a`, 608);
        const lap2b = ctx.allocateMemory(`lap2b`, 893);
        const d2 = ctx.allocateMemory(`d2`, 1013);
        
        // Allocate memory for chirp allpass filters (user-adjustable count)
        const chirpAPs: Array<{name: string; address: number; size: number}> = [];
        const chirpLengths = [
            LEN1, LEN1, LEN1, LEN1, LEN1, LEN1, LEN1,  // ap1-ap7
            LEN2, LEN2, LEN2, LEN2, LEN2, LEN2, LEN2,  // ap8-ap14
            LEN3, LEN3, LEN3, LEN3, LEN3, LEN3, LEN3,  // ap15-ap21
            LEN4, LEN4, LEN4, LEN4, LEN4, LEN4, LEN4,  // ap22-ap28
            LEN5, LEN5, LEN5, LEN5, LEN5, LEN5, LEN5,  // ap29-ap35
            LEN6, LEN6, LEN6, LEN6, LEN6, LEN6         // ap36-ap41
        ];
        
        for (let i = 0; i < chirpFilterCount; i++) {
            chirpAPs.push(ctx.allocateMemory(`ap${i + 1}`, chirpLengths[i]));
        }

        // Initialize LFO
        ctx.pushInitCode('; Spring Reverb');
        ctx.pushInitCode('skp\tRUN,\tspringreverb_init_end');
        ctx.pushInitCode('wlds\tSIN0,\t15,\t40\t; LFO for reverb smoothing');
        ctx.pushInitCode('springreverb_init_end:');
        ctx.pushInitCode('');
        
        // Main processing
        ctx.pushMainCode('; Spring Reverb');
        
        // Calculate tone coefficient (kfil) from CV input or parameter
        if (toneCVReg) {
            ctx.pushMainCode(`rdax\t${toneCVReg},\t${one}\t; Read tone from CV input`);
            ctx.pushMainCode(`sof\t${toneScale},\t${toneOffset}\t; Map [0,1] to [0.1,0.5]`);
        } else {
            ctx.pushMainCode(`sof\t${zero},\t${tone}\t; Read tone from parameter`);
        }
        ctx.pushMainCode(`wrax\t${kfilReg},\t${zero}\t; Write tone coefficient`);
        ctx.pushMainCode('');
        
        // Calculate reverb time (KRT) from CV input or parameter
        if (reverbTimeCVReg) {
            ctx.pushMainCode(`rdax\t${reverbTimeCVReg},\t${one}\t; Read reverb time from CV input`);
            ctx.pushMainCode(`sof\t${rtScale},\t${rtOffset}\t; Map [0,1] to [0.7,0.85]`);
        } else {
            ctx.pushMainCode(`sof\t${zero},\t${reverbTime}\t; Read reverb time from parameter`);
        }
        ctx.pushMainCode(`wrax\t${KRTReg},\t${zero}\t; Write reverb time`);
        ctx.pushMainCode('');
        
        // Sum inputs to mono and keep for RS127 filter
        ctx.pushMainCode(`; Sum inputs to mono`);
        ctx.pushMainCode(`rdax\t${inputReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${monoReg},\t${one}\t; Save and keep in ACC`);
        ctx.pushMainCode('');
        
        // RS127 pre-reverb filter (600Hz HPF + 10kHz LPF)
        ctx.pushMainCode(`; Abbey Road EMI RS127 pre-reverb filter`);
        ctx.pushMainCode(`rdfx\t${lpf1Reg},\t${rs127LPF}\t; 10kHz LPF`);
        ctx.pushMainCode(`wrlx\t${lpf1Reg},\t${rs127Shelf}\t; Shelving LPF`);
        ctx.pushMainCode(`rdfx\t${hpf1Reg},\t${rs127HPF}\t; 600Hz HPF`);
        ctx.pushMainCode(`wrhx\t${hpf1Reg},\t${rs127Shelf}\t; Shelving HPF`);
        ctx.pushMainCode(`wrax\t${revinReg},\t${one}\t; Save filtered signal`);
        ctx.pushMainCode('');
        
        // Reverb loop 1
        ctx.pushMainCode(`; Reverb loop 1`);
        ctx.pushMainCode(`rda\t${d1.name}#,\t${one}\t; Get 1st delay output`);
        ctx.pushMainCode(`mulx\t${KRTReg}\t\t; Apply reverb time`);
        ctx.pushMainCode(`rdfx\t${lp1Reg},\t${KRF}\t; Shelving lowpass`);
        ctx.pushMainCode(`wrlx\t${lp1Reg},\t${KRS}`);
        ctx.pushMainCode(`rda\t${lap1a.name}#,\t${KLAP}\t; Reverb allpass 1a`);
        ctx.pushMainCode(`wrap\t${lap1a.name},\t-${KLAP}`);
        ctx.pushMainCode(`rda\t${lap1b.name}#,\t${KLAP}\t; Reverb allpass 1b`);
        ctx.pushMainCode(`wrap\t${lap1b.name},\t-${KLAP}`);
        ctx.pushMainCode(`rdax\t${revinReg},\t${one}\t; Add filtered input`);
        ctx.pushMainCode(`wra\t${d2.name},\t${zero}\t; Put in 2nd spring delay`);
        ctx.pushMainCode('');
        
        // Reverb loop 2
        ctx.pushMainCode(`; Reverb loop 2`);
        ctx.pushMainCode(`rda\t${d2.name}#,\t${one}\t; Get 2nd delay output`);
        ctx.pushMainCode(`mulx\t${KRTReg}\t\t; Apply reverb time`);
        ctx.pushMainCode(`rdfx\t${lp2Reg},\t${KRF}\t; Shelving lowpass`);
        ctx.pushMainCode(`wrlx\t${lp2Reg},\t${KRS}`);
        ctx.pushMainCode(`rda\t${lap2a.name}#,\t${KLAP}\t; Reverb allpass 2a`);
        ctx.pushMainCode(`wrap\t${lap2a.name},\t-${KLAP}`);
        ctx.pushMainCode(`rda\t${lap2b.name}#,\t${KLAP}\t; Reverb allpass 2b`);
        ctx.pushMainCode(`wrap\t${lap2b.name},\t-${KLAP}`);
        ctx.pushMainCode(`rdax\t${revinReg},\t${one}\t; Add filtered input`);
        ctx.pushMainCode(`wra\t${d1.name},\t${zero}\t; Put in 1st spring delay`);
        ctx.pushMainCode('');
        
        // Chirp filter (spectral delay for spring dispersion)
        ctx.pushMainCode(`; Chirp filter (spring dispersion)`);
        ctx.pushMainCode(`rdax\t${lp1Reg},\t${one}`);
        ctx.pushMainCode(`rdax\t${lp2Reg},\t${one}`);
        
        // Generate chirp allpass filters (adjustable count)
        for (let i = 0; i < chirpFilterCount; i++) {
            const ap = chirpAPs[i];
            ctx.pushMainCode(`rda\t${ap.name}#,\t${KAP}`);
            ctx.pushMainCode(`wrap\t${ap.name},\t-${KAP}`);
        }
        ctx.pushMainCode('');
        
        // Post-reverb tone shaping
        ctx.pushMainCode(`; Post-reverb tone shaping`);
        ctx.pushMainCode(`rdax\t${tempReg},\t${negOne}`);
        ctx.pushMainCode(`mulx\t${kfilReg}`);
        ctx.pushMainCode(`rdax\t${tempReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${tempReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${springReg},\t${zero}`);
        ctx.pushMainCode('');
        
        // Mix dry and wet signals with CV input or parameter
        ctx.pushMainCode(`; Mix dry and wet signals`);
        ctx.pushMainCode(`rdax\t${monoReg},\t${negOne}`);
        ctx.pushMainCode(`rdax\t${springReg},\t${one}`);
        if (mixCVReg) {
            ctx.pushMainCode(`mulx\t${mixCVReg}\t\t; Apply mix from CV input`);
        } else {
            ctx.pushMainCode(`sof\t${mix},\t${zero}\t; Apply mix from parameter`);
        }
        ctx.pushMainCode(`rdax\t${monoReg},\t${one}`);
        ctx.pushMainCode(`wrax\t${outputReg},\t${zero}`);
        ctx.pushMainCode('');
        
        // LFO modulation for smoothing
        ctx.pushMainCode(`; Smooth reverb with LFO modulation`);
        ctx.pushMainCode(`cho\tRDA,\tSIN0,\tSIN|REG|COMPC,\t${lap1b.name}+25`);
        ctx.pushMainCode(`cho\tRDA,\tSIN0,\tSIN,\t${lap1b.name}+26`);
        ctx.pushMainCode(`wra\t${lap1b.name}+50,\t${zero}`);
        ctx.pushMainCode(`cho\tRDA,\tSIN0,\tCOS|REG|COMPC,\t${lap2b.name}+25`);
        ctx.pushMainCode(`cho\tRDA,\tSIN0,\tCOS,\t${lap2b.name}+26`);
        ctx.pushMainCode(`wra\t${lap2b.name}+50,\t${zero}`);
        ctx.pushMainCode('');
    }
}
