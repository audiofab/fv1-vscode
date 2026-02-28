/**
 * Java Batch Convert SpinCAD Blocks to .ATL
 * Parses Java source files and generates ATL block definitions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseMenu } from './parse-spincad-menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const spinCADSourceDir = path.resolve(__dirname, '../SpinCAD-Designer/src/com/holycityaudio/SpinCAD');
const targetDir = path.resolve(__dirname, 'resources/blocks/spincad/auto');
const menuFile = path.resolve(__dirname, '../SpinCAD-Designer/src/SpinCADBuilder/standard.spincadmenu');

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

console.log(`Loading menu from ${menuFile}...`);
const menuMap = parseMenu(menuFile);

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

function parseJavaBlock(content, filename, menuInfo) {
    const typeId = filename.replace('.java', '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const definition = {
        type: typeId,
        category: menuInfo.category || 'SpinCAD',
        subcategory: menuInfo.subcategory || '',
        name: menuInfo.displayName || filename.replace('.java', ''),
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

    // Parse constructor fields looking for parameters
    // E.g. int stages = 4; -> map to parameter
    const fieldMatchRegex = /(?:public|private|protected)?\s*(int|double|float|boolean)\s+([a-zA-Z0-9_]+)(?:\s*=\s*(.*?))?;/g;
    let fieldMatch;
    const knownParams = new Set();
    while ((fieldMatch = fieldMatchRegex.exec(content)) !== null) {
        const type = fieldMatch[1];
        const name = fieldMatch[2];
        const defaultVal = fieldMatch[3] ? fieldMatch[3].trim() : '0';
        if (name === 'SerialVersionUID' || name === 'serialVersionUID') continue;
        if (['temp', 'temp1', 'temp2'].includes(name)) continue;

        // This is a rough heuristic to detect parameters like 'stages', 'controlMode'
        if (name !== 'x' && name !== 'y') {
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
                } else if (vName !== 'hasControlPanel' && !['temp'].includes(vName)) {
                    // Add if looks like param
                    if (/^\d+$/.test(vVal)) {
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

    // Extract generateCode body
    const genCodeRegex = /public\s+void\s+generateCode\s*\(\s*SpinFXBlock\s+sfxb\s*\)\s*\{/;
    const genCodeMatch = content.match(genCodeRegex);

    if (genCodeMatch) {
        let body = extractBraceBlock(content, genCodeMatch.index);

        // Inline helper methods
        // Heuristic: look for methods taking SpinFXBlock
        const helperMethodRegex = /private\s+void\s+([a-zA-Z0-9_]+)\s*\(\s*SpinFXBlock\s+([a-zA-Z0-9_]+)\s*,([^)]*)\)\s*\{/g;
        let helperMatch;
        const helpers = {};
        while ((helperMatch = helperMethodRegex.exec(content)) !== null) {
            const mName = helperMatch[1];
            const sfxbParam = helperMatch[2];
            const otherArgs = helperMatch[3].split(',').map(s => s.trim().split(/\s+/).pop()); // extract param names
            const hBody = extractBraceBlock(content, helperMatch.index);
            helpers[mName] = { sfxbParam, otherArgs, body: hBody };
        }

        // Replace helper method calls in generateCode
        // E.g. PhaseShiftStage(sfxb, p2, 1);
        for (const [hName, hData] of Object.entries(helpers)) {
            const callRegex = new RegExp(`${hName}\\s*\\(\\s*sfxb\\s*,([^)]+)\\)\\s*;`, 'g');
            body = body.replace(callRegex, (m, argStr) => {
                const callArgs = argStr.split(',').map(s => s.trim());
                let inlined = hData.body;
                // Replace method local arguments with call args
                hData.otherArgs.forEach((argName, idx) => {
                    if (argName) {
                        // regex word boundary replacement
                        inlined = inlined.replace(new RegExp(`\\b${argName}\\b`, 'g'), callArgs[idx]);
                    }
                });
                // Replace internal sfxb param if different
                if (hData.sfxbParam !== 'sfxb') {
                    inlined = inlined.replace(new RegExp(`\\b${hData.sfxbParam}\\b`, 'g'), 'sfxb');
                }
                return inlined;
            });
        }

        // Now process body
        const lines = body.split('\n');
        const templateLines = [];
        const managedRegs = [];
        const managedMemo = [];
        const varSnapshots = [];

        templateLines.push(`@section header`);
        templateLines.push(`@comment "Generated from spincad source file ${filename}"`);
        templateLines.push(`\n@section main`);

        let currentVarMap = {};

        // Unroll conditions roughly: if(stages > 1) -> @if ${stages} > 1
        let insideIf = false;

        // Track variables line by line
        for (let i = 0; i < lines.length; i++) {
            let trimmed = lines[i].trim();

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

            const pinMatch = trimmed.match(/(?:(?:int|SpinCADPin)\s+)?([a-zA-Z0-9_]+)\s*=\s*(?:this\.)?getPin\("([^"]+)"\)/);
            if (pinMatch) {
                const varName = pinMatch[1];
                const pinLabel = pinMatch[2];
                const pin = definition.inputs.find(i => i.name === pinLabel) || definition.outputs.find(o => o.name === pinLabel);
                if (pin) {
                    const prefix = definition.inputs.some(i => i.id === pin.id) ? 'input' : 'output';
                    currentVarMap[varName] = `\${${prefix}.${pin.id}}`;
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
                if (!managedRegs.includes(varName)) managedRegs.push(varName);
                currentVarMap[varName] = `\${reg.${varName}}`;
            }

            const fieldMatch = trimmed.match(/(?:(?:double|int)\s+)?([a-zA-Z0-9_]+)\s*=\s*([^;]+)/);
            if (fieldMatch) {
                const varName = fieldMatch[1];
                const val = fieldMatch[2].trim();
                if (/^[0-9.-]+(\/[0-9.-]+)?$/.test(val)) {
                    currentVarMap[varName] = val;
                }
            }

            // Check if it's a method call we know how to map
            const resolve = (val) => {
                val = (val || '').trim();
                // if it's a function call passing getControlReg(1), resolve that too
                if (val.startsWith('getControlReg')) {
                    return `\${controlMode}`;
                }
                return currentVarMap[val] || val;
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
            } else if (trimmed.includes('sfxb.loadSinLFO')) {
                const m = trimmed.match(/sfxb\.loadSinLFO\(([^)]+)\)/);
                if (m) {
                    const parts = m[1].split(',');
                    if (parts.length >= 3) {
                        templateLines.push(`wlds\tSIN0_RATE,\t${resolve(parts[1])},\t${resolve(parts[2])}`);
                    }
                }
            } else if (trimmed.includes('sfxb.writeAllpass')) {
                const m = trimmed.match(/sfxb\.writeAllpass\(([^,]+),\s*([^)]+)\)/);
                if (m) templateLines.push(`wra\t${resolve(m[1])},\t${resolve(m[2])}`); // simplistic aliasing
            } else if (trimmed.includes('sfxb.chorusReadValue')) {
                const m = trimmed.match(/sfxb\.chorusReadValue\(([^)]+)\)/);
                if (m) templateLines.push(`cho\trdal,\t${resolve(m[1])}`);
            }
        }

        if (managedRegs.length > 0) definition.registers = managedRegs;
        if (managedMemo.length > 0) definition.memo = managedMemo;

        definition.template = templateLines.join('\n');
    }

    return definition;
}

function toATL(definition) {
    const metadata = { ...definition };
    const template = metadata.template;
    delete metadata.template;
    return `---\n${JSON.stringify(metadata, null, 2)}\n---\n${template}`;
}

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
            const basename = file.replace('CADBlock.java', '').toLowerCase();
            if (!menuMap.has(basename)) {
                continue;
            }
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
