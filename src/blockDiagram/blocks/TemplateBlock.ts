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
    declare readonly subcategory?: string;
    readonly name: string;
    readonly description: string;

    private templateEngine: BlockTemplate;

    constructor(definition: BlockTemplateDefinition) {
        super();
        this.type = definition.type;
        this.category = definition.category;
        this.subcategory = definition.subcategory;
        this.name = definition.name;
        this.description = definition.description;
        this.color = definition.color || '#607D8B';
        this.width = definition.width || 200;

        this._inputs = definition.inputs.map(i => ({
            ...i
        }));
        this._outputs = definition.outputs.map(o => ({
            ...o
        }));
        this._parameters = definition.parameters.map(p => {
            const param: any = {
                ...p,
                type: p.type as any
            };

            // Add display metadata for the UI ONLY if not already specified in ATL
            if (p.conversion === 'LOGFREQ') {
                if (param.displayMin === undefined) param.displayMin = p.min || 20;
                if (param.displayMax === undefined) param.displayMax = p.max || 5000;
                if (param.displayUnit === undefined) param.displayUnit = 'Hz';
            } else if (p.conversion === 'DBLEVEL') {
                if (param.displayUnit === undefined) param.displayUnit = 'dB';
            }

            return param;
        }) as any;

        this.templateEngine = new BlockTemplate(definition);
        this.autoCalculateHeight();
    }

    getCustomLabel(params: Record<string, any>, ctx?: any, blockId?: string): string | null {
        // Try resolving template from definition
        const dynamicLabel = this.templateEngine.resolveLabel(params, ctx, blockId);
        
        // If an explicit label template was provided (even if empty ""), respect it and skip fallback
        if (dynamicLabel !== null) return dynamicLabel;

        // Fallback to frequency heuristic (only if no explicit label template exists)
        const freqParam = (this._parameters as any[]).find(p => p.conversion === 'LOGFREQ');
        if (freqParam) {
            const val = params[freqParam.id] ?? freqParam.default;
            const hz = typeof val === 'number' && val < 1.0 ? this.filterCoeffToHz(val) : val;
            return `${Math.round(hz)} Hz`;
        }
        return null;
    }

    generateCode(ctx: CodeGenContext): void {
        const blockInstance = ctx.getBlock(ctx.getCurrentBlock()!)!;
        const irNodes = this.templateEngine.generateIR(blockInstance, ctx);
        for (const node of irNodes) {
            ctx.pushIR(node);
        }
    }

    getRawTemplate(): string | undefined {
        const def = (this.templateEngine as any).definition;
        if (!def) return undefined;

        if (def._rawAtl) {
            return def._rawAtl;
        }

        // Fallback: Reconstruct ATL string
        const metadata = { ...def };
        delete metadata.template;
        delete metadata._rawAtl;

        return `---\n${JSON.stringify(metadata, null, 4)}\n---\n${def.template}`;
    }
}
