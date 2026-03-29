import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Important: ensure imports map to the locally built `out/` JS paths, not `.ts` src 
import { GraphCompiler } from '../out/blockDiagram/compiler/GraphCompiler.js';
import { blockRegistry } from '../out/blockDiagram/blocks/BlockRegistry.js';
import { OptimizationLevel } from '../out/blockDiagram/compiler/CodeOptimizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directories
const rootDir = path.resolve(__dirname, '..');
const diagramsDir = path.join(__dirname, 'diagrams');
const refDir = path.join(diagramsDir, 'ref');

// Initialize the block registry using the compiled extension output paths natively
blockRegistry.init(rootDir, []);

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}\n\n--- EXPECTED ---\n${expected}\n\n--- ACTUAL ---\n${actual}`);
    }
}

/**
 * Normalizes assembly text for snapshot comparison by stripping trailing spaces and normalizing newlines.
 */
function normalizeAssembly(asm) {
    if (!asm) return '';
    return asm
        .split('\n')
        .filter(line => !line.includes('Generated at'))
        .map(line => line.trimEnd())
        .join('\n')
        .trim();
}

/**
 * Tests GraphCompiler against a specific .spndiagram snapshot for a given optimization level
 */
function testDiagramCompilation(diagramName, optLevel = OptimizationLevel.Aggressive) {
    const levelName = `opt${optLevel}`;
    const diagramPath = path.join(diagramsDir, `${diagramName}.spndiagram`);
    const refPath = path.join(refDir, `${diagramName}.${levelName}.spn`);

    // 1. Load the JSON diagram
    const diagramContent = fs.readFileSync(diagramPath, 'utf8');
    let graph;
    try {
        const parsed = JSON.parse(diagramContent);
        // SPNDiagram files contain { graph: BlockGraph, ... } or are directly the graph
        graph = parsed.graph || parsed;

        // Translate raw connection format from diagram JSON ({source, target}) to AST ({from, to})
        if (graph.connections && graph.connections.length > 0 && graph.connections[0].source !== undefined) {
            graph.connections = graph.connections.map(c => ({
                from: { blockId: c.source, portId: c.sourcePort },
                to: { blockId: c.target, portId: c.targetPort }
            }));
        }
    } catch (e) {
        throw new Error(`Failed to parse ${diagramPath}: ${e.message}`);
    }

    // 2. Compile the diagram natively using the GraphCompiler
    const compiler = new GraphCompiler(blockRegistry);
    const result = compiler.compile(graph, {
        regCount: 32,
        progSize: 128,
        delaySize: 32768,
        fv1AsmMemBug: true,
        clampReals: false,
        optimizationLevel: optLevel
    });

    if (!result.success) {
        throw new Error(`Compilation failed (Level ${optLevel}) for ${diagramName}:\n${result.errors?.join('\n')}`);
    }

    const actualAssembly = normalizeAssembly(result.assembly);

    // 3. Snapshot verification
    if (!fs.existsSync(refPath)) {
        // Auto-generate missing snapshot
        console.log(`  [INFO] Missing reference snapshot (Level ${optLevel}) for ${diagramName}. Auto-generating it.`);
        fs.mkdirSync(refDir, { recursive: true });
        fs.writeFileSync(refPath, actualAssembly, 'utf8');
        return;
    }

    // Verify against existing snapshot
    const expectedAssembly = normalizeAssembly(fs.readFileSync(refPath, 'utf8'));

    assertEqual(actualAssembly, expectedAssembly, `Snapshot mismatch (Level ${optLevel}) for ${diagramName}! The generated assembly differs from the reference file.`);

    console.log(`  ✓ ${diagramName} [Level ${optLevel}] passed`);
}

function main() {
    console.log(`\n=== FV1 Block Graph Compiler Tests (All Optimization Levels) ===`);

    if (!fs.existsSync(diagramsDir)) {
        console.log(`No 'diagrams' directory found at ${diagramsDir}. Skipping Graph Compiler tests.`);
        return;
    }

    fs.mkdirSync(refDir, { recursive: true });

    let testsPassed = 0;
    let testsFailed = 0;
    const testDiagrams = fs.readdirSync(diagramsDir).filter(f => f.endsWith('.spndiagram'));

    console.log(`Found ${testDiagrams.length} diagram test cases. Executing 3 levels each...\n`);

    if (testDiagrams.length === 0) {
        console.log("No test cases found.");
        return;
    }

    const levels = [
        OptimizationLevel.None,
        OptimizationLevel.Standard,
        OptimizationLevel.Aggressive
    ];

    for (const file of testDiagrams) {
        const diagramName = path.basename(file, '.spndiagram');
        
        for (const level of levels) {
            try {
                testDiagramCompilation(diagramName, level);
                testsPassed++;
            } catch (e) {
                const errMsg = `\n  ✗ ${diagramName} [Level ${level}] FAILED:\n${e.message}\n`;
                fs.appendFileSync('debug_error.log', errMsg);
                console.error(errMsg);
                testsFailed++;
            }
        }
    }

    console.log(`\n=== Graph Compiler Results ===`);
    console.log(`Total Level Passes: ${testsPassed}`);
    console.log(`Total Level Failures: ${testsFailed}`);
    console.log(`Total Tests Run: ${testsPassed + testsFailed}\n`);

    process.exit(testsFailed > 0 ? 1 : 0);
}

main();
