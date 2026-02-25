/**
 * BlockTemplate Engine
 * Processes declarative block definitions and emits IR nodes.
 */

import { BlockTemplateDefinition, IRNode, IRSection } from '../types/IR.js';
import { CodeGenContext, Block } from '../types/Block.js';

export class BlockTemplate {
    private definition: BlockTemplateDefinition;

    constructor(definition: BlockTemplateDefinition) {
        this.definition = definition;
    }

    /**
     * Generate IR nodes for a specific block instance
     */
    generateIR(block: Block, ctx: CodeGenContext): IRNode[] {
        const ir: IRNode[] = [];
        const params = this.evaluateParameters(block, ctx);
        const inputs = this.resolveInputs(block, ctx);
        const outputs = this.resolveOutputs(block, ctx);
        const internalRegs = this.resolveInternalRegisters(block, ctx);

        const templateLines = this.definition.template.split('\n');
        let currentSection: IRSection = 'main';
        const sectionStack: { condition: boolean; skip: boolean; hasElse: boolean }[] = [];

        for (let line of templateLines) {
            line = line.trim();
            if (!line || line.startsWith(';')) continue;

            // Handle section directives
            if (line.startsWith('@section')) {
                const section = line.split(' ')[1] as IRSection;
                if (['init', 'input', 'main', 'output'].includes(section)) {
                    currentSection = section;
                }
                continue;
            }

            // Handle @if/@else/@endif
            if (line.startsWith('@if')) {
                const condition = this.evaluateCondition(line.substring(3).trim(), block, ctx);
                const parentSkip = sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].skip : false;
                sectionStack.push({
                    condition,
                    skip: parentSkip || !condition,
                    hasElse: false
                });
                continue;
            }

            if (line.startsWith('@else')) {
                if (sectionStack.length > 0) {
                    const top = sectionStack[sectionStack.length - 1];
                    const parentSkip = sectionStack.length > 2 ? sectionStack[sectionStack.length - 2].skip : false;
                    top.skip = parentSkip || top.condition; // Skip else if condition was true
                    top.hasElse = true;
                }
                continue;
            }

            if (line.startsWith('@endif')) {
                sectionStack.pop();
                continue;
            }

            // Skip if in a false conditional branch
            if (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].skip) {
                continue;
            }

