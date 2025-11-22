import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FV1Assembler } from '../out/FV1Assembler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Simple assertion helper
 */
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
}

/**
 * Parsed reference data from SpinASM output files
 */
class StatsFileParser {
    parse(content) {
        const labels = new Map();
        const equates = new Map();
        const memoryMap = [];
        
        const lines = content.split('\n');
        let section = 'none';
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            if (trimmed === 'NO ERRORS') continue;
            
            if (trimmed === 'LABELS:') {
                section = 'labels';
                continue;
            } else if (trimmed === 'EQUATES:') {
                section = 'equates';
                continue;
            } else if (trimmed === 'MEMORY MAP:') {
                section = 'memory';
                continue;
            }
            
            if (!trimmed) continue;
            
            switch (section) {
                case 'labels':
                    this.parseLabel(trimmed, labels);
                    break;
                case 'equates':
                    this.parseEquate(trimmed, equates);
                    break;
                case 'memory':
                    this.parseMemory(trimmed, memoryMap);
                    break;
            }
        }
        
        return { labels, equates, memoryMap };
    }
    
    parseLabel(line, labels) {
        const match = line.match(/LOC:\s*(\d+)\s+Label:\s*(\w+)/);
        if (match) {
            labels.set(match[2], parseInt(match[1], 10));
        }
    }
    
    parseEquate(line, equates) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
            equates.set(parts[0], parts[1]);
        }
    }
    
    parseMemory(line, memoryMap) {
        if (line.includes('SRAM Memory') || line.includes('Unallocated')) return;
        
        const match = line.match(/(\w+)\s*:0x([0-9A-F]+)\s*-\s*0x([0-9A-F]+)\s+size:0x([0-9A-F]+)/i);
        if (match) {
            memoryMap.push({
                name: match[1],
                start: parseInt(match[2], 16),
                end: parseInt(match[3], 16),
                size: parseInt(match[4], 16)
            });
        }
    }
}

class SpnasmFileParser {
    parse(content) {
        const machineCode = [];
        const lines = content.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            const parts = trimmed.split(/\s+/);
            if (parts.length < 2) continue;
            
            const address = parseInt(parts[0], 10);
            if (isNaN(address)) continue;
            
            if (parts[1].endsWith(':')) {
                machineCode.push({ address, encoding: -1, label: parts[1].slice(0, -1) });
            } else {
                const encoding = parseInt(parts[1], 16);
                machineCode.push({ address, encoding });
            }
        }
        
        return machineCode;
    }
}

// Predefined symbols that should be excluded from equate comparison
const PREDEFINED_SYMBOLS = new Set([
    'SIN0_RATE', 'SIN0_RANGE', 'SIN1_RATE', 'SIN1_RANGE',
    'RMP0_RATE', 'RMP0_RANGE', 'RMP1_RATE', 'RMP1_RANGE',
    'POT0', 'POT1', 'POT2', 'ADCL', 'ADCR', 'DACL', 'DACR', 'ADDR_PTR',
    'REG0', 'REG1', 'REG2', 'REG3', 'REG4', 'REG5', 'REG6', 'REG7',
    'REG8', 'REG9', 'REG10', 'REG11', 'REG12', 'REG13', 'REG14', 'REG15',
    'REG16', 'REG17', 'REG18', 'REG19', 'REG20', 'REG21', 'REG22', 'REG23',
    'REG24', 'REG25', 'REG26', 'REG27', 'REG28', 'REG29', 'REG30', 'REG31',
    'SIN0', 'SIN1', 'RMP0', 'RMP1', 'COS0', 'COS1',
    'RDA', 'SOF', 'RDAL', 'SIN', 'COS', 'REG', 'COMPC', 'COMPA', 'RPTR2', 'NA',
    'RUN', 'ZRC', 'ZRO', 'GEZ', 'NEG'
]);

/**
 * Run tests for a single .spn file
 */
