/**
 * Java Batch Convert SpinCAD Blocks to .ATL
 * Parses Java source files and generates ATL block definitions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseMenu } from './parse-spincad-menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths relative to the fv1-vscode root
const spincadDesignerDir = path.resolve(__dirname, '../../SpinCAD-Designer');
const spinCADSourceDir = path.join(spincadDesignerDir, 'src/com/holycityaudio/SpinCAD');
const defaultTargetDir = path.resolve(__dirname, '../../fv1-core/blocks/spincad');
const menuFile = path.join(spincadDesignerDir, 'src/SpinCADBuilder/standard.spincadmenu');

const targetDir = process.argv[2] || defaultTargetDir;

const colorMap = {
    'Color.PINK': '#ffc0cb',
    'Color.PINK.darker()': '#ffb6c1',
    'Color.YELLOW': '#ffff00',
    'Color.orange': '#ffa500',
    'Color.ORANGE': '#ffa500',
    'Color.GREEN': '#00ff00',
    'Color.BLUE': '#0000ff',
    'Color.cyan': '#00ffff',
    'Color.CYAN': '#00ffff',
    'Color.magenta': '#ff00ff',
    'Color.MAGENTA': '#ff00ff',
    'Color.white': '#ffffff',
    'Color.WHITE': '#ffffff',
    'Color.gray': '#808080',
    'Color.GRAY': '#808080',
    'Color.black': '#000000',
    'Color.BLACK': '#000000',
    'Color.red': '#ff0000',
    'Color.RED': '#ff0000',
};

// Extract a brace-enclosed block safely
function extractBraceBlock(content, startIndex) {
    let braceCount = 0;
    let i = startIndex;
    while (i < content.length && content[i] !== '{') i++;
    if (i >= content.length) return null;

    let start = i;
    braceCount = 1;
    i++;

    while (i < content.length && braceCount > 0) {
        if (content[i] === '{') braceCount++;
        else if (content[i] === '}') braceCount--;
        i++;
    }
    return content.substring(start + 1, i - 1); // Returns contents inside {}
}

export function parseJavaBlock(content, filename, menuInfo) {
    const typeId = 'spincad_' + filename.replace('.java', '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const definition = {
        type: typeId,
        category: menuInfo ? (menuInfo.category || 'SpinCAD') : 'SpinCAD',
        subcategory: menuInfo ? (menuInfo.subcategory || '') : '',
        name: (menuInfo && menuInfo.displayName) ? menuInfo.displayName : filename.replace('.java', ''),
        description: '',
        inputs: [],
        outputs: [],
        parameters: [],
        template: ''
    };

    // Extract color
    const colorMatch = content.match(/setBorderColor\(([^)]+)\)/);
    if (colorMatch) {
        const colorVal = colorMatch[1].trim();
        definition.color = colorMap[colorVal] || '#cccccc';
    }

    // Parse fields looking for parameters, but try to avoid local variables in methods
    // Heuristic: only look for fields declared before the first method
    const firstMethodIndex = content.search(/\w+\s+\w+\s*\([^)]*\)\s*\{/);
    const header = firstMethodIndex !== -1 ? content.substring(0, firstMethodIndex) : content;

    const fieldMatchRegex = /(?:public|private|protected)?\s*(int|double|float|boolean)\s+([a-zA-Z0-9_]+)(?:\s*=\s*(.*?))?;/g;
    let fieldMatch;
    const knownParams = new Set();
    while ((fieldMatch = fieldMatchRegex.exec(header)) !== null) {
        const type = fieldMatch[1];
        const name = fieldMatch[2];
        const defaultVal = fieldMatch[3] ? fieldMatch[3].trim() : '0';
        if (name === 'SerialVersionUID' || name === 'serialVersionUID') continue;
        if (['temp', 'temp1', 'temp2', 'x', 'y'].includes(name)) continue;

        if (!knownParams.has(name)) {
            definition.parameters.push({
                id: name,
                name: name,
                type: 'number',
                default: parseFloat(defaultVal) || 0,
                min: 0,
                max: 10
            });
            knownParams.add(name);
        }
    }

    // Ensure parameters assigned in constructor are parsed
    const constructorMatch = content.match(new RegExp(`public\\s+${filename.replace('.java', '')}\\([^)]*\\)\\s*\\{`));
    if (constructorMatch) {
        const cBody = extractBraceBlock(content, constructorMatch.index);
        if (cBody) {
            const assignRegex = /([a-zA-Z0-9_]+)\s*=\s*([^;]+);/g;
            let am;
            while ((am = assignRegex.exec(cBody)) !== null) {
                const vName = am[1];
                const vVal = am[2].trim();
                const existing = definition.parameters.find(p => p.id === vName);
                if (existing) {
                    existing.default = parseFloat(vVal) || 0;
                } else if (vName !== 'hasControlPanel' && !['temp', 'x', 'y'].includes(vName)) {
                    if (/^\d+(\.\d+)?$/.test(vVal) && !knownParams.has(vName)) {
                        definition.parameters.push({
                            id: vName,
                            name: vName,
                            type: 'number',
                            default: parseFloat(vVal),
                            min: 0, max: 10
                        });
                        knownParams.add(vName);
                    }
                }
            }
        }
    }

    // Extract pins
    const pinRegex = /add(Control)?(Input|Output)Pin\((?:this(?:\s*,\s*)?)?("([^"]+)")?\)/g;
    let match;
    const pinCounts = { audioInput: 0, audioOutput: 0, controlInput: 0, controlOutput: 0 };

    while ((match = pinRegex.exec(content)) !== null) {
        const isControl = match[1] === 'Control';
        const isInput = match[2] === 'Input';
        const type = isControl ? 'control' : 'audio';
        let label = match[4];

        const category = (isControl ? 'control' : 'audio') + match[2];
        pinCounts[category]++;

        if (!label) {
            if (isInput) {
                label = isControl ? `Control Input ${pinCounts[category]}` : `Audio Input ${pinCounts[category]}`;
            } else {
                label = isControl ? `Control Output ${pinCounts[category]}` : `Audio Output ${pinCounts[category]}`;
            }
        }

        const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const name = label;

        if (isInput) {
            definition.inputs.push({ id, name, type });
        } else {
            definition.outputs.push({ id, name, type });
        }
    }

    // Extract setCoefficients body if exists to find more variables
    const setCoeffRegex = /public\s+void\s+setCoefficients\s*\(\s*\)\s*\{/;
    const setCoeffMatch = content.match(setCoeffRegex);
    let extraVars = {};
    if (setCoeffMatch) {
        const coeffBody = extractBraceBlock(content, setCoeffMatch.index);
        if (coeffBody) {
            const assignRegex = /([a-zA-Z0-9_]+)\s*=\s*([^;]+);/g;
            let am;
            while ((am = assignRegex.exec(coeffBody)) !== null) {
                const vName = am[1];
                let vVal = am[2].trim();
                // Basic math evaluation for constants
                vVal = vVal.replace(/Math\.PI/g, '3.14159');
                vVal = vVal.replace(/getSamplerate\(\)/g, '32768');
                if (/^[0-9.+\-*/() ]+$/.test(vVal)) {
                    try { extraVars[vName] = eval(vVal); } catch (e) { }
                } else {
                    extraVars[vName] = vVal;
                }
            }
        }
    }

    // Extract generateCode body
    const genCodeRegex = /public\s+void\s+generateCode\s*\(\s*SpinFXBlock\s+sfxb\s*\)\s*\{/;
    const genCodeMatch = content.match(genCodeRegex);

    if (genCodeMatch) {
        let body = extractBraceBlock(content, genCodeMatch.index);

        const helperMethodRegex = /private\s+void\s+([a-zA-Z0-9_]+)\s*\(\s*SpinFXBlock\s+([a-zA-Z0-9_]+)\s*,([^)]*)\)\s*\{/g;
        let helperMatch;
        const helpers = {};
        while ((helperMatch = helperMethodRegex.exec(content)) !== null) {
            const mName = helperMatch[1];
            const sfxbParam = helperMatch[2];
            const otherArgs = helperMatch[3].split(',').map(s => s.trim().split(/\s+/).pop());
            const hBody = extractBraceBlock(content, helperMatch.index);
            helpers[mName] = { sfxbParam, otherArgs, body: hBody };
        }

        for (const [hName, hData] of Object.entries(helpers)) {
            const callRegex = new RegExp(`${hName}\\s*\\(\\s*sfxb\\s*,([^)]+)\\)\\s*;`, 'g');
            body = body.replace(callRegex, (m, argStr) => {
                const callArgs = argStr.split(',').map(s => s.trim());
                let inlined = hData.body;
                hData.otherArgs.forEach((argName, idx) => {
                    if (argName) {
                        inlined = inlined.replace(new RegExp(`\\b${argName}\\b`, 'g'), callArgs[idx]);
                    }
                });
                if (hData.sfxbParam !== 'sfxb') {
                    inlined = inlined.replace(new RegExp(`\\b${hData.sfxbParam}\\b`, 'g'), 'sfxb');
                }
                return inlined;
            });
        }

        const lines = body.split('\n');
        const templateLines = [];
        const managedRegs = [];
        const managedMemo = [];

        templateLines.push(`@section header`);
        templateLines.push(`@comment "Generated from spincad source file ${filename}"`);
        templateLines.push(`\n@section main`);

        let currentVarMap = { ...extraVars };
        for (const [k, v] of Object.entries(currentVarMap)) {
            if (typeof v === 'number') currentVarMap[k] = { id: k, template: v.toString() };
            else currentVarMap[k] = { id: k, template: v };
        }

        // Pre-pass: Find all setRegister calls to alias internal allocations directly to output pins BEFORE processing write instructions
        for (let i = 0; i < lines.length; i++) {
            const passTrimmed = lines[i].trim();
            const setRegMatch = passTrimmed.match(/(?:this\.)?getPin\("([^"]+)"\)\.setRegister\(([a-zA-Z0-9_]+)\)/);
            if (setRegMatch) {
                const pinLabel = setRegMatch[1];
                const varName = setRegMatch[2];
                const pinOutput = definition.outputs.find(o => o.name === pinLabel);
                if (pinOutput) {
                    currentVarMap[varName] = { id: pinOutput.id, template: `\${output.${pinOutput.id}}` };
                }
            }
        }

        let insideIf = false;

        for (let i = 0; i < lines.length; i++) {
            let trimmed = lines[i].trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('System.out')) continue;

            const ifMatch = trimmed.match(/if\s*\(([^)]+)\)\s*\{?/);
            if (ifMatch) {
                const cond = ifMatch[1];
                let atlCond = cond;
                knownParams.forEach(p => {
                    atlCond = atlCond.replace(new RegExp(`\\b${p}\\b`, 'g'), `\${${p}}`);
                });
                templateLines.push(`@if ${atlCond}`);
                insideIf = true;
                continue;
            }
            if (insideIf && trimmed === '}') {
                templateLines.push(`@endif`);
                insideIf = false;
                continue;
            }

            // Scan for local variables in generateCode that refer to pins
            const localRegMatches = content.matchAll(/int\s+([a-zA-Z0-9_]+)\s*=\s*(?:sfxb\.)?getPin\("([^"]+)"\)\.getPinConnection\(\)\.getRegister\(\);/g);
            for (const m of localRegMatches) {
                const varName = m[1];
                const pinName = m[2];
                const pin = definition.inputs.find(i => i.name === pinName) || definition.outputs.find(o => o.name === pinName);
                if (pin) {
                    const prefix = pin.type === 'audio' ? (definition.inputs.some(i => i.id === pin.id) ? 'input' : 'output') : 'input';
                    currentVarMap[varName] = { id: varName, template: `\${${prefix}.${pin.id}}` };
                }
            }

            // Handle common inherited fields/constants
            extraVars['INPUT'] = '${input.audio_input}';
            extraVars['CONTROLNUM'] = '${controlMode}';
            extraVars['SCALE'] = '${scale}';
            extraVars['OFFSET'] = '${offset}';
            extraVars['DEFTIME'] = '${defTime}';
            extraVars['MAXTIME'] = '${maxTime}';
            extraVars['COUNT'] = '${count}';
            extraVars['RAMPRATE'] = '${rampRate}';
            extraVars['DECAYCOEFF'] = '${decayCoeff}';

            // Chained pin resolve: int input = this.getPin(...).getPinConnection().getRegister();
            const chainedPinMatch = trimmed.match(/(?:(?:int|SpinCADPin)\s+)?([a-zA-Z0-9_]+)\s*=\s*(?:this\.)?getPin\("([^"]+)"\)\.?.*getRegister\(\)/);
            if (chainedPinMatch) {
                const varName = chainedPinMatch[1];
                const pinLabel = chainedPinMatch[2];
                const pin = definition.inputs.find(i => i.name === pinLabel) || definition.outputs.find(o => o.name === pinLabel);
                if (pin) {
                    const prefix = definition.inputs.some(i => i.id === pin.id) ? 'input' : 'output';
                    currentVarMap[varName] = { id: pin.id, template: `\${${prefix}.${pin.id}}` };
                }
                continue;
            }

            const pinMatch = trimmed.match(/(?:(?:int|SpinCADPin)\s+)?([a-zA-Z0-9_]+)\s*=\s*(?:this\.)?getPin\("([^"]+)"\)/);
            if (pinMatch) {
                const varName = pinMatch[1];
                const pinLabel = pinMatch[2];
                const pin = definition.inputs.find(i => i.name === pinLabel) || definition.outputs.find(o => o.name === pinLabel);
                if (pin) {
                    const prefix = definition.inputs.some(i => i.id === pin.id) ? 'input' : 'output';
                    currentVarMap[varName] = { id: pin.id, template: `\${${prefix}.${pin.id}}` };
                }
            }

            const isConnectedMatch = trimmed.match(/([a-zA-Z0-9_]+)\.isConnected\(\)/);
            if (isConnectedMatch) {
                const varName = isConnectedMatch[1];
                if (currentVarMap[varName] && currentVarMap[varName].id) {
                    if (templateLines.length > 0 && templateLines[templateLines.length - 1].startsWith('@if')) {
                        templateLines[templateLines.length - 1] = `@if pinConnected(${currentVarMap[varName].id})`;
                    }
                }
            }

            const indirectMatch = trimmed.match(/([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\.getRegister\(\)/);
            if (indirectMatch) {
                const targetVar = indirectMatch[1];
                const sourceVar = indirectMatch[2];
                if (currentVarMap[sourceVar]) {
                    currentVarMap[targetVar] = currentVarMap[sourceVar];
                }
            }

            const regAssignMatch = trimmed.match(/(?:int\s+)?([a-zA-Z0-9_]+)\s*=\s*sfxb\.allocateReg\(\)/);
            if (regAssignMatch) {
                const varName = regAssignMatch[1];
                // Only allocate if it wasn't pre-aliased as an output pin
                if (!currentVarMap[varName] || !currentVarMap[varName].template.startsWith('${output.')) {
                    if (!managedRegs.includes(varName)) managedRegs.push(varName);
                    currentVarMap[varName] = { id: varName, template: `\${reg.${varName}}` };
                }
            }

            const resolve = (val) => {
                val = (val || '').trim();
                if (val.startsWith('getControlReg')) return `\${controlMode}`;

                // Handle bitwise shifts in arguments like (crush << 1)
                const shiftMatch = val.match(/\(?([a-zA-Z0-9_]+)\s*(?:<<|>>|<|>)\s*([^)]+)\)?/);
                if (shiftMatch) {
                    const baseRaw = shiftMatch[1];
                    const shiftRaw = shiftMatch[2];

                    let baseVal = extraVars[baseRaw];
                    const hexMatch = baseRaw.match(/^-?0x([0-9A-F]+)L?/i);
                    if (baseVal === undefined && hexMatch) baseVal = parseInt(hexMatch[1], 16);
                    if (baseVal === undefined && /^-?\d+/.test(baseRaw)) baseVal = parseInt(baseRaw, 10);

                    let shiftVal = extraVars[shiftRaw];
                    if (shiftVal === undefined && /^-?\d+/.test(shiftRaw)) shiftVal = parseInt(shiftRaw, 10);

                    if (typeof baseVal === 'number' && typeof shiftVal === 'number') {
                        const result = (val.includes('<<') || val.includes('<')) ? (baseVal << shiftVal) : (baseVal >>> shiftVal);
                        return '0x' + (result >>> 0).toString(16).toUpperCase();
                    }

                    // Fallback to assembler syntax (using single < for shift)
                    const op = (val.includes('<<') || val.includes('<')) ? '<' : '>';
                    return `(${resolve(baseRaw)} ${op} ${resolve(shiftRaw)})`;
                }

                // Handle Math.sin, Math.PI, etc.
                if (val.includes('Math.') || val.includes('PI')) {
                    let evaluatable = val.replace(/Math\.PI/g, '3.14159').replace(/\bPI\b/g, '3.14159');
                    evaluatable = evaluatable.replace(/getSamplerate\(\)/g, '32768');

                    // Try to resolve parameters to numbers for evaluation
                    let fullyNumeric = evaluatable.replace(/([a-zA-Z0-9_]+)/g, (m) => {
                        if (extraVars[m] !== undefined && typeof extraVars[m] === 'number') return extraVars[m].toString();
                        if (knownParams.has(m)) {
                            const p = definition.parameters.find(p => p.id === m);
                            return p ? p.default.toString() : '0.5';
                        }
                        if (/^\d/.test(m)) return m;
                        return m;
                    });

                    if (/^[0-9.+\-*/() Math.sin]+$/.test(fullyNumeric)) {
                        try {
                            const res = new Function('return ' + fullyNumeric.replace(/Math\./g, 'Math.'))();
                            if (typeof res === 'number') return res.toFixed(6);
                        } catch (e) { }
                    }
                }

                // Handle basic math expressions in arguments
                if (val.includes('/') || val.includes('*') || val.includes('+') || val.includes('-')) {
                    let atlExpr = val.replace(/([a-zA-Z0-9_]+)/g, (m) => {
                        if (extraVars[m] !== undefined && typeof extraVars[m] === 'number') return extraVars[m].toString();
                        if (knownParams.has(m)) return `\${${m}}`;
                        if (/^\d/.test(m)) return m;

                        // Check for common constants mapped to pins
                        const pinMatch = definition.inputs.find(i => i.id.toLowerCase() === m.toLowerCase()) ||
                            definition.outputs.find(o => o.id.toLowerCase() === m.toLowerCase());
                        if (pinMatch) {
                            const prefix = definition.inputs.includes(pinMatch) ? 'input' : 'output';
                            return `\${${prefix}.${pinMatch.id}}`;
                        }

                        return m;
                    });

                    let evaluatable = atlExpr.replace(/\$\{([^}]+)\}/g, '0.5');
                    if (/^[0-9.+\-*/() ]+$/.test(evaluatable)) {
                        if (atlExpr.includes('${')) return atlExpr;
                        try { return eval(atlExpr).toString(); } catch (e) { }
                    }
                    return atlExpr;
                }

                const mapped = currentVarMap[val];
                if (mapped) return mapped.template;

                if (knownParams.has(val)) return `\${${val}}`;
                if (/^-?\d+(\.\d+)?$/.test(val)) return val;
                if (/^0x[0-9A-F]+$/i.test(val)) return val;

                if (val.includes('.getRegister()')) {
                    const pinVar = val.split('.')[0];
                    if (currentVarMap[pinVar]) return currentVarMap[pinVar].template;
                }

                return val;
            };

            if (trimmed.includes('sfxb.comment')) {
                const m = trimmed.match(/sfxb\.comment\(([^)]+)\)/);
                if (m) templateLines.push(`; ${resolve(m[1]).replace(/"/g, '')}`);
            } else if (trimmed.includes('sfxb.readRegister')) {
                const m = trimmed.match(/sfxb\.readRegister\(([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`rdax\t${resolve(m[1])},\t${resolve(m[2])}`);
            } else if (trimmed.includes('sfxb.writeRegister')) {
                const m = trimmed.match(/sfxb\.writeRegister\(([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`wrax\t${resolve(m[1])},\t${resolve(m[2])}`);
            } else if (trimmed.includes('sfxb.mulx')) {
                const m = trimmed.match(/sfxb\.mulx\(([^)]+)\)/);
                if (m) templateLines.push(`mulx\t${resolve(m[1])}`);
            } else if (trimmed.includes('sfxb.readDelay')) {
                const m = trimmed.match(/sfxb\.readDelay\(([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`rda\t${resolve(m[1])},\t${resolve(m[2])}`);
            } else if (trimmed.includes('sfxb.writeDelay')) {
                const m = trimmed.match(/sfxb\.writeDelay\(([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`wra\t${resolve(m[1])},\t${resolve(m[2])}`);
            } else if (trimmed.includes('sfxb.scaleOffset')) {
                const m = trimmed.match(/sfxb\.scaleOffset\(([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`sof\t${resolve(m[1])},\t${resolve(m[2])}`);
            } else if (trimmed.includes('sfxb.clear')) {
                templateLines.push(`clr`);
            } else if (trimmed.includes('sfxb.skip')) {
                const m = trimmed.match(/sfxb\.skip\(([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`skp\t${resolve(m[1])},\t${resolve(m[2])}`);
            } else if (trimmed.includes('sfxb.and')) {
                const m = trimmed.match(/sfxb\.and\(([^)]+)\)/);
                if (m) {
                    let arg = resolve(m[1]);
                    if (arg.startsWith('(') && arg.endsWith(')')) arg = arg.substring(1, arg.length - 1);
                    templateLines.push(`and\t${arg}`);
                }
            } else if (trimmed.includes('sfxb.or')) {
                const m = trimmed.match(/sfxb\.or\(([^)]+)\)/);
                if (m) {
                    let arg = resolve(m[1]);
                    if (arg.startsWith('(') && arg.endsWith(')')) arg = arg.substring(1, arg.length - 1);
                    templateLines.push(`or\t${arg}`);
                }
            } else if (trimmed.includes('sfxb.loadSinLFO')) {
                const m = trimmed.match(/sfxb\.loadSinLFO\(([^)]+)\)/);
                if (m) {
                    const parts = m[1].split(',');
                    const sel = resolve(parts[0]);
                    const rate = resolve(parts[1]);
                    const range = resolve(parts[2]);
                    const lfoPrefix = (sel === '1' || sel === 'SIN1') ? 'SIN1' : 'SIN0';
                    templateLines.push(`wlds\t${lfoPrefix}_RATE,\t${rate},\t${range}`);
                }
            } else if (trimmed.includes('sfxb.writeAllpass')) {
                const m = trimmed.match(/sfxb\.writeAllpass\(([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`wra\t${resolve(m[1])},\t${resolve(m[2])}`);
            } else if (trimmed.includes('sfxb.chorusReadValue')) {
                const m = trimmed.match(/sfxb\.chorusReadValue\(([^)]+)\)/);
                if (m) {
                    const val = resolve(m[1].trim());
                    if (val === '0' || val === 'SIN0') templateLines.push(`cho\trdal,\tSIN0`);
                    else if (val === '1' || val === 'SIN1') templateLines.push(`cho\trdal,\tSIN1`);
                    else if (val === '8' || val === 'COS0') templateLines.push(`cho\trdal,\tCOS0`);
                    else if (val === '9' || val === 'COS1') templateLines.push(`cho\trdal,\tCOS1`);
                    else if (val.includes('lfoSel')) {
                        templateLines.push(`@if \${lfoSel} == 0\ncho\trdal,\tSIN0\n@else\ncho\trdal,\tSIN1\n@endif`);
                    } else if ((val.includes('8') || val.includes('9')) && val.includes('lfoSel')) {
                        templateLines.push(`@if \${lfoSel} == 0\ncho\trdal,\tCOS0\n@else\ncho\trdal,\tCOS1\n@endif`);
                    } else {
                        templateLines.push(`cho\trdal,\t${val}`);
                    }
                }
            } else if (trimmed.includes('sfxb.FXallocDelayMem')) {
                const m = trimmed.match(/sfxb\.FXallocDelayMem\(([^,]+),\s*([^)]+)\)/);
                if (m) {
                    const memId = resolve(m[1]).replace(/"/g, '');
                    const sizeStr = resolve(m[2]);
                    const memSize = isNaN(Number(sizeStr)) ? sizeStr : parseInt(sizeStr);
                    managedMemo.push({ id: memId, size: memSize });
                }
            } else if (trimmed.includes('sfxb.FXreadDelay')) {
                const m = trimmed.match(/sfxb\.FXreadDelay\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`rda\t${resolve(m[1])},\t${resolve(m[3])}`);
            } else if (trimmed.includes('sfxb.FXwriteAllpass')) {
                const m = trimmed.match(/sfxb\.FXwriteAllpass\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`wra\t${resolve(m[1])},\t${resolve(m[3])}`);
            }
        }

        if (managedRegs.length > 0) definition.registers = managedRegs;
        if (managedMemo.length > 0) definition.memories = managedMemo;

        definition.template = templateLines.join('\n');
    }

    return definition;
}

export function toATL(definition) {
    const metadata = { ...definition };
    const template = metadata.template;
    delete metadata.template;
    return `---\n${JSON.stringify(metadata, null, 2)}\n---\n${template}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log(`Loading menu from ${menuFile}...`);
    const menuMap = parseMenu(menuFile);

    const scanDirs = [
        path.join(spinCADSourceDir, 'CADBlocks'),
        path.join(spinCADSourceDir, 'ControlBlocks')
    ];

    let totalCount = 0;
    for (const dir of scanDirs) {
        if (!fs.existsSync(dir)) continue;
        console.log(`Scanning ${dir}...`);
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (file.endsWith('Block.java') && !file.startsWith('SpinCAD')) {
                const basename = file.replace('CADBlock.java', '').replace('Block.java', '').toLowerCase();
                if (!menuMap.has(basename)) continue;
                const menuInfo = menuMap.get(basename);

                try {
                    const content = fs.readFileSync(path.join(dir, file), 'utf8');
                    const definition = parseJavaBlock(content, file, menuInfo);
                    const targetFile = path.join(targetDir, `${definition.type}.atl`);
                    fs.writeFileSync(targetFile, toATL(definition));
                    totalCount++;
                } catch (e) {
                    console.error(`Error converting ${file}: ${e}`);
                }
            }
        }
    }
    console.log(`Successfully converted ${totalCount} Java blocks to auto/ ATL format.`);
}
