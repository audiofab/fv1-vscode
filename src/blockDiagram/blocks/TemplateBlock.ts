/**
 * TemplateBlock
 * Wrapper for declarative block definitions using the BlockTemplate engine.
 */

import { BaseBlock } from './base/BaseBlock.js';
import { BlockTemplateDefinition } from '../types/IR.js';
import { BlockTemplate } from '../compiler/BlockTemplate.js';
import { CodeGenContext } from '../types/Block.js';

export class TemplateBlock extends BaseBlock {
    readonly type: string;
    readonly category: string;
    readonly name: string;
    readonly description: string;

    private templateEngine: BlockTemplate;

    constructor(definition: BlockTemplateDefinition) {
        super();
        this.type = definition.type;
        this.category = definition.category;
        this.name = definition.name;
        this.description = definition.description;
        this.color = definition.color || '#607D8B';
        this.width = definition.width || 200;

        this._inputs = definition.inputs.map(i => ({
            ...i,
            direction: 'input'
        }));
        this._outputs = definition.outputs.map(o => ({
            ...o,
            direction: 'output'
        }));
        this._parameters = definition.parameters.map(p => ({
            ...p,
            type: p.type as any
        })) as any;

        this.templateEngine = new BlockTemplate(definition);
        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const blockInstance = ctx.getBlock(ctx.getCurrentBlock()!)!;
        const irNodes = this.templateEngine.generateIR(blockInstance, ctx);
        for (const node of irNodes) {
            ctx.pushIR(node);
        }
    }
}