function testAssembler(testName, refDir) {
    console.log(`\nTesting ${testName}...`);
    
    // Load reference data
    const spnPath = path.join(refDir, `${testName}.spn`);
    const statsPath = path.join(refDir, `${testName}.stats`);
    const spnasmPath = path.join(refDir, `${testName}.spnasm`);
    
    // Read source with proper encoding detection (handle UTF-16 LE with or without BOM)
    const sourceBuffer = fs.readFileSync(spnPath);
    let sourceCode;
    if (sourceBuffer[0] === 0xFF && sourceBuffer[1] === 0xFE) {
        // UTF-16 LE with BOM
        sourceCode = sourceBuffer.toString('utf16le');
    } else if (sourceBuffer.length >= 4 && sourceBuffer[1] === 0x00 && sourceBuffer[3] === 0x00) {
        // Likely UTF-16 LE without BOM (every other byte is null for ASCII range)
        sourceCode = sourceBuffer.toString('utf16le');
    } else {
        sourceCode = sourceBuffer.toString('utf-8');
    }
    
    const statsContent = fs.readFileSync(statsPath, 'utf-8');
    const spnasmContent = fs.readFileSync(spnasmPath, 'utf-8');
    
    const statsParser = new StatsFileParser();
    const spnasmParser = new SpnasmFileParser();
    
    const reference = {
        ...statsParser.parse(statsContent),
        machineCode: spnasmParser.parse(spnasmContent)
    };
    
    // Assemble with our assembler
    const assembler = new FV1Assembler({fv1AsmMemBug: true, clampReals: true});
    const result = assembler.assemble(sourceCode);
    
    // Check for fatal errors
    const fatalErrors = result.problems.filter(p => p.isfatal);
    assert(fatalErrors.length === 0, 
        `${testName}: Assembler reported fatal errors:\n${fatalErrors.map(e => `Line ${e.line}: ${e.message}`).join('\n')}`);
    
    // Validate labels
    console.log(`  Validating labels...`);
    for (const [label, refLoc] of reference.labels.entries()) {
        assert(result.labels.has(label), `${testName}: Label '${label}' not found`);
        assertEqual(result.labels.get(label).instructionLine, refLoc, 
            `${testName}: Label '${label}' location mismatch`);
    }
    for (const [label] of result.labels.entries()) {
        assert(reference.labels.has(label), 
            `${testName}: Unexpected label '${label}'`);
    }
    
    // Validate equates
    console.log(`  Validating equates...`);
    const actualEquates = new Map();
    for (const sym of result.symbols) {
        if (!PREDEFINED_SYMBOLS.has(sym.name)) {
            actualEquates.set(sym.name, sym.value);
        }
    }
    for (const [name, refValue] of reference.equates.entries()) {
        assert(actualEquates.has(name), `${testName}: Equate '${name}' not found`);
        const actualValue = parseFloat(actualEquates.get(name));
        const expectedValue = parseFloat(refValue);
        assertEqual(actualValue, expectedValue, 
            `${testName}: Equate '${name}' value mismatch`);
    }
    for (const [name] of actualEquates.entries()) {
        assert(reference.equates.has(name), 
            `${testName}: Unexpected equate '${name}'`);
    }
    
    // Validate memory map
    console.log(`  Validating memory map...`);
    assertEqual(result.memories.length, reference.memoryMap.length, 
        `${testName}: Memory block count mismatch`);
    for (let i = 0; i < reference.memoryMap.length; i++) {
        const refBlock = reference.memoryMap[i];
        const actualBlock = result.memories[i];
        
        assertEqual(actualBlock.name.toUpperCase(), refBlock.name.toUpperCase(), 
            `${testName}: Memory block ${i} name mismatch`);
        assertEqual(actualBlock.start, refBlock.start, 
            `${testName}: Memory '${refBlock.name}' start mismatch`);
        assertEqual(actualBlock.end, refBlock.end, 
            `${testName}: Memory '${refBlock.name}' end mismatch`);
        assertEqual(actualBlock.size, refBlock.size, 
            `${testName}: Memory '${refBlock.name}' size mismatch`);
    }
    
    // Validate machine code
    console.log(`  Validating machine code...`);
    assertEqual(result.machineCode.length, 128, 
        `${testName}: Machine code should be 128 instructions`);
    
    const refInstructions = reference.machineCode.filter(line => line.encoding !== -1);
    for (const refLine of refInstructions) {
        const actualEncoding = result.machineCode[refLine.address];
        assertEqual(actualEncoding, refLine.encoding, 
            `${testName}: Instruction ${refLine.address} mismatch: expected 0x${refLine.encoding.toString(16).toUpperCase().padStart(8, '0')}, got 0x${actualEncoding.toString(16).toUpperCase().padStart(8, '0')}`);
    }
    
    console.log(`  ✓ ${testName} passed`);
}

/**
 * Main test runner
 */
function main() {
    const refDir = path.join(__dirname, 'ref');
    
    // Find all .spn files
    const files = fs.readdirSync(refDir);
    const testCases = files
        .filter(f => f.endsWith('.spn'))
        .map(f => path.basename(f, '.spn'));
    
    console.log(`\n=== FV1 Assembler Tests ===`);
    console.log(`Found ${testCases.length} test case(s)\n`);
    
    let passed = 0;
    let failed = 0;
    
    for (const testName of testCases) {
        try {
            testAssembler(testName, refDir);
            passed++;
        } catch (error) {
            console.error(`  ✗ ${testName} FAILED: ${error.message}`);
            failed++;
        }
    }
    
    console.log(`\n=== Results ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${testCases.length}\n`);
    
    process.exit(failed > 0 ? 1 : 0);
}

main();