            // Simple variable substitution
            const processedLine = line.replace(/\$\{([^}]+)\}/g, (match, key) => {
                if (key.startsWith('param.')) return params[key.split('.')[1]]?.toString() || match;
                if (key.startsWith('input.')) return inputs[key.split('.')[1]] || match;
                if (key.startsWith('output.')) return outputs[key.split('.')[1]] || match;
                if (key.startsWith('reg.')) return internalRegs[key.split('.')[1]] || match;
                return match;
            });

            // Handle Standard Macros
            if (processedLine.startsWith('@')) {
                this.expandMacro(processedLine, currentSection, ir, ctx, block);
                continue;
            }

            // Parse assembly-like line to IR
            const parts = processedLine.split(/[,\s]+/).filter(p => p.length > 0);
            if (parts.length > 0) {
                ir.push({
                    op: parts[0].toUpperCase(),
                    args: parts.slice(1),
                    section: currentSection
                });
            }
        }

        return ir;
    }

    private evaluateCondition(condition: string, block: Block, ctx: CodeGenContext): boolean {
        // Example: pinConnected(freq_ctrl)
        const pinMatch = condition.match(/pinConnected\(([^)]+)\)/);
        if (pinMatch) {
            const pinId = pinMatch[1].trim();
            return ctx.getInputRegister(block.id, pinId) !== undefined;
        }

        // Example: my_param == 1 or my_param != 'foo'
        const eqMatch = condition.match(/([^=!]+)\s*(==|!=)\s*(.+)/);
        if (eqMatch) {
            const varName = eqMatch[1].trim();
            const op = eqMatch[2];
            const value = eqMatch[3].trim().replace(/['"]/g, '');
            const currentVal = block.parameters[varName] ?? this.definition.parameters.find(p => p.id === varName)?.default;

            const isMatch = currentVal?.toString() === value;
            return op === '==' ? isMatch : !isMatch;
        }

        return false;
    }

    private expandMacro(line: string, section: IRSection, ir: IRNode[], ctx: CodeGenContext, block: Block) {
        const parts = line.substring(1).split(/[,\s]+/).filter(p => p.length > 0);
        const macro = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (macro) {
            case 'lfo':
                // @lfo result, type, rate, range
                const lfoResult = args[0];
                const lfoType = args[1].toUpperCase();
                const lfoRate = args[2];
                const lfoRange = args[3];

                // Add initialization to init section (uniquely named based on short ID)
                const shortId = ctx.getShortId(block.id);
                const doneLabel = `lfo_done_${shortId}`;
                ir.push({ op: 'SKP', args: ['RUN', doneLabel], section: 'init' });
                ir.push({ op: 'WLDS', args: [lfoType, lfoRate, lfoRange], section: 'init' });
                ir.push({ op: `${doneLabel}:`, args: [], section: 'init' });

                // Read value in current section (usually main)
                ir.push({ op: 'CHO', args: ['RDAL', lfoType], section });
                ir.push({ op: 'WRAX', args: [lfoResult, '0.0'], section });
                break;
            case 'lpf1p':
                // @lpf1p result, input, freq [, ctrl]
                if (args.length >= 4) {
                    ir.push({ op: 'RDAX', args: [args[1], args[2]], section });
                    ir.push({ op: 'RDAX', args: [args[0], `-${args[2]}`], section });
                    ir.push({ op: 'MULX', args: [args[3]], section });
                    ir.push({ op: 'RDAX', args: [args[0], '1.0'], section });
                } else {
                    ir.push({ op: 'RDAX', args: [args[1], '1.0'], section });
                    ir.push({ op: 'RDFX', args: [args[0], args[2]], section });
                }
                ir.push({ op: 'WRAX', args: [args[0], '0.0'], section });
                break;
            case 'hpf1p':
                // @hpf1p result, input, freq, state [, ctrl]
                if (args.length >= 5) {
                    ir.push({ op: 'RDAX', args: [args[1], args[2]], section });
                    ir.push({ op: 'RDAX', args: [args[3], `-${args[2]}`], section });
                    ir.push({ op: 'MULX', args: [args[4]], section });
                    ir.push({ op: 'RDAX', args: [args[3], '1.0'], section });
                } else {
                    ir.push({ op: 'RDAX', args: [args[1], '1.0'], section });
                    ir.push({ op: 'RDFX', args: [args[3], args[2]], section });
                }
                ir.push({ op: 'WRAX', args: [args[3], '-1.0'], section });
                ir.push({ op: 'RDAX', args: [args[1], '1.0'], section });
                ir.push({ op: 'WRAX', args: [args[0], '0.0'], section });
                break;
            case 'smooth':
                // @smooth result, input, coeff
                ir.push({ op: 'RDAX', args: [args[1], '1.0'], section });
                ir.push({ op: 'RDFX', args: [args[0], args[2]], section });
                ir.push({ op: 'WRAX', args: [args[0], '0.0'], section });
                break;
            case 'speedup':
                // @speedup result, input, lp_coeff, hp_coeff, state_reg
                ir.push({ op: 'RDAX', args: [args[1], '1.0'], section });
                ir.push({ op: 'RDFX', args: [args[4], args[2]], section });
                ir.push({ op: 'WRHX', args: [args[4], args[3]], section });
                ir.push({ op: 'WRAX', args: [args[0], '0.0'], section });
                break;
            case 'gain':
                // @gain result, input, gain
                ir.push({ op: 'RDAX', args: [args[1], args[2]], section });
                break;
        }
    }

    private evaluateParameters(block: Block, ctx: CodeGenContext): Record<string, any> {
        const evaluated: Record<string, any> = {};
        for (const param of this.definition.parameters) {
            let val = block.parameters[param.id] ?? param.default;

            // Apply modern conversions
            if (param.conversion) {
                val = this.applyConversion(param.conversion, val, ctx);
            }

            evaluated[param.id] = val;
        }
        return evaluated;
    }

    private applyConversion(type: string, val: any, ctx: CodeGenContext): any {
        const Fs = 32768; // Default, should be pulled from context if dynamic
        switch (type) {
            case 'LOGFREQ':
                return (1.0 - Math.exp(-2.0 * Math.PI * val / Fs)).toFixed(6);
            case 'SINLFOFREQ':
                return Math.round(val * (1 << 18) / Fs);
            case 'DBLEVEL':
                return Math.pow(10.0, val / 20.0).toFixed(6);
            case 'LENGTHTOTIME':
                return Math.round((val / 1000) * Fs);
            default:
                return typeof val === 'number' ? val.toFixed(6) : val;
        }
    }

    private resolveInputs(block: Block, ctx: CodeGenContext): Record<string, string> {
        const resolved: Record<string, string> = {};
        for (const input of this.definition.inputs) {
            const reg = ctx.getInputRegister(block.id, input.id);
            if (reg) resolved[input.id] = reg;
        }
        return resolved;
    }

    private resolveOutputs(block: Block, ctx: CodeGenContext): Record<string, string> {
        const resolved: Record<string, string> = {};
        for (const output of this.definition.outputs) {
            const reg = ctx.allocateRegister(block.id, output.id);
            resolved[output.id] = reg;
        }
        return resolved;
    }

    private resolveInternalRegisters(block: Block, ctx: CodeGenContext): Record<string, string> {
        const resolved: Record<string, string> = {};
        if ((this.definition as any).registers) {
            for (const regId of (this.definition as any).registers) {
                resolved[regId] = ctx.allocateRegister(block.id, `internal_${regId}`);
            }
        }
        return resolved;
    }
}
