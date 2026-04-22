import {
    blockRegistry,
    BUILTIN_BLOCKS,
    GraphCompiler,
    OptimizationLevel,
} from '@audiofab-io/fv1-core/blockDiagram';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
    blockRegistry.loadManifest(BUILTIN_BLOCKS);

    const compiler = new GraphCompiler(blockRegistry);

    // Simple ADC -> DAC diagram
    const graph = {
        metadata: { name: 'Optimization Test' },
        blocks: [
            { id: 'b1', type: 'input.adc', parameters: { adcNumber: 1 }, position: { x: 0, y: 0 } },
            { id: 'b2', type: 'output.dac', parameters: { dacNumber: 1 }, position: { x: 200, y: 0 } }
        ],
        connections: [
            { from: { blockId: 'b1', portId: 'out' }, to: { blockId: 'b2', portId: 'in' } }
        ]
    };

    const options = {
        regCount: 32,
        progSize: 128,
        delaySize: 32768,
        fv1AsmMemBug: true,
        clampReals: true
    };

    console.log('--- Testing Optimization Levels ---');

    // Level 0: None
    const res0 = compiler.compile(graph, { ...options, optimizationLevel: OptimizationLevel.None });
    const inst0 = res0.statistics.instructionsUsed;
    const reg0 = res0.statistics.registersUsed;
    console.log(`Level 0 (None):       ${inst0} instructions, ${reg0} registers`);

    // Level 1: Standard
    const res1 = compiler.compile(graph, { ...options, optimizationLevel: OptimizationLevel.Standard });
    const inst1 = res1.statistics.instructionsUsed;
    const reg1 = res1.statistics.registersUsed;
    console.log(`Level 1 (Standard):   ${inst1} instructions, ${reg1} registers`);

    // Level 2: Aggressive
    const res2 = compiler.compile(graph, { ...options, optimizationLevel: OptimizationLevel.Aggressive });
    const inst2 = res2.statistics.instructionsUsed;
    const reg2 = res2.statistics.registersUsed;
    console.log(`Level 2 (Aggressive): ${inst2} instructions, ${reg2} registers`);

    console.log('\n--- Assembly Output (Level 2) ---');
    console.log(res2.assembly);

    // Verification
    if (inst2 < inst0 && inst2 === 2) {
        console.log('\n✅ SUCCESS: Aggressive optimization reduced ADC->DAC to 2 instructions!');
    } else {
        console.log(`\n❌ FAILURE: Aggressive optimization failed to reach target. (Got ${inst2} instructions)`);
        process.exit(1);
    }

    if (reg2 === 0) {
        console.log('✅ SUCCESS: Intermediate register was elided!');
    } else {
        console.log(`❌ FAILURE: Intermediate register still present (${reg2} used).`);
        process.exit(1);
    }
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
