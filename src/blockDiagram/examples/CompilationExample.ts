/**
 * Example: Compile a simple block diagram to FV-1 assembly
 * This demonstrates the usage of the block diagram system
 */

import { BlockGraph, createEmptyGraph } from '../types/Graph.js';
import { blockRegistry } from '../blocks/BlockRegistry.js';
import { GraphCompiler } from '../compiler/GraphCompiler.js';

/**
 * Create a simple test graph: 
 * ADCL -> Delay -> DACL
 */
function createTestGraph(): BlockGraph {
    const graph = createEmptyGraph('Test Delay Effect');
    graph.metadata.author = 'Example';
    graph.metadata.description = 'Simple delay effect on left channel';
    
    // Add blocks
    graph.blocks = [
        {
            id: 'block_input',
            type: 'input.adcl',
            position: { x: 100, y: 200 },
            parameters: { gain: 1.0 }
        },
        {
            id: 'block_delay',
            type: 'fx.delay',
            position: { x: 350, y: 200 },
            parameters: {
                delayTime: 0.3,
                feedback: 0.6,
                mix: 0.5
            }
        },
        {
            id: 'block_output',
            type: 'output.dacl',
            position: { x: 600, y: 200 },
            parameters: { gain: 1.0 }
        }
    ];
    
    // Add connections
    graph.connections = [
        {
            id: 'conn_1',
            from: { blockId: 'block_input', portId: 'out' },
            to: { blockId: 'block_delay', portId: 'in' }
        },
        {
            id: 'conn_2',
            from: { blockId: 'block_delay', portId: 'out' },
            to: { blockId: 'block_output', portId: 'in' }
        }
    ];
    
    return graph;
}

/**
 * Create a more complex test graph:
 * ADCL ──┬──> Delay ──┬──> Mixer ──> DACL
 *        │             │      ↑
 *        └─────────────┴──────┘
 * (Input goes to delay and also mixed with delayed signal)
 */
function createMixerTestGraph(): BlockGraph {
    const graph = createEmptyGraph('Delay with Dry Mix');
    graph.metadata.author = 'Example';
    graph.metadata.description = 'Delay mixed with dry signal';
    
    graph.blocks = [
        {
            id: 'input',
            type: 'input.adcl',
            position: { x: 100, y: 200 },
            parameters: { gain: 1.0 }
        },
        {
            id: 'delay',
            type: 'fx.delay',
            position: { x: 300, y: 200 },
            parameters: {
                delayTime: 0.5,
                feedback: 0.4,
                mix: 1.0  // 100% wet from delay block
            }
        },
        {
            id: 'mixer',
            type: 'math.mixer',
            position: { x: 500, y: 200 },
            parameters: {
                gain1: 0.7,  // Dry signal
                gain2: 0.5   // Wet signal
            }
        },
        {
            id: 'output',
            type: 'output.dacl',
            position: { x: 700, y: 200 },
            parameters: { gain: 1.0 }
        }
    ];
    
    graph.connections = [
        {
            id: 'conn_1',
            from: { blockId: 'input', portId: 'out' },
            to: { blockId: 'delay', portId: 'in' }
        },
        {
            id: 'conn_2',
            from: { blockId: 'input', portId: 'out' },
            to: { blockId: 'mixer', portId: 'in1' }
        },
        {
            id: 'conn_3',
            from: { blockId: 'delay', portId: 'out' },
            to: { blockId: 'mixer', portId: 'in2' }
        },
        {
            id: 'conn_4',
            from: { blockId: 'mixer', portId: 'out' },
            to: { blockId: 'output', portId: 'in' }
        }
    ];
    
    return graph;
}

/**
 * Run compilation test
 */
export function runCompilationTest(): void {
    console.log('=== FV-1 Block Diagram Compiler Test ===\n');
    
    // Test 1: Simple delay
    console.log('Test 1: Simple Delay Effect');
    console.log('----------------------------');
    const graph1 = createTestGraph();
    const compiler = new GraphCompiler(blockRegistry);
    const result1 = compiler.compile(graph1);
    
    if (result1.success) {
        console.log('✓ Compilation successful!\n');
        console.log('Statistics:');
        console.log(`  Instructions: ${result1.statistics?.instructionsUsed}/128`);
        console.log(`  Registers: ${result1.statistics?.registersUsed}/32`);
        console.log(`  Memory: ${result1.statistics?.memoryUsed}/32768 words`);
        console.log(`  Blocks: ${result1.statistics?.blocksProcessed}`);
        console.log('\nGenerated Assembly:');
        console.log('------------------');
        console.log(result1.assembly);
    } else {
        console.log('✗ Compilation failed!');
        console.log('Errors:', result1.errors);
    }
    
    console.log('\n\n');
    
    // Test 2: Mixer graph
    console.log('Test 2: Delay with Mixer');
    console.log('-------------------------');
    const graph2 = createMixerTestGraph();
    const result2 = compiler.compile(graph2);
    
    if (result2.success) {
        console.log('✓ Compilation successful!\n');
        console.log('Statistics:');
        console.log(`  Instructions: ${result2.statistics?.instructionsUsed}/128`);
        console.log(`  Registers: ${result2.statistics?.registersUsed}/32`);
        console.log(`  Memory: ${result2.statistics?.memoryUsed}/32768 words`);
        console.log(`  Blocks: ${result2.statistics?.blocksProcessed}`);
        console.log('\nGenerated Assembly:');
        console.log('------------------');
        console.log(result2.assembly);
    } else {
        console.log('✗ Compilation failed!');
        console.log('Errors:', result2.errors);
    }
}

// Run tests if executed directly
if (require.main === module) {
    runCompilationTest();
}
