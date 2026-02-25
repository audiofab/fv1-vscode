/**
 * Standalone Batch Convert SpinCAD Templates to .ATL
 * Inlines converter logic to avoid module resolution issues.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(__dirname, 'SpinCAD/src/SpinCADBuilder');
const targetDir = path.resolve(__dirname, 'resources/blocks/spincad');

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

function convertSpinCAD(content, typeOverride) {
    const lines = content.split('\n');
    const definition = {
        type: typeOverride || '',
        category: 'SpinCAD',
        name: '',
        description: '',
        inputs: [],
        outputs: [],
        parameters: [],
        template: ''
    };

    const headerLines = [];
    const bodyLines = [];
    const managedRegs = [];
    const managedMemo = [];

    for (let line of lines) {
        let trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('@')) {
            const regexParts = trimmed.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g);
            if (!regexParts) continue;
            const parts = regexParts.map(m => m.replace(/^["']|["']$/g, ''));
            const directive = parts[0].substring(1);

            switch (directive) {
                case 'name':
                    definition.name = parts.slice(1).join(' ');
                    if (!typeOverride) {
                        definition.type = definition.name.toLowerCase()
                            .replace(/[^a-z0-9]+/g, '_')
                            .replace(/^_+|_+$/g, ''); // Trim underscores
                    }
                    break;
                case 'color':
                    definition.color = parts[1].replace(/"/g, '').replace('0x', '#');
                    break;
                case 'audioInput':
                    definition.inputs.push({
                        id: parts[1],
                        name: parts[2] || parts[1],
                        type: 'audio'
                    });
                    break;
                case 'audioOutput':
                case 'controlOutput':
                    definition.outputs.push({
                        id: parts[1],
                        name: parts[2] || parts[1],
                        type: directive === 'audioOutput' ? 'audio' : 'control'
                    });
                    break;
                case 'controlInput':
                    definition.inputs.push({
                        id: parts[1],
                        name: parts[2] || parts[1],
                        type: 'control'
                    });
                    break;
                case 'sliderLabel':
                    definition.parameters.push({
                        id: parts[1],
                        name: (parts[2] || '').replace(/'/g, ''),
                        type: 'number',
                        min: parseFloat(parts[3]),
                        max: parseFloat(parts[4]),
                        default: parseFloat(parts[5]),
                        conversion: parts[8]
                    });
                    break;
                case 'comboBox':
                    definition.parameters.push({
                        id: parts[1],
                        name: parts[1],
                        type: 'select',
                        default: (parts[2] || '').replace(/'/g, ''),
                        options: parts.slice(2).map(o => ({ label: o.replace(/'/g, ''), value: o.replace(/'/g, '') }))
                    });
                    break;
                case 'isPinConnected':
                    bodyLines.push(`@if pinConnected(${parts[1]})`);
                    break;
                case 'isEqualTo':
                    bodyLines.push(`@if ${parts[1]} == ${parts[2]}`);
                    break;
                case 'else':
                    bodyLines.push('@else');
                    break;
                case 'endif':
                    bodyLines.push('@endif');
                    break;
                case 'setOutputPin':
                    // Skip legacy directive
                    break;
                case 'equ':
                    const eqId = parts[1];
                    const eqVal = parts[2];
                    const isPinEq = definition.inputs.some(i => i.id === eqId) || definition.outputs.some(o => o.id === eqId);
                    if (!isPinEq) {
                        if (eqVal && eqVal.toLowerCase().startsWith('reg')) {
                            managedRegs.push(eqId);
                        } else {
                            headerLines.push(`${directive}\t${parts.slice(1).join('\t')}`);
                        }
                    }
                    break;
                case 'mem':
                    const memId = parts[1];
                    const sizeVal = parts[2];
                    const memSize = isNaN(parseInt(sizeVal)) ? sizeVal : parseInt(sizeVal);
                    managedMemo.push({ id: memId, size: memSize });
                    break;
                default:
                    // Only keep directives that aren't already captured in metadata
                    if (!['name', 'color', 'audioInput', 'audioOutput', 'controlInput', 'controlOutput', 'sliderLabel', 'comboBox'].includes(directive)) {
                        bodyLines.push(trimmed);
                    }
            }
        } else {
            // Assembly line
            const trimmedLine = line.trim();
            const lineParts = trimmedLine.split(/[,\s\t]+/);
            const op = lineParts[0].toLowerCase();

            if (op === 'equ') {
                const eqId = lineParts[1];
                const eqVal = lineParts[2];
                const isPinEq = definition.inputs.some(i => i.id === eqId) || definition.outputs.some(o => o.id === eqId);
                if (!isPinEq) {
                    if (eqVal && eqVal.toLowerCase().startsWith('reg')) {
                        managedRegs.push(eqId);
                    } else {
                        headerLines.push(line);
                    }
                }
            } else if (op === 'mem') {
                const memId = lineParts[1];
                const sizeVal = lineParts[2];
                const memSize = isNaN(parseInt(sizeVal)) ? sizeVal : parseInt(sizeVal);
                managedMemo.push({ id: memId, size: memSize });
            } else {
                bodyLines.push(line);
            }
        }
    }

    if (managedRegs.length > 0) definition.registers = managedRegs;
    if (managedMemo.length > 0) definition.memo = managedMemo;

    const templateLines = [];
    if (headerLines.length > 0) {
        templateLines.push('@section header');
        templateLines.push(...headerLines);
        templateLines.push('');
    }
    if (bodyLines.length > 0) {
        if (headerLines.length > 0) {
            templateLines.push('@section main');
        }
        templateLines.push(...bodyLines);
    }

    // Variable substitution pass: Replace raw IDs with ${type.id} tokens
    const forbiddenNames = [
        ...definition.inputs.map(i => i.id),
        ...definition.outputs.map(o => o.id),
        ...definition.parameters.map(p => p.id)
    ];

    const equNames = headerLines
        .map(l => l.trim().split(/[,\s\t]+/))
        .filter(p => p[0] && p[0].toLowerCase() === 'equ')
        .map(p => p[1])
        .filter(n => n && !n.startsWith('$') && !forbiddenNames.includes(n));

    const ids = {
        input: definition.inputs.map(i => i.id),
        output: definition.outputs.map(o => o.id),
        param: definition.parameters.map(p => p.id),
        equ: equNames,
        local: managedRegs,
        memo: managedMemo.map(m => m.id)
    };

    // Also tokenize common math variables used in SpinCAD (x1, x2, x3, temp1, etc.)
    const mathVars = ['x1', 'x2', 'x3', 'temp1', 'temp2', 'temp'];

    // Build substitution list
    const substitutions = [
        ...ids.input.map(id => ({ id, target: `\${input.${id}}` })),
        ...ids.output.map(id => ({ id, target: `\${output.${id}}` })),
        ...ids.param.map(id => ({ id, target: `\${${id}}` })),
        ...ids.equ.map(id => ({ id, target: `\${local.${id}}` })),
        ...ids.local.map(id => ({ id, target: `\${reg.${id}}` })),
        ...ids.memo.map(id => ({ id, target: `\${mem.${id}}` })),
        ...mathVars.map(id => ({ id, target: `\${local.${id}}` })) // math vars are also internal locals
    ];

    // Filter template lines to remove redundant EQUs for parameters/ports
    const finalTemplateLines = templateLines.filter(line => {
        const trimmed = line.trim();
        if (trimmed.toLowerCase().startsWith('equ')) {
            const parts = trimmed.split(/[,\s\t]+/);
            const name = parts[1];
            if (name && forbiddenNames.includes(name)) {
                return false; // Remove redundant EQU
            }
        }
        return true;
    });

    let processedTemplate = finalTemplateLines.join('\n');

    // Perform substitution in a single pass to avoid double wrapping
    // We use a regex that matches any of the IDs as a whole word,
    // provided it's NOT already part of a ${...} block.
    const allIds = substitutions.map(s => s.id).sort((a, b) => b.length - a.length);
    if (allIds.length > 0) {
        const pattern = new RegExp(`\\b(${allIds.join('|')})\\b(?![^\\{]*\\})`, 'g');
        processedTemplate = processedTemplate.replace(pattern, (match) => {
            const sub = substitutions.find(s => s.id === match);
            return sub ? sub.target : match;
        });
    }

    definition.template = processedTemplate;
    return definition;
}

function toATL(definition) {
    const metadata = { ...definition };
    const template = metadata.template;
    delete metadata.template;
    return `---\n${JSON.stringify(metadata, null, 2)}\n---\n${template}`;
}

console.log(`Converting templates from ${sourceDir} to ${targetDir}...`);

// Clear old files first 
if (fs.existsSync(targetDir)) {
    const oldFiles = fs.readdirSync(targetDir);
    for (const file of oldFiles) {
        fs.unlinkSync(path.join(targetDir, file));
    }
}

const files = fs.readdirSync(sourceDir);
let count = 0;

for (const file of files) {
    if (file.endsWith('.spincad')) {
        try {
            const content = fs.readFileSync(path.join(sourceDir, file), 'utf8');
            const type = file.replace('.spincad', '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
            const definition = convertSpinCAD(content, type);

            const targetFile = path.join(targetDir, `${type}.atl`);
            fs.writeFileSync(targetFile, toATL(definition));
            count++;
        } catch (e) {
            console.error(`Error converting ${file}: ${e}`);
        }
    }
}

console.log(`Successfully converted ${count} templates to ATL format.`);
