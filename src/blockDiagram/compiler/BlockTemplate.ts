/**
 * BlockTemplate Engine
 * Processes declarative block definitions and emits IR nodes.
 */

import { BlockTemplateDefinition, IRNode, IRSection } from '../types/IR.js';
import { CodeGenContext, Block } from '../types/Block.js';
import { AlgebraicCompiler } from '../../assembler/AlgebraicCompiler.js';

export class BlockTemplate {
    private definition: BlockTemplateDefinition;
    private algebraicCompiler: AlgebraicCompiler;

    constructor(definition: BlockTemplateDefinition) {
        this.definition = definition;
        this.algebraicCompiler = new AlgebraicCompiler();
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
        // Pre-process lines to remove empty lines and trim
        const processedLines = templateLines.map(line => line.trim()).filter(line => line !== '');

        let currentSection: IRSection = 'main';
        // This will be reset later
        // Initial pass: find section boundaries and parse EQU declarations
        for (const line of processedLines) {
            if (line.startsWith('@section')) {
                currentSection = line.substring(8).trim() as IRSection;
                continue;
            }
            if (currentSection === 'header') {
                const parts = line.split(/[,\s\t]+/);
                if (parts[0].toLowerCase() === 'equ') {
                    let name = parts[1];
                    const value = parts.slice(2).join(' ');
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
                } else if (line.startsWith('@')) {
                    // Handle core macros that might define variables needed for memory sizing.
                    // Only process calculation/variable macros in the pre-pass.
                    const macro = line.substring(1).split(/[,\s]+/)[0].toLowerCase();
                    const calculationMacros = [
                        'equals', 'multiplydouble', 'multiplyint', 'dividedouble',
                        'plusdouble', 'minusdouble', 'equalsbool'
                    ];
                    if (calculationMacros.includes(macro)) {
                        // Pass a dummy IR array to avoid duplicate instructions during the pre-pass.
                        this.expandMacro(line, currentSection, [], ctx, block);
                    }
                }
            }
        }

        // Memory must be resolved AFTER the header pre-pass to allow constants/EQU/equals
        // defined in the header to be used for memory sizes.
        const memory = this.resolveMemoryObjects(block, ctx);

        // Reset for main pass
        currentSection = 'main';
        const sectionStack: { condition: boolean; skip: boolean; hasElse: boolean }[] = [];

        for (let line of processedLines) {
            // line is already trimmed and filtered, so no need for:
            // line = line.trim();
            // if (!line || line.startsWith(';')) continue;

            // Handle comments
            if (line.startsWith(';') || line.startsWith('//')) {
                if (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].skip) continue;

                // Normalize comment character to ; and strip it for the IR node
                const commentText = line.startsWith('//') ? line.substring(2) : line.substring(1);

                // Still process substitutions in comments
                const resolvedComment = this.performSubstitutions(commentText.trim(), params, inputs, outputs, internalRegs, memory, block, ctx);
                ir.push({ op: ';', args: [resolvedComment], section: currentSection });
                continue;
            }

            // Handle section directives
            if (line.startsWith('@section')) {
                const section = line.split(' ')[1] as IRSection;
                if (['header', 'init', 'input', 'main', 'output'].includes(section)) {
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
                    const parentSkip = sectionStack.length > 1 ? sectionStack[sectionStack.length - 2].skip : false;
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

            // Handle @assert directives
            if (line.startsWith('@assert')) {
                const assertContent = line.substring(7).trim();
                const commaIdx = assertContent.indexOf(',');

                if (commaIdx !== -1) {
                    const conditionStr = assertContent.substring(0, commaIdx).trim();
                    let messageStr = assertContent.substring(commaIdx + 1).trim();

                    // Allow parameter injections into the error message
                    messageStr = this.performSubstitutions(messageStr, params, inputs, outputs, internalRegs, memory, block, ctx);

                    if (messageStr.startsWith('"') && messageStr.endsWith('"')) {
                        messageStr = messageStr.substring(1, messageStr.length - 1);
                    } else if (messageStr.startsWith("'") && messageStr.endsWith("'")) {
                        messageStr = messageStr.substring(1, messageStr.length - 1);
                    }

                    if (!this.evaluateCondition(conditionStr, block, ctx)) {
                        ctx.addError(messageStr);
                    }
                } else {
                    ctx.addError(`Invalid @assert syntax. Expected: @assert condition, "message". Got: ${line}`);
                }
                continue;
            }

            const trimmed = line.trim().toLowerCase();
            const isEqu = trimmed.startsWith('equ');
            const firstTokenIndex = line.indexOf('${');

            const processedLine = this.performSubstitutions(line, params, inputs, outputs, internalRegs, memory, block, ctx);

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

            // Try compiling as algebraic statement first
            if (codePart.length > 0 && (codePart.includes('=') || codePart.includes('@acc') || codePart.includes('acc'))) {
                const isMemoryCheck = (id: string) => {
                    // Check if identifier is in memory objects or refers to delay RAM
                    if (memory[id] !== undefined) return true;
                    if (id.startsWith('mem.') || id.startsWith('MEM')) return true;
                    if (id.toLowerCase() === 'delayl' || id.toLowerCase() === 'delayr') return true;
                    return false;
                };

                const compiled = this.algebraicCompiler.compileLine(codePart, isMemoryCheck, (msg) => ctx.addError(msg));
                if (compiled) {
                    codePart = compiled; // Replace codePart with the standard FV-1 assembly
                }
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

                // Split by comma, but ignore commas inside parentheses
                const args: string[] = [];
                let currentArg = '';
                let parenLevel = 0;
                for (let i = 0; i < argsPart.length; i++) {
                    const char = argsPart[i];
                    if (char === '(') parenLevel++;
                    else if (char === ')') parenLevel--;
                    else if (char === ',' && parenLevel === 0) {
                        args.push(currentArg.trim());
                        currentArg = '';
                        continue;
                    }
                    currentArg += char;
                }
                if (currentArg.trim().length > 0) args.push(currentArg.trim());

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
        if (template === undefined) return null;

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
        // Pre-evaluate condition parameters by replacing ${...} macros BEFORE parsing the logic!
        const params = block.parameters;
        // Simple regex replace for right-hand side constants evaluated in conditionals 
        // Example: `@assert param.max > ${param.min}` -> `@assert param.max > 0.0`
        condition = condition.replace(/\$\{param\.([^}]+)\}/g, (match, paramName) => {
            const definedParam = this.definition.parameters?.find(p => p.id === paramName);
            return (params[paramName] ?? definedParam?.default)?.toString() || '0';
        });

        // Evaluate OR clauses
        const orClauses = condition.split('||');
        if (orClauses.length > 1) {
            return orClauses.some(clause => this.evaluateCondition(clause.trim(), block, ctx));
        }

        // Evaluate AND clauses
        const andClauses = condition.split('&&');
        if (andClauses.length > 1) {
            return andClauses.every(clause => this.evaluateCondition(clause.trim(), block, ctx));
        }

        // Example: pinConnected(freq_ctrl)
        const pinMatch = condition.match(/pinConnected\(([^)]+)\)/);
        if (pinMatch) {
            let rawPinName = pinMatch[1].trim();

            // Handle post-processed IDs like ${input.adcl} or ${output.output1}
            const wrapperMatch = rawPinName.match(/\$\{(?:input|output)\.([^}]+)\}/);
            if (wrapperMatch) {
                rawPinName = wrapperMatch[1];
            }

            // The template might contain the label or the id.
            // Try to find the exact pin by checking inputs and outputs matching this label/id.
            let pinId = rawPinName;
            const targetInput = this.definition.inputs.find(i => i.id === rawPinName || i.name === rawPinName);
            if (targetInput) pinId = targetInput.id;
            else {
                const targetOutput = this.definition.outputs.find(o => o.id === rawPinName || o.name === rawPinName);
                if (targetOutput) pinId = targetOutput.id;
            }

            // Check if the pin is connected as an input OR as an output
            return ctx.getInputRegister(block.id, pinId) !== null ||
                ctx.isOutputConnected(block.id, pinId);
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
        const eqMatch = condition.match(/([^=!<>]+)\s*(==|!=|>=|<=|>|<)\s*([^=!<>]+)/);
        if (eqMatch) {
            let varName = eqMatch[1].trim();
            if (varName.startsWith('${') && varName.endsWith('}')) {
                varName = varName.substring(2, varName.length - 1);
            }
            const op = eqMatch[2];
            const rhsRaw = eqMatch[3].trim().replace(/['"]/g, '');

            // resolveValue checks: block params → local ctx vars → direct ctx vars → numeric literal
            // This correctly handles macro-computed variables (e.g. from @minusDouble, @divideDouble)
            // that the old inline block.parameters-only lookup missed.
            const lhsResolved = this.resolveValue(varName, block, ctx);
            const rhsResolved = this.resolveValue(rhsRaw, block, ctx);
            const numLhs = typeof lhsResolved === 'number' ? lhsResolved : parseFloat(String(lhsResolved));
            const numRhs = typeof rhsResolved === 'number' ? rhsResolved : parseFloat(String(rhsResolved));

            // Numeric comparison when both sides parse as numbers
            if (!isNaN(numLhs) && !isNaN(numRhs)) {
                if (op === '==') return numLhs === numRhs;
                if (op === '!=') return numLhs !== numRhs;
                if (op === '>=') return numLhs >= numRhs;
                if (op === '<=') return numLhs <= numRhs;
                if (op === '>') return numLhs > numRhs;
                if (op === '<') return numLhs < numRhs;
            }

            // Fallback: strict string comparison (for enum/select params)
            const strLhs = String(lhsResolved);
            const strRhs = String(rhsResolved);
            if (op === '==') return strLhs === strRhs;
            if (op === '!=') return strLhs !== strRhs;
            return false;
        }

        return false;
    }

    private expandMacro(line: string, section: IRSection, ir: IRNode[], ctx: CodeGenContext, block: Block) {
        const parts = line.substring(1).split(/[,\s]+/).filter(p => p.length > 0);
        const macro = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (macro) {

            case 'equals': {
                const eqName = args[0];
                const eqNameIndex = line.indexOf(eqName);
                let expr = args[1];
                if (eqNameIndex !== -1) {
                    expr = line.substring(eqNameIndex + eqName.length).trim();
                } else {
                    expr = args.slice(1).join(' ');
                }
                const eqValue = this.resolveValue(expr, block, ctx);
                ctx.setVariable(eqName, eqValue.toString());
                break;
            }
            case 'multiplydouble':
            case 'multiplyint': {
                const mulA = this.resolveValue(args[1], block, ctx);
                const mulB = this.resolveValue(args[2], block, ctx);
                const mulVal = (typeof mulA === 'number' ? mulA : 0) * (typeof mulB === 'number' ? mulB : 0);
                ctx.setVariable(args[0], mulVal.toString());
                break;
            }
            case 'dividedouble': {
                const divA = this.resolveValue(args[1], block, ctx);
                const divB = this.resolveValue(args[2], block, ctx);
                const divVal = (typeof divA === 'number' ? divA : 0) / (typeof divB === 'number' ? divB : 1);
                ctx.setVariable(args[0], divVal.toString());
                break;
            }
            case 'plusdouble': {
                const pA = this.resolveValue(args[1], block, ctx);
                const pB = this.resolveValue(args[2], block, ctx);
                const pVal = (typeof pA === 'number' ? pA : 0) + (typeof pB === 'number' ? pB : 0);
                ctx.setVariable(args[0], pVal.toString());
                break;
            }
            case 'minusdouble': {
                const mA = this.resolveValue(args[1], block, ctx);
                const mB = this.resolveValue(args[2], block, ctx);
                const mVal = (typeof mA === 'number' ? mA : 0) - (typeof mB === 'number' ? mB : 0);
                ctx.setVariable(args[0], mVal.toString());
                break;
            }
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
            case 'cv': {
                // @cv portId
                // Reads a control input, using the port's associated parameter as the range/default.
                // - Unconnected: SOF 0.0, equName  → ACC = paramValue (constant)
                // - Connected:   CLR; SOF 0.0, equName; MULX reg  → ACC ∈ [0..paramValue]
                //   (CLR is omitted if the previous instruction already set ACC = 0)
                // - Connected + zero-bypassed: 5-instruction bypass adapted for range scaling.
                //   RDAX reads pot scaled by paramValue directly (no separate MULX needed).
                //   When pot < threshold: loads zeroValScaled (pot's zeroValue * paramValue).
                const portId = args[0];
                if (!portId) {
                    ctx.addError(`@cv requires a port ID argument`);
                    break;
                }

                // Get the associated parameter from the input definition
                const inputDef = this.definition.inputs.find(i => i.id === portId);
                const paramId = inputDef?.parameter;
                if (!paramId) {
                    ctx.addError(`@cv: input port '${portId}' has no 'parameter' field defined in the block JSON`);
                    break;
                }

                // Evaluate parameters (with conversions applied)
                const cvParams = this.evaluateParameters(block, ctx);
                const paramValue = cvParams[paramId];
                if (paramValue === undefined || paramValue === null) {
                    ctx.addError(`@cv: parameter '${paramId}' not found on block`);
                    break;
                }

                // EQU name for the range constant
                const shortId = ctx.getShortId(block.id);
                const equName = `cv_${shortId}_${portId}`;

                // Push EQU to IR header section only (idempotent), NOT to equDeclarations.
                // Using registerHeaderEqu avoids duplicating the EQU in the init/Constants block.
                if (!ctx.hasHeaderEqu(equName)) {
                    ctx.pushIR({ op: 'EQU', args: [equName, paramValue.toString()], section: 'header' });
                    ctx.registerHeaderEqu(equName);
                }

                const reg = ctx.getInputRegister(block.id, portId);
                const isZeroBypassed = ctx.isInputZeroBypassed(block.id, portId);

                if (reg) {
                    if (isZeroBypassed) {
                        // 5-instruction bypass block, adapted for range scaling.
                        // Key insight: RDAX reg, equName reads pot and scales by paramValue in one instruction,
                        // so the bypass fallback must also be pre-scaled: zeroVal * paramValue.
                        const zeroVal = ctx.getInputZeroValue(block.id, portId);
                        const zeroValScaled = zeroVal * parseFloat(paramValue.toString());
                        ir.push({ op: 'RDAX', args: [reg, equName], section, comment: `CV: ${paramId} * pot` });
                        ir.push({ op: 'SOF', args: ['1.0', '-0.02'], section, comment: 'Subtract bypass threshold' });
                        ir.push({ op: 'SKP', args: ['GEZ', '1'], section, comment: 'Skip if pot >= threshold' });
                        ir.push({ op: 'SOF', args: ['0.0', `${(zeroValScaled - (-0.02)).toFixed(6)}`], section, comment: `Zero fallback: ${zeroVal} * ${paramId}` });
                        ir.push({ op: 'SOF', args: ['1.0', '0.02'], section, comment: 'Re-add threshold' });
                    } else {
                        // Standard connected: CLR (if needed), load range, scale by pot.
                        // Check if ACC is already 0 from the previous instruction so we can skip the CLR.
                        const prevNode = [...ir].reverse().find(n => n.op !== ';');
                        const prevClearsAcc = prevNode && (
                            prevNode.op === 'CLR' ||
                            (prevNode.op === 'WRAX' && (prevNode.args[1] === '0.0' || prevNode.args[1] === '0' || parseFloat(prevNode.args[1]) === 0)) ||
                            (prevNode.op === 'WRA' && (prevNode.args[1] === '0.0' || prevNode.args[1] === '0' || parseFloat(prevNode.args[1]) === 0)) ||
                            (prevNode.op === 'WRHX' && (prevNode.args[1] === '0.0' || prevNode.args[1] === '0' || parseFloat(prevNode.args[1]) === 0))
                        );
                        if (!prevClearsAcc) {
                            ir.push({ op: 'CLR', args: [], section });
                        }
                        ir.push({ op: 'SOF', args: ['0.0', equName], section, comment: `CV range: ${paramId}` });
                        ir.push({ op: 'MULX', args: [reg], section });
                    }
                } else {
                    // Unconnected: use parameter value as a constant
                    ir.push({ op: 'SOF', args: ['0.0', equName], section, comment: `CV default: ${paramId}` });
                }
                break;
            }
            case 'mulcv': {
                // @mulcv portId
                // Scale the current ACC by the CV value without clearing first.
                // Assumes ACC already contains a signal to be modulated.
                // - Unconnected: SOF paramValue, 0.0  → ACC = ACC * paramValue  (1 instruction)
                // - Connected:   SOF paramValue, 0.0; MULX reg  → ACC = ACC * paramValue * pot  (2 instructions)
                // - Connected + zero-bypassed: same bypass pattern as @cv but applied to existing ACC
                const mulcvPortId = args[0];
                if (!mulcvPortId) {
                    ctx.addError(`@mulcv requires a port ID argument`);
                    break;
                }

                const mulcvInputDef = this.definition.inputs.find(i => i.id === mulcvPortId);
                const mulcvParamId = mulcvInputDef?.parameter;
                if (!mulcvParamId) {
                    ctx.addError(`@mulcv: input port '${mulcvPortId}' has no 'parameter' field defined in the block JSON`);
                    break;
                }

                const mulcvParams = this.evaluateParameters(block, ctx);
                const mulcvParamValue = mulcvParams[mulcvParamId];
                if (mulcvParamValue === undefined || mulcvParamValue === null) {
                    ctx.addError(`@mulcv: parameter '${mulcvParamId}' not found on block`);
                    break;
                }

                const mulcvShortId = ctx.getShortId(block.id);
                const mulcvEquName = `cv_${mulcvShortId}_${mulcvPortId}`;

                // Shared EQU registration with @cv (idempotent)
                if (!ctx.hasHeaderEqu(mulcvEquName)) {
                    ctx.pushIR({ op: 'EQU', args: [mulcvEquName, mulcvParamValue.toString()], section: 'header' });
                    ctx.registerHeaderEqu(mulcvEquName);
                }

                const mulcvReg = ctx.getInputRegister(block.id, mulcvPortId);
                const mulcvZeroBypassed = ctx.isInputZeroBypassed(block.id, mulcvPortId);

                if (mulcvReg) {
                    if (mulcvZeroBypassed) {
                        // Zero-bypass: we can't branch ACC to two paths without a temp register,
                        // but the bypass threshold approach still works — we write AC to a scratch,
                        // do the bypass check on the pot, then MULX both components.
                        // Actually: just apply the same RDAX-based bypass but we need ACC beforehand.
                        // Solution: save ACC to a local scratch, do bypass, MULX scratch.
                        const scratch = ctx.getScratchRegister();
                        const mulcvZeroVal = ctx.getInputZeroValue(block.id, mulcvPortId);
                        const mulcvZeroValScaled = mulcvZeroVal * parseFloat(mulcvParamValue.toString());
                        ir.push({ op: 'WRAX', args: [scratch, '0.0'], section, comment: 'Save ACC for @mulcv bypass' });
                        ir.push({ op: 'RDAX', args: [mulcvReg, mulcvEquName], section, comment: `@mulcv: ${mulcvParamId} * pot` });
                        ir.push({ op: 'SOF', args: ['1.0', '-0.02'], section, comment: 'Subtract bypass threshold' });
                        ir.push({ op: 'SKP', args: ['GEZ', '1'], section, comment: 'Skip if pot >= threshold' });
                        ir.push({ op: 'SOF', args: ['0.0', `${(mulcvZeroValScaled - (-0.02)).toFixed(6)}`], section, comment: `Zero fallback: ${mulcvZeroVal} * ${mulcvParamId}` });
                        ir.push({ op: 'SOF', args: ['1.0', '0.02'], section, comment: 'Re-add threshold' });
                        ir.push({ op: 'MULX', args: [scratch], section, comment: 'Scale saved signal by CV' });
                    } else {
                        // Connected: scale ACC by paramValue, then scale by pot
                        ir.push({ op: 'SOF', args: [mulcvEquName, '0.0'], section, comment: `@mulcv: scale by ${mulcvParamId}` });
                        ir.push({ op: 'MULX', args: [mulcvReg], section, comment: 'Scale by pot' });
                    }
                } else {
                    // Unconnected: scale ACC by the parameter constant
                    ir.push({ op: 'SOF', args: [mulcvEquName, '0.0'], section, comment: `@mulcv default: ${mulcvParamId}` });
                }
                break;
            }

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
            default:
                ctx.addError(`Unsupported directive or macro: @${macro}`);
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
            case 'SVFFREQ':
                // Returns sin(2 * pi * f / Fs), matching SpinCAD's base frequency coefficient
                return (Math.sin(2.0 * Math.PI * val / Fs)).toFixed(6);
            case 'SVF_DAMP':
                // Returns 1.0 / Q (Chamberlin damping d). Used for Min/Max bounds.
                return (1.0 / val).toFixed(6);
            case 'SINLFOFREQ':
            case 'HZ_TO_LFO_RATE':
                return Math.round((1 << 18) * Math.PI * val / Fs);
            case 'DBLEVEL':
                return Math.pow(10.0, val / 20.0).toFixed(6);
            case 'LENGTHTOTIME':
            case 'MS_TO_SAMPLES':
                return Math.round((val * Fs / 1000));
            case 'MS_TO_LFO_RANGE':
                return Math.round((val * Fs / 1000) * 32767 / 16385);
            case 'SEMITONES_TO_RATE':
                return ((Math.pow(2, val / 12) - 1.0) * 16384).toFixed(6);
            case 'HZ_TO_HILBERT_SHIFT':
                return (2 * Math.PI * val / Fs).toFixed(6);
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

    private resolveMemoryObjects(block: Block, ctx: CodeGenContext): Record<string, { name: string, size: number, address: number }> {
        const resolved: Record<string, { name: string, size: number, address: number }> = {};
        if (this.definition.memories) {
            const params = this.evaluateParameters(block, ctx);
            for (const mem of this.definition.memories) {
                let size: number = 0;
                if (typeof mem.size === 'string' || typeof mem.size === 'number') {
                    const sizeStr = mem.size.toString();
                    // If the size is a raw parameter name without interpolation (e.g. "preDelay" vs "${preDelay}"), wrap it natively.
                    // This handles old-style ATL blocks that define memory size as just the string identifier.
                    const evalStr = sizeStr.includes('${') ? sizeStr : /^[_a-zA-Z][_a-zA-Z0-9]*$/.test(sizeStr) ? `\${${sizeStr}}` : sizeStr;

                    // Substitute parameter variables first (e.g. "${delayLength} * 0.5")
                    const substitutedSizeExpr = this.performSubstitutions(evalStr, params, {}, {}, {}, {}, block, ctx);

                    if (substitutedSizeExpr.trim() === '') {
                        ctx.addError(`Memory size expression '${sizeStr}' evaluated to empty.`);
                        size = 1;
                    } else {
                        const evalResult = this.algebraicCompiler.evaluateConstantExpression(substitutedSizeExpr);
                        if (evalResult !== null) {
                            if (isNaN(evalResult) || evalResult < 0) {
                                ctx.addError(`Memory size expression '${sizeStr}' evaluated to invalid number: ${evalResult}`);
                                size = 1;
                            } else {
                                size = Math.round(evalResult);
                            }
                        } else {
                            size = parseInt(substitutedSizeExpr, 10);
                            if (isNaN(size) || size < 0) {
                                ctx.addError(`Memory size expression '${sizeStr}' could not be parsed as a valid size.`);
                                size = 1;
                            }
                        }
                    }
                } else {
                    size = mem.size as unknown as number;
                }
                const alloc = ctx.allocateMemory(mem.id, size);
                resolved[mem.id] = alloc;
            }
        }
        return resolved;
    }

    private performSubstitutions(
        line: string,
        params: Record<string, any>,
        inputs: Record<string, string>,
        outputs: Record<string, string>,
        internalRegs: Record<string, string>,
        memory: Record<string, { name: string, size: number, address: number }>,
        block: Block,
        ctx: CodeGenContext
    ): string {
        const trimmed = line.trim().toLowerCase();
        const isEqu = trimmed.startsWith('equ');
        const firstTokenIndex = line.indexOf('${');

        return line.replace(/\$\{([^}]+)\}/g, (match, key, offset) => {
            // Check for property modifiers like .max and .min
            const propMatch = key.match(/^(?:param\.)?([^.]+)\.(max|min)$/);
            if (propMatch) {
                const paramId = propMatch[1];
                const prop = propMatch[2];
                const paramDef = this.definition.parameters.find(p => p.id === paramId);
                if (paramDef) {
                    let val = prop === 'max' ? paramDef.max : paramDef.min;
                    if (val !== undefined) {
                        if (paramDef.conversion && ctx) {
                            val = this.applyConversion(paramDef.conversion, val, ctx);
                        }
                        return val.toString();
                    }
                }
            }

            if (key.startsWith('param.')) return params[key.split('.')[1]]?.toString() || '';
            if (key.startsWith('input.')) return inputs[key.split('.')[1]] || '';
            if (key.startsWith('output.')) return outputs[key.split('.')[1]] || '';
            if (key.startsWith('reg.')) return internalRegs[key.split('.')[1]] || '';
            if (key === 'Fs' || key === 'samplingRate') return '32768';
            if (key.startsWith('mem.')) {
                const parts = key.split('.');
                const memId = parts[1];
                const prop = parts[2];
                const alloc = memory[memId];
                if (!alloc) return '';

                if (!prop || prop === 'start') return alloc.name;
                if (prop === 'size') return alloc.size.toString();
                if (prop === 'end') return `(${alloc.name} + ${alloc.size} - 1)`;
                if (prop === 'middle') return `(${alloc.name} + ${alloc.size} / 2)`;
                return alloc.name;
            }
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

            return match;
        });
    }
}
