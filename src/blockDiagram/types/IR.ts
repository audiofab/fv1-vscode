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
    }>;
    outputs: Array<{
        id: string;
        name: string;
        type: 'audio' | 'control';
    }>;
    parameters: Array<{
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
        eval?: string; // TypeScript expression for custom conversion
    }>;
    registers?: string[]; // Internal state registers (not exposed as ports)
    template: string; // The ATL template string
}
