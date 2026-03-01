import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FV1Assembler } from '../out/assembler/FV1Assembler.js';
import { BlockTemplate } from '../out/blockDiagram/compiler/BlockTemplate.js';
import { parseMenu } from './parse-spincad-menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths relative to fv1-vscode root
const rootDir = path.resolve(__dirname, '..');
const spincadDesignerDir = path.resolve(rootDir, '../SpinCAD-Designer');
const menuFile = path.join(spincadDesignerDir, 'src/SpinCADBuilder/standard.spincadmenu');
const coreBlocksDir = path.join(rootDir, 'resources/blocks');
const convertedBlocksDir = path.join(rootDir, 'resources/blocks/spincad');

async function run() {
    console.log('--- SpinCAD Block Verification ---');

    // 1. Load Menu
    let menuMap;
    try {
        menuMap = parseMenu(menuFile);
        console.log(`Loaded ${menuMap.size} items from menu.`);
    } catch (e) {
        console.error(`Failed to load menu: ${e.message}`);
        process.exit(1);
    }

    // 2. Scan for ALL ATL files
    const atlMap = new Map(); // type -> metadata

    function scanDir(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                scanDir(fullPath);
            } else if (entry.name.endsWith('.atl')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const parts = content.split('---');
                    if (parts.length < 3) continue;
                    const metadata = JSON.parse(parts[1].trim());
                    metadata.template = parts.slice(2).join('---').trim();
                    metadata._filePath = fullPath;
                    atlMap.set(metadata.type, metadata);
                } catch (e) {
                    console.error(`Error reading ${fullPath}: ${e.message}`);
                }
            }
        }
    }

    scanDir(coreBlocksDir);
    scanDir(convertedBlocksDir);
    console.log(`Found ${atlMap.size} unique block types in ATL files.`);

    // 3. Verify each menu item
    let passCount = 0;
    let failCount = 0;
    let missingCount = 0;

    class MockContext {
        constructor() {
            this.vars = new Map();
            this.ir = [];
            this.initCode = [];
            this.regs = 0;
        }
        setVariable(n, v) { this.vars.set(n, v); }
        getVariable(n) { return this.vars.get(n); }
        allocateRegister() { return `REG${this.regs++}`; }
        getInputRegister() { return `REG${this.regs++}`; }
        allocateMemory(id, size) {
            this.initCode.push(`mem\t${id}\t${Math.floor(size)}`);
            return { name: id, size };
        }
        hasInput() { return true; }
        hasOutput() { return true; }
        getShortId() { return 'b1'; }
        getParameter(b, p) { return 0.5; }
        pushIR(n) { this.ir.push(n); }
        pushInitCode(str) { this.initCode.push(str); }
        getIR() { return this.ir; }
        getCurrentBlock() { return 'test_block'; }
        getBlock() { return { id: 'test_block', parameters: {} }; }
    }

    const primitiveMap = {
        'input': 'input.adc',
        'output': 'output.dac',
        'pot0': 'input.pot',
        'pot1': 'input.pot',
        'pot2': 'input.pot',
        'volume': 'gain.volume', // Assuming we have these or similar
        'distortion': 'effect.distortion',
        'overdrive': 'effect.distortion',
        'phaser': 'effect.phaser',
        'ringmod': 'effect.ringMod',
        'chorus': 'effect.chorus',
        'flanger': 'effect.flanger',
        'reverb': 'effect.reverb',
        'allpass': 'filter.allpass',
        'lpf_rdfx': 'filter.lowpass',
        'hpf_rdfx': 'filter.highpass',
        'shelving_lowpass': 'filter.shelving_low_pass'
    };

    for (const [id, menuInfo] of menuMap.entries()) {
        const displayName = menuInfo.displayName;

        // Try to find the matching metadata
        let metadata = null;

        // Potential type IDs to check
        const candidates = [
            `spincad_${id.toLowerCase()}`,
            `spincad_${id.toLowerCase()}cadblock`,
            `spincad_${id.toLowerCase()}block`,
            `spincad_${id.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
            id.toLowerCase(),
            id
        ];

        for (const candidate of candidates) {
            if (atlMap.has(candidate)) {
                metadata = atlMap.get(candidate);
                break;
            }
        }

        // Try fuzzy name match if still not found
        if (!metadata) {
            const nameSearch = Array.from(atlMap.values()).find(m =>
                m.name.toLowerCase() === displayName.toLowerCase() ||
                (m.type.startsWith('spincad_') && m.type.includes(id.toLowerCase()))
            );
            if (nameSearch) metadata = nameSearch;
        }

        if (!metadata) {
            console.warn(`[MISSING] ${displayName} (ID: ${id})`);
            missingCount++;
            continue;
        }

        // Test compilation
        try {
            const block = {
                id: 'test_block',
                type: metadata.type,
                position: { x: 0, y: 0 },
                parameters: {}
            };
            if (metadata.parameters) {
                for (const param of metadata.parameters) {
                    block.parameters[param.id] = param.default !== undefined ? param.default : 0.5;
                }
            }

            const ctx = new MockContext();
            const template = new BlockTemplate(metadata);
            const nodes = template.generateIR(block, ctx);
            nodes.forEach(n => ctx.pushIR(n));

            const irSections = { header: [], init: [], input: [], main: [], output: [] };
            for (const node of ctx.getIR()) {
                if (node.op.endsWith(':')) {
                    irSections[node.section].push(node.op);
                } else if (node.op === ';') {
                    irSections[node.section].push(`;\t${node.args.join(' ')}`);
                } else {
                    const isDeclaration = ['EQU', 'MEM'].includes(node.op);
                    const separator = isDeclaration ? '\t' : ', ';
                    let line = `${node.op.toLowerCase()}\t${node.args.join(separator)}`;
                    if (node.comment) line += `\t; ${node.comment}`;
                    irSections[node.section].push(line);
                }
            }

            const assembly = [
                ...irSections.header,
                ...irSections.init,
                ...ctx.initCode,
                ...irSections.input,
                ...irSections.main,
                ...irSections.output
            ].join('\n');

            const assembler = new FV1Assembler({ fv1AsmMemBug: true, clampReals: false });
            const result = assembler.assemble(assembly);

            if (result.problems.filter(p => p.isfatal).length > 0) {
                console.error(`[FAIL]    ${displayName} (${path.basename(metadata._filePath)})`);
                result.problems.filter(p => p.isfatal).forEach(e => console.error(`  Line ${e.line}: ${e.message}`));
                failCount++;
            } else {
                console.log(`[PASS]    ${displayName}`);
                passCount++;
            }
        } catch (e) {
            console.error(`[CRASH]   ${displayName}: ${e.message}`);
            failCount++;
        }
    }

    console.log('\n--- Final Verification Summary ---');
    console.log(`Passed:         ${passCount}`);
    console.log(`Failed:         ${failCount}`);
    console.log(`Missing/Skip:   ${missingCount}`);
    console.log('---------------------------------');

    if (failCount > 0) process.exit(1);
    console.log('SUCCESS: All available blocks verified.');
}

run().catch(err => {
    console.error(`Unhandled error: ${err.message}`);
    process.exit(1);
});
