/**
 * Sin/Cos LFO Block
 * 
 * Generates sine and cosine LFO outputs using the FV-1's built-in LFO oscillators.
 * Supports dynamic rate and width control inputs, or fixed parameters.
 * Can output either -1.0 to 1.0 or 0.0 to 1.0 range.
 * 
 * Based on SpinCAD SinCosLFOACADBlock
 * 
 * Translation Notes:
 * - Uses WLDS instruction to initialize LFO (in init code)
 * - Uses CHO RDAL to read LFO values (SIN=0/1, COS=8/9)
 * - Rate: 0-511 (internal) maps to Hz
 * - Width: 0-32767 (amplitude)
 * - LFO selection: 0 (SIN0/COS0) or 1 (SIN1/COS1)
 * - Dynamic rate control writes to SIN0_RATE or SIN1_RATE
 * - Dynamic width control writes to SIN0_RANGE or SIN1_RANGE
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class SinCosLFOBlock extends BaseBlock {
    readonly type = 'control.sincos_lfo';
    readonly category = 'Control';
    readonly name = 'Sin/Cos LFO';
    readonly description = 'Sine and cosine LFO generator with adjustable rate and width';
    readonly color = '#f2b824';
    readonly width = 180;

    constructor() {
        super();

        this._inputs = [
            { id: 'speed', name: 'Speed', type: 'control' },
            { id: 'width', name: 'Width', type: 'control' }
        ];

        this._outputs = [
            { id: 'sine', name: 'Sine', type: 'control' },
            { id: 'cosine', name: 'Cosine', type: 'control' }
        ];

        this._parameters = [
            {
                id: 'lfoSel',
                name: 'LFO',
                type: 'select',
                default: 0,
                options: [
                    { value: 0, label: 'LFO 0' },
                    { value: 1, label: 'LFO 1' }
                ],
                description: 'Which LFO oscillator to use (0 or 1)'
            },
            {
                id: 'lfoRate',
                name: 'LFO Rate',
                type: 'number',
                default: 20,
                min: 0,
                max: 511,
                displayMin: 0.0,
                displayMax: this.lfoRateToHz(511),
                displayUnit: 'Hz',
                toDisplay: (rate: number) => this.lfoRateToHz(rate),
                fromDisplay: (hz: number) => this.hzToLfoRate(hz),
                description: 'LFO rate (frequency)'
            },
            {
                id: 'lfoWidth',
                name: 'LFO Width',
                type: 'number',
                default: 8192,
                min: 0,
                max: 32767,
                description: 'LFO amplitude/width'
            },
            {
                id: 'outputRange',
                name: 'Output Range',
                type: 'select',
                default: 0,
                options: [
                    { value: 0, label: '-1.0 to 1.0' },
                    { value: 1, label: '0.0 to 1.0' }
                ],
                description: 'Output signal range'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const zero = this.formatS1_14(0.0);

        // Get parameters
        const lfoSel = this.getParameterValue(ctx, this.type, 'lfoSel', 0) as number;
        const lfoRate = this.getParameterValue(ctx, this.type, 'lfoRate', 20) as number;
        const lfoWidth = this.getParameterValue(ctx, this.type, 'lfoWidth', 8192) as number;
        const outputRange = this.getParameterValue(ctx, this.type, 'outputRange', 0) as number;

        // LFO register names based on selection
        const sinRateReg = lfoSel === 0 ? 'SIN0_RATE' : 'SIN1_RATE';
        const sinRangeReg = lfoSel === 0 ? 'SIN0_RANGE' : 'SIN1_RANGE';
        const sinLfoIndex = 0 + lfoSel;  // 0 or 1
        const cosLfoIndex = 8 + lfoSel;  // 8 or 9

        ctx.pushMainCode(`; ${this.name} (LFO ${lfoSel})`);

        // Initialize LFO (once at startup)
        ctx.pushInitCode(`; ${this.name} - Initialize LFO ${lfoSel}`);
        ctx.pushInitCode(`skp run, lfo${lfoSel}_init`);
        ctx.pushInitCode(`wlds ${lfoSel === 0 ? 'SIN0' : 'SIN1'}, ${lfoRate}, ${lfoWidth}`);
        ctx.pushInitCode(`lfo${lfoSel}_init:`);

        // Dynamic speed control (if connected)
        const speedReg = ctx.getInputRegister(this.type, 'speed');
        if (speedReg) {
            ctx.pushMainCode(`; Update LFO rate dynamically`);
            ctx.pushMainCode(`rdax ${speedReg}, ${this.formatS1_14(lfoRate / 511.0)}`);
            ctx.pushMainCode(`wrax ${sinRateReg}, ${zero}`);
        }

        // Dynamic width control (if connected)
        const widthReg = ctx.getInputRegister(this.type, 'width');
        if (widthReg) {
            ctx.pushMainCode(`; Update LFO width dynamically`);
            ctx.pushMainCode(`rdax ${widthReg}, ${this.formatS1_14(lfoWidth / 32767.0)}`);
            ctx.pushMainCode(`wrax ${sinRangeReg}, ${zero}`);
        }

        // Output sine wave (if connected)
        if (ctx.isOutputConnected(this.type, 'sine')) {
            const sineReg = ctx.allocateRegister(this.type, 'sine');
            ctx.pushMainCode(`; Read sine LFO value`);
            ctx.pushMainCode(`cho rdal, ${lfoSel === 0 ? 'SIN0' : 'SIN1'}`);
            if (outputRange === 1) {
                // Scale from -1..1 to 0..1
                ctx.pushMainCode(`sof ${this.formatS1_14(0.5)}, ${this.formatS1_14(0.5)}`);
            }
            ctx.pushMainCode(`wrax ${sineReg}, ${zero}`);
        }

        // Output cosine wave (if connected)
        if (ctx.isOutputConnected(this.type, 'cosine')) {
            const cosineReg = ctx.allocateRegister(this.type, 'cosine');
            ctx.pushMainCode(`; Read cosine LFO value`);
            ctx.pushMainCode(`cho rdal, ${lfoSel === 0 ? 'COS0' : 'COS1'}`);
            if (outputRange === 1) {
                // Scale from -1..1 to 0..1
                ctx.pushMainCode(`sof ${this.formatS1_14(0.5)}, ${this.formatS1_14(0.5)}`);
            }
            ctx.pushMainCode(`wrax ${cosineReg}, ${zero}`);
        }

        ctx.pushMainCode('');
    }
}
