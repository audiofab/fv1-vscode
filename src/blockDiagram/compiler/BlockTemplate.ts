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
        const memory = this.resolveMemory(block, ctx);

        const templateLines = this.definition.template.split('\n');
        // Pre-process lines to remove comments and empty lines, and trim
        const processedLines = templateLines.map(line => line.trim()).filter(line => line && !line.startsWith(';'));

        let currentSection: IRSection = 'main';
        // This will be reset later
        // Initial pass: find section boundaries and parse EQU declarations
        for (const line of processedLines) {
            if (line.startsWith('@section')) {
                currentSection = line.substring(8).trim() as IRSection;
                continue;
            }
            // Parse EQU declarations in header and store as variables
            if (currentSection === 'header') {
                const parts = line.split(/[,\s\t]+/);
                if (parts[0].toLowerCase() === 'equ') {
                    let name = parts[1];
                    const value = parts[2];
                    if (name && value) {
                        // If name is a token, resolve it (e.g. ${local.X} -> blockId_X)
                        if (name.startsWith('${') && name.endsWith('}')) {
                            const key = name.substring(2, name.length - 1);
                            if (key.startsWith('local.')) {
                                name = `${ctx.getShortId(block.id)}_${key.split('.')[1]}`;
                            } else {
                                name = key;
                            }
                        }
                        ctx.setVariable(name, value);
                    }
                }
            }
        }

        // Reset for main pass
        currentSection = 'main';
        const sectionStack: { condition: boolean; skip: boolean; hasElse: boolean }[] = [];

        for (let line of processedLines) {
            // line is already trimmed and filtered, so no need for:
            // line = line.trim();
            // if (!line || line.startsWith(';')) continue;

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

            const trimmed = line.trim().toLowerCase();
            const isEqu = trimmed.startsWith('equ');
            const firstTokenIndex = line.indexOf('${');

            const processedLine = line.replace(/\$\{([^}]+)\}/g, (match, key, offset) => {
                if (key.startsWith('param.')) return params[key.split('.')[1]]?.toString() || '';
                if (key.startsWith('input.')) return inputs[key.split('.')[1]] || '';
                if (key.startsWith('output.')) return outputs[key.split('.')[1]] || '';
                if (key.startsWith('reg.')) return internalRegs[key.split('.')[1]] || '';
                if (key.startsWith('mem.')) return memory[key.split('.')[1]] || '';
                if (key.startsWith('local.')) {
                    const shortId = ctx.getShortId(block.id);
                    const varName = `${shortId}_${key.split('.')[1]}`;

                    // If this is the definition part of an EQU line, return the name only
                    if (isEqu && offset === firstTokenIndex) {
                        return varName;
                    }

                    const val = ctx.getVariable(varName);
                    return val !== undefined ? val : varName;
                }
                // Check direct parameter names
                if (params[key] !== undefined) return params[key].toString();
                // Check dynamic variables set by macros
                const v = ctx.getVariable(key);
                if (v !== undefined) return v;
                // Check if it's a raw local name that was already expanded
                const localV = ctx.getVariable(`${block.id}_${key}`);
                if (localV !== undefined) return localV;
                return ''; // Empty if not found
            });

            // Split into code and comment (support both ; and //)
            let commentIndex = processedLine.indexOf(';');
            const doubleSlashIndex = processedLine.indexOf('//');
            let commentMarkerLen = 1;

            if (doubleSlashIndex !== -1 && (commentIndex === -1 || doubleSlashIndex < commentIndex)) {
                commentIndex = doubleSlashIndex;
                commentMarkerLen = 2;
            }

            let codePart = processedLine;
            let comment: string | undefined = undefined;

            if (commentIndex !== -1) {
                codePart = processedLine.substring(0, commentIndex).trim();
                comment = processedLine.substring(commentIndex + commentMarkerLen).trim();
            }

            // Handle Standard Macros
            if (codePart.startsWith('@')) {
                this.expandMacro(codePart, currentSection, ir, ctx, block);
                continue;
            }

            // Parse assembly-like line to IR
            const firstSpaceIndex = codePart.indexOf(' ');
            const firstTabIndex = codePart.indexOf('\t');
            let splitIndex = -1;
            if (firstSpaceIndex !== -1 && firstTabIndex !== -1) splitIndex = Math.min(firstSpaceIndex, firstTabIndex);
            else if (firstSpaceIndex !== -1) splitIndex = firstSpaceIndex;
            else if (firstTabIndex !== -1) splitIndex = firstTabIndex;

            if (splitIndex !== -1) {
                const op = codePart.substring(0, splitIndex).trim().toUpperCase();
                const argsPart = codePart.substring(splitIndex).trim();
                const args = argsPart.split(',').map(a => a.trim()).filter(a => a.length > 0);

                ir.push({
                    op,
                    args,
                    section: currentSection,
                    comment
                });
            } else if (codePart.length > 0) {
                // Opcode only
                ir.push({
                    op: codePart.toUpperCase(),
                    args: [],
                    section: currentSection,
                    comment
                });
            } else if (comment) {
                // Just a comment line
                ir.push({ op: ';', args: [comment], section: currentSection });
            }
        }

        return ir;
    }

    /**
     * Resolve a label template for the UI
     */
    resolveLabel(parameters: Record<string, any>, ctx?: CodeGenContext, blockId?: string): string | null {
        const template = (this.definition as any).labelTemplate;
        if (!template) return null;

        const params = this.evaluateParametersFromMap(parameters, ctx, true);

        // Prepare evaluation context
        const evalCtx: any = {
            param: params,
            inputConnected: {} as Record<string, boolean>
        };

        if (ctx && blockId) {
            for (const input of this.definition.inputs) {
                // If we have a context, we can check if the input is connected
                try {
                    evalCtx.inputConnected[input.id] = (ctx as any).getInputRegister(blockId, input.id) !== undefined;
                } catch (e) {
                    evalCtx.inputConnected[input.id] = false;
                }
            }
        }

        return template.replace(/\$\{([^}]+)\}/g, (match: string, expr: string) => {
            try {
                // Safely-ish evaluate the expression using the provided context
                const f = new Function('param', 'inputConnected', `return (${expr});`);
                const result = f(evalCtx.param, evalCtx.inputConnected);
                return result !== undefined && result !== null ? result.toString() : '';
            } catch (e) {
                console.warn(`Failed to evaluate label expression: ${expr}`, e);
                return match;
            }
        });
    }

    private resolveValue(v: string, block: Block, ctx: CodeGenContext): any {
        if (v === 'true') return true;
        if (v === 'false') return false;

        // 1. Check parameters
        const params = this.evaluateParameters(block, ctx);
        if (params[v] !== undefined) return params[v];

        // 2. Check local variables (namespaced by block short ID)
        const shortId = ctx.getShortId(block.id);
        const localV = ctx.getVariable(`${shortId}_${v}`);
        if (localV !== undefined) {
            const f = parseFloat(localV);
            return isNaN(f) ? localV : f;
        }

        // 3. Check direct context variables
        const directV = ctx.getVariable(v);
        if (directV !== undefined) {
            const f = parseFloat(directV);
            return isNaN(f) ? directV : f;
        }

        // 4. Try as decimal
        const f = parseFloat(v);
        if (!isNaN(f)) return f;

        return v;
    }

    private evaluateCondition(condition: string, block: Block, ctx: CodeGenContext): boolean {
        // Example: pinConnected(freq_ctrl)
        const pinMatch = condition.match(/pinConnected\(([^)]+)\)/);
        if (pinMatch) {
            const pinId = pinMatch[1].trim();
            return ctx.getInputRegister(block.id, pinId) !== undefined;
        }

        // Handle SpinCAD macros used as conditions
        const parts = condition.split(/\s+/);
        const macro = parts[0].toLowerCase();

        if (macro === 'isgreaterthan') {
            return this.resolveValue(parts[1], block, ctx) > this.resolveValue(parts[2], block, ctx);
        }
        if (macro === 'isequalto') {
            return this.resolveValue(parts[1], block, ctx) === this.resolveValue(parts[2], block, ctx);
        }
        if (macro === 'isor') {
            const v1 = this.resolveValue(parts[1], block, ctx);
            const v2 = this.resolveValue(parts[2], block, ctx);
            const expected = this.resolveValue(parts[3], block, ctx);
            return v1 === expected || v2 === expected;
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
                const shortId = (ctx as any).getShortId(block.id);
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
                if (args.length >= 4 && args[3]) {
                    // Control input provided - ignore static freq parameter
                    ir.push({ op: 'RDAX', args: [args[1], '1.0'], section });
                    ir.push({ op: 'RDAX', args: [args[0], '-1.0'], section });
                    ir.push({ op: 'MULX', args: [args[3]], section });
                    ir.push({ op: 'RDAX', args: [args[0], '1.0'], section });
                } else {
                    // Static frequency
                    ir.push({ op: 'RDAX', args: [args[1], '1.0'], section });
                    ir.push({ op: 'RDFX', args: [args[0], args[2]], section });
                }
                ir.push({ op: 'WRAX', args: [args[0], '0.0'], section });
                break;
            case 'hpf1p':
                // @hpf1p result, input, freq, state [, ctrl]
                if (args.length >= 5 && args[4]) {
                    // Control input provided - ignore static freq parameter
                    ir.push({ op: 'RDAX', args: [args[1], '1.0'], section });
                    ir.push({ op: 'RDAX', args: [args[3], '-1.0'], section });
                    ir.push({ op: 'MULX', args: [args[4]], section });
                    ir.push({ op: 'RDAX', args: [args[3], '1.0'], section });
                } else {
                    // Static frequency
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
            case 'multiplydouble':
                // @multiplyDouble result, a, b
                const mulA = this.resolveValue(args[1], block, ctx);
                const mulB = this.resolveValue(args[2], block, ctx);
                const mulVal = (typeof mulA === 'number' ? mulA : 0) * (typeof mulB === 'number' ? mulB : 0);
                ctx.setVariable(args[0], mulVal.toString());
                break;
            case 'dividedouble':
                // @divideDouble result, a, b
                const divA = this.resolveValue(args[1], block, ctx);
                const divB = this.resolveValue(args[2], block, ctx);
                const divVal = (typeof divA === 'number' ? divA : 0) / (typeof divB === 'number' ? divB : 1);
                ctx.setVariable(args[0], divVal.toString());
                break;
            case 'isgreaterthan':
                // @isGreaterThan a, b
                if (parseFloat(args[0]) > parseFloat(args[1])) {
                    // This is tricky because @isGreaterThan is usually followed by @endif
                    // but it's handled by the parent line-by-line processor for @if.
                    // Actually, SpinCAD uses it like an @if.
                    // We should probably have handled this in generateIR's loop.
                }
                break;
            case 'isequaltobool':
            case 'equalsbool':
                // @equalsBool var, val
                ctx.setVariable(args[0], args[1]);
                break;
            case 'readchorustap':
                // @readChorusTap lfoSel flags center length offset
                const lfoIdx = args[0] === '0' ? 'SIN0' : 'SIN1';
                const tapFlags = args[1] === '0' ? 'REG|COMPC' : args[1]; // simplified
                const tapMemo = args[4]; // assuming memory ID
                ir.push({ op: 'CHO', args: ['RDA', lfoIdx, tapFlags, tapMemo], section });
                ir.push({ op: 'CHO', args: ['RDA', lfoIdx, '0', `${tapMemo}+1`], section });
                break;
            case 'getbaseaddress':
                // usually a no-op in our managed system
                break;
            case 'gain':
                // @gain result, input, gain
                ir.push({ op: 'RDAX', args: [args[1], args[2]], section });
                break;
            case 'comment':
                // @comment text
                const text = args.join(' ');
                ir.push({ op: ';', args: [text], section: 'init' });
                break;
        }
    }

    private evaluateParameters(block: Block, ctx: CodeGenContext): Record<string, any> {
        return this.evaluateParametersFromMap(block.parameters, ctx);
    }

    private evaluateParametersFromMap(parameters: Record<string, any>, ctx?: CodeGenContext, skipConversion: boolean = false): Record<string, any> {
        const evaluated: Record<string, any> = {};
        for (const param of this.definition.parameters) {
            let val = parameters[param.id] ?? param.default;

            // Apply modern conversions
            if (param.conversion && ctx && !skipConversion) {
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
        if (this.definition.registers) {
            for (const regId of this.definition.registers) {
                resolved[regId] = ctx.allocateRegister(block.id, `local_${regId}`);
            }
        }
        return resolved;
    }

    private resolveMemory(block: Block, ctx: CodeGenContext): Record<string, string> {
        const resolved: Record<string, string> = {};
        if (this.definition.memo) {
            const params = this.evaluateParameters(block, ctx);
            for (const mem of this.definition.memo) {
                let size = 0;
                if (typeof mem.size === 'string') {
                    size = params[mem.size] || 1; // Default to 1 if not found
                } else {
                    size = mem.size;
                }
                const alloc = ctx.allocateMemory(mem.id, size);
                resolved[mem.id] = alloc.name;
            }
        }
        return resolved;
    }
}
