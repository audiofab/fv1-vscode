/**
 * Java Batch Convert SpinCAD Blocks to .ATL
 * Parses Java source files and generates ATL block definitions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const spinCADSourceDir = path.resolve(__dirname, '../SpinCAD-Designer/src/com/holycityaudio/SpinCAD');
const targetDir = path.resolve(__dirname, 'resources/blocks/spincad/manual');

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

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

function parseJavaBlock(content, filename) {
    const definition = {
        type: filename.replace('.java', '').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        category: 'SpinCAD',
        name: filename.replace('.java', ''),
        description: '',
        inputs: [],
        outputs: [],
        parameters: [],
        template: ''
    };

    // Extract name
    const nameMatch = content.match(/setName\("([^"]+)"\)/);
    if (nameMatch) {
        definition.name = nameMatch[1];
    }

    // Extract color
    const colorMatch = content.match(/setBorderColor\(([^)]+)\)/);
    if (colorMatch) {
        const colorVal = colorMatch[1].trim();
        definition.color = colorMap[colorVal] || '#cccccc';
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

        // SpinCAD default labels if not provided
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
    const genCodeMatch = content.match(/public void generateCode\(SpinFXBlock sfxb\)\s*\{([\s\S]*?)\n\s*\}/);
    if (genCodeMatch) {
        let body = genCodeMatch[1];

        const lines = body.split('\n');
        const templateLines = [];
        const managedRegs = [];
        const managedMemo = [];
        const varSnapshots = []; // List of { lineIndex, varMap } to handle reassignments

        templateLines.push(`@section header`);
        templateLines.push(`@comment "Generated from spincad source file ${filename}"`);
        templateLines.push(`\n@section main`);

        let currentVarMap = {};

        // Track variables line by line
        for (let i = 0; i < lines.length; i++) {
            let trimmed = lines[i].trim();

            // Track pin assignments/reassignments: p = this.getPin("Pin Name")
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

            // Track indirect assignments: leftIn = p.getRegister(); where p is already mapped
            const indirectMatch = trimmed.match(/([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\.getRegister\(\)/);
            if (indirectMatch) {
                const targetVar = indirectMatch[1];
                const sourceVar = indirectMatch[2];
                if (currentVarMap[sourceVar]) {
                    currentVarMap[targetVar] = currentVarMap[sourceVar];
                }
            }

            // Track register allocations: int reg = sfxb.allocateReg();
            const regAssignMatch = trimmed.match(/(?:int\s+)?([a-zA-Z0-9_]+)\s*=\s*sfxb\.allocateReg\(\)/);
            if (regAssignMatch) {
                const varName = regAssignMatch[1];
                if (!managedRegs.includes(varName)) managedRegs.push(varName);
                currentVarMap[varName] = `\${reg.${varName}}`;
            }

            // Track constant/field values (heuristic)
            const fieldMatch = trimmed.match(/(?:(?:double|int)\s+)?([a-zA-Z0-9_]+)\s*=\s*([^;]+)/);
            if (fieldMatch) {
                const varName = fieldMatch[1];
                const val = fieldMatch[2].trim();
                if (/^[0-9.-]+(\/[0-9.-]+)?$/.test(val)) {
                    currentVarMap[varName] = val;
                }
            }

            // Save snapshot for this line
            varSnapshots[i] = { ...currentVarMap };
        }

        // Second pass: Generate assembly using snapshots
        for (let i = 0; i < lines.length; i++) {
            let trimmed = lines[i].trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('System.out')) continue;

            const resolve = (val) => {
                val = val.trim();
                return varSnapshots[i][val] || val;
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
            try {
                const content = fs.readFileSync(path.join(dir, file), 'utf8');
                const definition = parseJavaBlock(content, file);
                const targetFile = path.join(targetDir, `${definition.type}.atl`);
                fs.writeFileSync(targetFile, toATL(definition));
                totalCount++;
            } catch (e) {
                console.error(`Error converting ${file}: ${e}`);
            }
        }
    }
}

console.log(`Successfully converted ${totalCount} Java blocks to ATL format.`);
