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

        const templateLines = this.definition.template.split('\n');
        let currentSection: IRSection = 'main';

        for (let line of templateLines) {
            line = line.trim();
            if (!line || line.startsWith(';')) continue;

            // Handle section directives if any (extension to the format)
            if (line.startsWith('@section')) {
                const section = line.split(' ')[1] as IRSection;
                if (['init', 'input', 'main', 'output'].includes(section)) {
                    currentSection = section;
                }
                continue;
            }

            // Simple variable substitution
            const processedLine = line.replace(/\$\{([^}]+)\}/g, (match, key) => {
                if (key.startsWith('param.')) return params[key.split('.')[1]]?.toString() || match;
                if (key.startsWith('input.')) return inputs[key.split('.')[1]] || match;
                if (key.startsWith('output.')) return outputs[key.split('.')[1]] || match;
                return match;
            });

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
                return 1.0 - Math.exp(-2.0 * Math.PI * val / Fs);
            case 'SINLFOFREQ':
                return Math.round(val * 2 ** 17 / Fs * 2.0 * Math.PI);
            case 'DBLEVEL':
                return Math.pow(10.0, val / 20.0);
            case 'LENGTHTOTIME':
                return Math.round((val / 1000) * Fs);
            default:
                return val;
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
}
