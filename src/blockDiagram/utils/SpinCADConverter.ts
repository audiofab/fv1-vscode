/**
 * SpinCADConverter
 * Parses .spincad files and generates JSON or ATL (Frontmatter) block definitions.
 */

import { BlockTemplateDefinition } from '../types/IR.js';

export class SpinCADConverter {
    /**
     * Convert a SpinCAD template string to an ATL BlockTemplateDefinition
     * Metadata is extracted from @ directives.
     */
    static convert(content: string, typeOverride?: string, sourceFile?: string): BlockTemplateDefinition {
        const lines = content.split('\n');
        const definition: BlockTemplateDefinition = {
            type: typeOverride || '',
            category: 'SpinCAD',
            name: '',
            description: '',
            inputs: [],
            outputs: [],
            parameters: [],
            template: ''
        };

        const headerLines: string[] = [];
        if (sourceFile) {
            headerLines.push(`@comment "Generated from spincad source file ${sourceFile}"`);
        }
        const bodyLines: string[] = [];
        const managedRegs: string[] = [];
        const managedMemo: Array<{ id: string; size: number | string }> = [];

        for (let line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('@')) {
                const parts = trimmed.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g)?.map(m => m.replace(/^["']|["']$/g, '')) || [];
                if (parts.length === 0) continue;

                const directive = parts[0].substring(1);

                switch (directive) {
                    case 'name':
                        definition.name = parts.slice(1).join(' ');
                        if (!typeOverride) {
                            definition.type = definition.name.toLowerCase()
                                .replace(/[^a-z0-9]+/g, '_')
                                .replace(/^_+|_+$/g, '');
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
                            conversion: parts[8] as any
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
                        // Legacy directive, ignore
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
                        const mId = parts[1];
                        const sizePart = parts[2];
                        const mSize = isNaN(Number(sizePart)) ? sizePart : parseInt(sizePart);
                        managedMemo.push({ id: mId, size: mSize });
                        break;
                    default:
                        // Keep other directives like @lpf1p etc.
                        bodyLines.push(trimmed);
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
                    const sizeStr = lineParts[2];
                    const memSize = isNaN(Number(sizeStr)) ? sizeStr : parseInt(sizeStr);
                    managedMemo.push({ id: memId, size: memSize });
                } else {
                    bodyLines.push(line);
                }
            }
        }

        if (managedRegs.length > 0) definition.registers = managedRegs;
        if (managedMemo.length > 0) (definition as any).memo = managedMemo;

        const templateLines: string[] = [];
        if (headerLines.length > 0) {
            const filteredHeaders = headerLines.filter(line => {
                const parts = line.trim().split(/\s+/);
                if (parts[0].toLowerCase() === 'equ' || parts[0].toLowerCase() === '@equ') {
                    const eqId = parts[1];
                    if (definition.parameters.some(p => p.id === eqId)) {
                        return false;
                    }
                }
                return true;
            });
            if (filteredHeaders.length > 0) {
                templateLines.push('@section header');
                templateLines.push(...filteredHeaders);
                templateLines.push('');
            }
        }
        if (bodyLines.length > 0) {
            if (headerLines.length > 0) {
                templateLines.push('@section main');
            }
            templateLines.push(...bodyLines);
        }

        // Variable substitution pass: Replace raw IDs with ${type.id} tokens
        const ids = {
            input: definition.inputs.map(i => i.id),
            output: definition.outputs.map(o => o.id),
            param: definition.parameters.map(p => p.id),
            local: managedRegs,
            memo: managedMemo.map(m => m.id)
        };

        let processedTemplate = templateLines.join('\n');

        // Replace whole words only to avoid partial matches
        // Handle +/- suffixes by inserting a space
        const replaceToken = (id: string, target: string) => {
            const regex = new RegExp(`\\b${id}\\b(?![^\\{]*\\})`, 'g');
            processedTemplate = processedTemplate.replace(regex, (match, offset, string) => {
                const nextChar = string[offset + match.length];
                if (nextChar === '+' || nextChar === '-') {
                    return target + ' ';
                }
                return target;
            });
        };

        for (const id of ids.input) replaceToken(id, `\${input.${id}}`);
        for (const id of ids.output) replaceToken(id, `\${output.${id}}`);
        for (const id of ids.param) replaceToken(id, `\${${id}}`);
        for (const id of ids.local) replaceToken(id, `\${reg.${id}}`);
        for (const id of ids.memo) replaceToken(id, `\${mem.${id}}`);

        definition.template = processedTemplate;
        return definition;
    }

    /**
     * Format a definition as an ATL file with JSON frontmatter
     */
    static toATL(definition: BlockTemplateDefinition): string {
        const metadata = { ...definition };
        const template = metadata.template;
        delete (metadata as any).template;

        return `---\n${JSON.stringify(metadata, null, 2)}\n---\n${template}`;
    }
}
