/**
 * Core types for the new Semantic Intermediate Representation (IR)
 * and Declarative Block Templates.
 */

export type IRSection = 'init' | 'input' | 'main' | 'output' | 'header';

export interface IRNode {
    op: string;
    args: any[];
    section: IRSection;
    comment?: string;
}

export interface BlockTemplateDefinition {
    type: string;
    category: string;
    subcategory?: string;
    name: string;
    description: string;
    color?: string;
    width?: number;
    height?: number;
    inputs: Array<{
        id: string;
        name: string;
        type: 'audio' | 'control';
        required?: boolean;
        parameter?: string;  // For control inputs: the parameter ID that backs this CV (used by @cv macro)
    }>;
    outputs: Array<{
        id: string;
        name: string;
        type: 'audio' | 'control';
    }>;
    parameters: BlockParameterDefinition[];
    registers?: string[]; // Internal state registers (not exposed as ports)
    memories?: Array<{ id: string; size: number | string }>; // Internal delay memory
    labelTemplate?: string; // Optional template for the block label in the UI
    template: string; // The ATL template string
}

export interface BlockParameterDefinition {
    id: string;
    name: string;
    type: 'number' | 'select' | 'boolean' | 'string';
    default: any;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ label: string; value: any }>;
    description?: string;
    conversion?: 'LOGFREQ' | 'SINLFOFREQ' | 'DBLEVEL' | 'LENGTHTOTIME' | 'CUSTOM';
    displayUnit?: string;
    displayMin?: number;
    displayMax?: number;
    displayDecimals?: number;
    eval?: string; // TypeScript expression for custom conversion
}
