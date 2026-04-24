import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { GraphCompiler, blockRegistry, BUILTIN_BLOCKS } from '@audiofab-io/fv1-core/blockDiagram';
import { FV1Assembler } from '@audiofab-io/fv1-core';

// Resolve fv1-core's blocks directory from the installed package, not a sibling
// clone. We resolve a known exported subpath and walk up until we find the
// package root (the directory whose package.json has the fv1-core name).
function findFv1CorePackageRoot() {
    let dir = path.dirname(fileURLToPath(import.meta.resolve('@audiofab-io/fv1-core/blockDiagram')));
    while (true) {
        const pkgJson = path.join(dir, 'package.json');
        if (fs.existsSync(pkgJson)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
                if (pkg.name === '@audiofab-io/fv1-core') return dir;
            } catch { /* keep walking */ }
        }
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error('Could not locate @audiofab-io/fv1-core package root');
        dir = parent;
    }
}

const blocksDir = path.join(findFv1CorePackageRoot(), 'blocks');

blockRegistry.loadManifest(BUILTIN_BLOCKS);

function getAllAtlFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            // Exclude spincad folder
            if (path.basename(fullPath) !== 'spincad') {
                results = results.concat(getAllAtlFiles(fullPath));
            }
        } else if (fullPath.endsWith('.atl')) {
            results.push(fullPath);
        }
    }
    return results;
}

function testAtlFile(filePath) {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) {
        throw new Error(`Failed to read frontmatter from ${filePath}`);
    }
    const def = JSON.parse(frontmatterMatch[1]);

    // Create a minimal graph with just this block
    const block = {
        id: 'test_block_1',
        type: def.type,
        position: { x: 0, y: 0 },
        parameters: {}
    };

    // Set parameters
    for (const param of def.parameters || []) {
        block.parameters[param.id] = param.default !== undefined ? param.default : 0;
    }

    const graph = {
        blocks: [block],
        connections: []
    };

    const compiler = new GraphCompiler(blockRegistry);
    const compileResult = compiler.compile(graph, {
        regCount: 32,
        progSize: 128,
        delaySize: 32768,
        fv1AsmMemBug: true,
        clampReals: false
    });

    if (!compileResult.success) {
        throw new Error(`Graph Compilation failed for ${def.type}:\n${compileResult.errors?.join('\n')}`);
    }

    // Test that the generated assembly can be assembled by the FV-1 Assembler
    const assembler = new FV1Assembler();
    try {
        const asmResult = assembler.assemble(compileResult.assembly);
        const fatalErrors = asmResult.problems?.filter(p => p.isFatal) || [];
        if (fatalErrors.length > 0) {
            throw new Error(`Assembly process failed for ${def.type}:\n${fatalErrors.map(p => p.message).join('\n')}`);
        }
    } catch (e) {
        throw new Error(`Assembling SPN failed for ${def.type}:\n${e.message}`);
    }
}

function main() {
    console.log(`\n=== Testing All Core ATL Blocks ===`);
    const files = getAllAtlFiles(blocksDir);
    console.log(`Found ${files.length} .atl files to test\n`);

    let passed = 0;
    let failed = 0;

    for (const file of files) {
        try {
            console.log(`Testing block: ${path.basename(file)}`);
            testAtlFile(file);
            console.log(`  ✓ Passed`);
            passed++;
        } catch (e) {
            console.error(`  ✗ FAILED: ${path.basename(file)}`);
            console.error(e.message);
            failed++;
        }
    }

    console.log(`\n=== Results ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${files.length}\n`);

    process.exit(failed > 0 ? 1 : 0);
}

main();
