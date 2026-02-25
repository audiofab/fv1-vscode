
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Provide global vscode mock
global.vscode = {
    workspace: {
        getConfiguration: () => ({
            get: (key) => (key === 'spinAsmMemBug' || key === 'clampReals' ? true : undefined)
        })
    }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Note: This script requires GraphCompiler.js to be patched or for the vscode import to be mocked.
// Since we are running in Node, we use a simple mock but the actual out/ files may still try to import 'vscode'.
// If you run this and get ERR_MODULE_NOT_FOUND 'vscode', you may need to temporarily comment out 
// the vscode import in out/blockDiagram/compiler/GraphCompiler.js

import { GraphCompiler } from '../out/blockDiagram/compiler/GraphCompiler.js';
import { FV1Assembler } from '../out/assembler/FV1Assembler.js';
import { BlockRegistry } from '../out/blockDiagram/blocks/BlockRegistry.js';

async function proveIt() {
    console.log("Starting full conversion and assembly proof...");

    // 1. Initialize Registry and load blocks
    console.log("Initializing Block Registry...");
    const registry = new BlockRegistry();
    // Path relative to project root
    const extensionPath = path.resolve(__dirname, '..');
    registry.init(extensionPath);

    // 2. Define a simple graph: ADC -> Flanger -> DAC
    const graph = {
        metadata: {
            name: "Proof of Flanger Fix",
            description: "End-to-end test of Flanger block conversion and assembly",
            author: "Antigravity Assistant"
        },
        blocks: [
            { id: 'b_adc', type: 'input.adc', parameters: {} },
            { id: 'b_flanger', type: 'flanger', parameters: { rate: 20, width: 30, delayLength: 512 } },
            { id: 'b_dac', type: 'output.dac', parameters: {} }
        ],
        connections: [
            { from: { blockId: 'b_adc', portId: 'out' }, to: { blockId: 'b_flanger', portId: 'input' } },
            { from: { blockId: 'b_flanger', portId: 'output1' }, to: { blockId: 'b_dac', portId: 'in' } }
        ]
    };

    // 3. Compile the graph to assembly
    console.log("Compiling graph to assembly...");
    const compiler = new GraphCompiler(registry);
    const result = compiler.compile(graph, {
        regCount: 32,
        progSize: 128,
        delaySize: 32768
    });

    if (!result.success) {
        console.error("Compilation failed:", result.errors);
        process.exit(1);
    }

    const assembly = result.assembly;
    console.log("--- GENERATED ASSEMBLY ---");
    // console.log(assembly); // Truncated for brevity in logs
    console.log("(Assembly generated successfully)");
    console.log("--------------------------");

    // 4. Assemble the result
    console.log("Attempting to assemble...");
    const assembler = new FV1Assembler();
    const asmResult = assembler.assemble(assembly);

    console.log("\nAssembler Problems:", asmResult.problems.length);
    asmResult.problems.forEach(p => {
        console.error(`${p.isfatal ? 'FATAL' : 'WARNING'} (Line ${p.line}): ${p.message}`);
    });

    if (asmResult.problems.filter(p => p.isfatal).length === 0) {
        console.log("\nSUCCESS: The graph compiled and assembled into " + asmResult.machineCode.length + " instructions.");

        // Find non-NOP instructions
        const NOP_ENCODING = 0x00000011;
        const nonNops = asmResult.machineCode.map((v, i) => ({ v, i })).filter(x => x.v !== NOP_ENCODING);

        console.log(`Found ${nonNops.length} non-NOP instructions.`);
        if (nonNops.length > 0) {
            console.log("First 10 non-NOP instructions:");
            nonNops.slice(0, 10).forEach(x => {
                console.log(`[${x.i.toString().padStart(3, ' ')}] 0x${x.v.toString(16).padStart(8, '0')}`);
            });
        }
    } else {
        console.error("\nFAILURE: Assembly failed.");
        process.exit(1);
    }
}

proveIt().catch(console.error);
