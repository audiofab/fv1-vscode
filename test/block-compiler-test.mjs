import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Important: ensure imports map to the locally built `out/` JS paths, not `.ts` src 
import { GraphCompiler } from '../out/blockDiagram/compiler/GraphCompiler.js';
import { blockRegistry } from '../out/blockDiagram/blocks/BlockRegistry.js';

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
 * Tests GraphCompiler against a specific .spndiagram snapshot
 */
function testDiagramCompilation(diagramName) {
    console.log(`\nTesting Graph Compiler: ${diagramName}...`);

    const diagramPath = path.join(diagramsDir, `${diagramName}.spndiagram`);
    const refPath = path.join(refDir, `${diagramName}.spn`);

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
        clampReals: false
    });

    if (!result.success) {
        throw new Error(`Compilation failed for ${diagramName}:\n${result.errors?.join('\n')}`);
    }

    const actualAssembly = normalizeAssembly(result.assembly);

    // 3. Snapshot verification
    if (!fs.existsSync(refPath)) {
        // Auto-generate missing snapshot
        console.log(`  [INFO] Missing reference snapshot for ${diagramName}. Auto-generating it at: test/diagrams/ref/${diagramName}.spn`);
        fs.mkdirSync(refDir, { recursive: true });
        fs.writeFileSync(refPath, actualAssembly, 'utf8');
        console.log(`  ✓ Snapshot generated for ${diagramName}`);
        return;
    }

    // Verify against existing snapshot
    const expectedAssembly = normalizeAssembly(fs.readFileSync(refPath, 'utf8'));

    assertEqual(actualAssembly, expectedAssembly, `Snapshot mismatch for ${diagramName}! The generated SPN assembly differs from the reference file. If this change is intentional, delete the .spn file in test/diagrams/ref to regenerate the snapshot.`);

    console.log(`  ✓ ${diagramName} passed (Matches Snapshot)`);
}

function main() {
    console.log(`\n=== FV1 Block Graph Compiler Tests ===`);

    if (!fs.existsSync(diagramsDir)) {
        console.log(`No 'diagrams' directory found at ${diagramsDir}. Skipping Graph Compiler tests.`);
        return;
    }

    fs.mkdirSync(refDir, { recursive: true });

    let passed = 0;
    let failed = 0;
    const testDiagrams = fs.readdirSync(diagramsDir).filter(f => f.endsWith('.spndiagram'));

    console.log(`\n=== FV1 Block Graph Compiler Tests ===`);
    console.log(`Found ${testDiagrams.length} diagram test case(s)\n`);

    if (testDiagrams.length === 0) {
        console.log("No test cases found.");
        return;
    }

    for (const file of testDiagrams) {
        const diagramName = path.basename(file, '.spndiagram');
        console.log(`Testing Graph Compiler: ${diagramName}...`);
        try {
            testDiagramCompilation(diagramName);
            passed++;
        } catch (e) {
            fs.appendFileSync('debug_error.log', `\n  ✗ ${diagramName} FAILED:\n${e.message}\n${e.stack}\n`);
            console.error(`  ✗ ${diagramName} FAILED:\n${e.message}\n${e.stack}`);
            failed++;
        }
    }

    console.log(`\n=== Graph Compiler Results ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${testDiagrams.length}\n`);

    process.exit(failed > 0 ? 1 : 0);
}

main();
