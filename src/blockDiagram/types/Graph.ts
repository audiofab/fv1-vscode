/**
 * Block diagram graph structure
 */

import { Block } from './Block.js';
import { Connection } from './Connection.js';

export interface GraphMetadata {
    name: string;
    author?: string;
    description?: string;
    version?: string;
}

export interface CanvasState {
    zoom: number;
    panX: number;
    panY: number;
}

export interface BlockGraph {
    version: string;
    metadata: GraphMetadata;
    canvas: CanvasState;
    blocks: Block[];
    connections: Connection[];
}

/**
 * Default empty graph
 */
export function createEmptyGraph(name: string = 'New Program'): BlockGraph {
    return {
        version: '1.0',
        metadata: {
            name,
            author: '',
            description: ''
        },
        canvas: {
            zoom: 1.0,
            panX: 0,
            panY: 0
        },
        blocks: [],
        connections: []
    };
}
