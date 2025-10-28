/**
 * Potentiometer Input block
 * Reads potentiometer control values (POT0, POT1, or POT2)
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class PotBlock extends BaseBlock {
    readonly type = 'input.pot';
    readonly category = 'Input';
    readonly name = 'Potentiometer';
    readonly description = 'Read potentiometer control value (POT0, POT1, or POT2)';
    readonly color = '#4CAF50';
    readonly width = 150;
    
    constructor() {
        super();
        
        this._inputs = [];
        
        this._outputs = [
            { id: 'out', name: 'Control', type: 'control' }
        ];
        
        this._parameters = [
            {
                id: 'potNumber',
                name: 'Pot Number',
                type: 'select',
                default: 0,
                options: [
                    { label: 'POT0', value: 0 },
                    { label: 'POT1', value: 1 },
                    { label: 'POT2', value: 2 }
                ],
                description: 'Which potentiometer to read'
            },
            {
                id: 'speedup',
                name: 'Enable Speedup Filter',
                type: 'boolean',
                default: true,
                description: 'Apply high-shelf filter to improve pot response time (recommended)'
            },
            {
                id: 'invert',
                name: 'Invert',
                type: 'boolean',
                default: false,
                description: 'Invert the pot value (1.0 - value)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    getEquDeclarations(ctx: CodeGenContext): string[] {
        const equs: string[] = [];
        
        // Register filter constants as EQUs if not already registered
        if (!ctx.hasEqu('kpotflt')) {
            ctx.registerEqu('kpotflt', '0.001');
            ctx.registerEqu('kpothx', '-0.75');
            ctx.registerEqu('kpotmix', '0.75');
        }
        
        return equs;
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const potNumber = this.getParameterValue<number>(ctx, this.type, 'potNumber', 0);
        const speedup = this.getParameterValue<boolean>(ctx, this.type, 'speedup', true);
        const invert = this.getParameterValue<boolean>(ctx, this.type, 'invert', false);
        
        const potName = `POT${potNumber}`;
        const one = ctx.getStandardConstant(1.0);
        const negOne = ctx.getStandardConstant(-1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // Check if we should preserve accumulator for next block
        const preserveAcc = ctx.shouldPreserveAccumulator(this.type, 'out');
        const clearValue = preserveAcc ? one : zero;
        
        code.push(`; Potentiometer ${potNumber}`);
        
        if (speedup) {
            // Apply high-shelf filter for faster pot response
            // This filter compensates for the slow POT register updates (every 32 samples)
            // by boosting high frequencies (changes), making the pot feel more responsive
            
            const filterReg = ctx.getScratchRegister();  // Stores filtered value
            const fastpotReg = outputReg;                // Reuse output register
            
            code.push(`; POT speedup: high-shelf filter boosts changes for faster response`);
            code.push(`rdax ${potName}, ${one}              ; Read pot value`);
            code.push(`rdfx ${filterReg}, kpotflt          ; High-pass: isolate changes (coefficient=0.001)`);
            code.push(`wrhx ${filterReg}, kpothx           ; High-shelf: attenuate lows by 0.25x (coef=-0.75)`);
            code.push(`rdax ${fastpotReg}, kpotmix         ; Add 0.75x of previous output`);
            
            if (invert) {
                code.push(`sof ${negOne}, ${one}            ; Invert (1.0 - value)`);
            }
            
            code.push(`wrax ${fastpotReg}, ${clearValue}   ; Store and optionally keep in ACC`);
        } else {
            // Direct pot reading without filtering
            code.push(`; POT direct read (no speedup filter)`);
            code.push(`rdax ${potName}, ${one}              ; Read pot value`);
            
            if (invert) {
                code.push(`sof ${negOne}, ${one}            ; Invert (1.0 - value)`);
            }
            
            code.push(`wrax ${outputReg}, ${clearValue}     ; Store and optionally keep in ACC`);
        }
        
        code.push('');
        
        return code;
    }
}
