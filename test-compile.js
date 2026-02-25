
import { GraphCompiler } from './out/blockDiagram/compiler/GraphCompiler.js';
import { BlockRegistry } from './out/blockDiagram/blocks/BlockRegistry.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock Registry or load from resources
const registry = new BlockRegistry();
// The registry normally loads from extensions context. We need to tell it where to look.
registry.blocksPath = path.resolve(__dirname, 'resources/blocks');
// We need to manually trigger scanning
await registry.scanBlocks();

const compiler = new GraphCompiler(registry);

const graph = {
    metadata: { name: 'Flanger Test', description: 'ADC -> Flanger -> DAC' },
    blocks: [
        { id: 'adc', type: 'input.adcl', parameters: { dacNumber: 0 }, inputs: [], outputs: [] },
        { id: 'flanger', type: 'flanger', parameters: {}, inputs: [], outputs: [] },
        { id: 'dac', type: 'output.dacl', parameters: { dacNumber: 0 }, inputs: [], outputs: [] }
    ],
    connections: [
        { from: { blockId: 'adc', portId: 'out' }, to: { blockId: 'flanger', portId: 'adcl' } },
        { from: { blockId: 'flanger', portId: 'output' }, to: { blockId: 'dac', portId: 'in' } }
    ]
};

console.log('Compiling graph...');
try {
    const result = compiler.compile(graph, { regCount: 32, progSize: 128, delaySize: 32768 });

    if (result.success) {
        console.log('SUCCESS!');
        console.log('Assembly:\n');
        console.log(result.assembly);
    } else {
        console.log('FAILURE');
        console.log('Errors:', JSON.stringify(result.errors, null, 2));
    }
} catch (e) {
    console.error('Crash during compilation:', e);
}
