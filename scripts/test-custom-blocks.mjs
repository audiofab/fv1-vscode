import * as fs from 'fs';
import * as path from 'path';
import { FV1Assembler } from '../out/assembler/FV1Assembler.js';
import { BlockTemplate } from '../out/blockDiagram/compiler/BlockTemplate.js';

const targetDir = 'C:\\_dev\\custom_blocks\\spincad';
const files = fs.readdirSync(targetDir);

let passCount = 0;
let failCount = 0;

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

for (const file of files) {
    if (!file.endsWith('.atl')) continue;

    const p = path.join(targetDir, file);
    const content = fs.readFileSync(p, 'utf8');
    const parts = content.split('---');
    if (parts.length < 3) continue;

    const metadata = JSON.parse(parts[1].trim());
    metadata.template = parts.slice(2).join('---').trim();

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

    try {
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

        const assemblyTestBody = [
            ...irSections.header,
            ...irSections.init,
            ...ctx.initCode,
            ...irSections.input,
            ...irSections.main,
            ...irSections.output
        ].join('\n');

        const assembler = new FV1Assembler({ fv1AsmMemBug: true, clampReals: false });
        const result = assembler.assemble(assemblyTestBody);

        const fatalErrors = result.problems.filter(p => p.isfatal);
        if (fatalErrors.length > 0) {
            console.error(`[FAIL] ${file}`);
            fatalErrors.forEach(e => console.error(`  Line ${e.line}: ${e.message}`));
            if (file === 'spincad_output.atl' || file === 'spincad_chorus.atl') {
                console.error('--- INIT CODE DUMP ---');
                console.error(ctx.initCode.join('\n'));
                console.error('--- FULL BODY DUMP ---');
                console.error(assemblyTestBody);
            }
            failCount++;
        } else {
            console.log(`[PASS] ${file}`);
            if (file === 'spincad_threetap.atl' || file === 'spincad_mn3011.atl') {
                console.log(`--- ${file} FULL BODY DUMP ---`);
                console.log(assemblyTestBody);
            }
            passCount++;
        }
    } catch (e) {
        console.error(`[CRASH] ${file}: ${e.message}`);
        failCount++;
    }
}

console.log(`\nAssembly Tests Complete: ${passCount} Passed, ${failCount} Failed.`);
if (failCount > 0) process.exit(1);
