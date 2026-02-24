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
    static convert(content: string): BlockTemplateDefinition {
        const lines = content.split('\n');
        const definition: BlockTemplateDefinition = {
            type: '',
            category: 'Legacy',
            name: '',
            description: '',
            inputs: [],
            outputs: [],
            parameters: [],
            template: ''
        };

        const templateLines: string[] = [];

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
