/**
 * Standalone Batch Convert SpinCAD Templates to .ATL
 * Inlines converter logic to avoid module resolution issues.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(__dirname, 'SpinCAD/src/SpinCADBuilder');
const targetDir = path.resolve(__dirname, 'resources/blocks');

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

function convertSpinCAD(content) {
    const lines = content.split('\n');
    const definition = {
        type: '',
        category: 'Legacy',
        name: '',
        description: '',
        inputs: [],
        outputs: [],
        parameters: [],
        template: ''
    };

    const templateLines = [];

    for (let line of lines) {
        let trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('@')) {
            const parts = trimmed.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g).map(m => m.replace(/^["']|["']$/g, ''));
            const directive = parts[0].substring(1);

            switch (directive) {
                case 'name':
                    definition.name = parts.slice(1).join(' ');
                    definition.type = definition.name.toLowerCase().replace(/[:\s]+/g, '_');
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
                    definition.outputs.push({
                        id: parts[1],
                        name: parts[2] || parts[1],
                        type: 'audio'
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
                    templateLines.push(`@if pinConnected(${parts[1]})`);
                    break;
                case 'isEqualTo':
                    templateLines.push(`@if ${parts[1]} == ${parts[2]}`);
                    break;
                case 'else':
                    templateLines.push('@else');
                    break;
                case 'endif':
                    templateLines.push('@endif');
                    break;
                default:
                    templateLines.push(trimmed);
            }
        } else {
            templateLines.push(line);
        }
    }

    definition.template = templateLines.join('\n');
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
            const definition = convertSpinCAD(content);

            const targetFile = path.join(targetDir, `${definition.type}.atl`);
            fs.writeFileSync(targetFile, toATL(definition));
            count++;
        } catch (e) {
            console.error(`Error converting ${file}: ${e}`);
        }
    }
}

console.log(`Successfully converted ${count} templates to ATL format.`);
