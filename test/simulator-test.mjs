import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { FV1Assembler } from '../out/FV1Assembler.js';
import { FV1Simulator } from '../out/simulator/FV1Simulator.js';
import { FV1AudioProcessor } from '../out/simulator/FV1AudioProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const refDir = path.join(__dirname, 'ref');
    const wavDir = path.join(__dirname, 'wav');
    const spnFileName = 'test.spn';
    const spnPath = path.join(wavDir, spnFileName);

    // Check directories
    if (!fs.existsSync(refDir)) {
        console.error(`Reference directory not found: ${refDir}`);
        process.exit(1);
    }
    if (!fs.existsSync(wavDir)) {
        console.error(`Wav directory not found: ${wavDir}`);
        process.exit(1);
    }

    // 1. Load SPN file
    if (!fs.existsSync(spnPath)) {
        console.error(`SPN file not found: ${spnPath}`);
        process.exit(1);
    }
    console.log(`Reading ${spnFileName}...`);
//    const sourceCode = fs.readFileSync(spnPath, 'utf8');
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

    // 2. Assemble
    console.log('Assembling...');
    const assembler = new FV1Assembler({ fv1AsmMemBug: true, clampReals: true });
    const assemblyResult = assembler.assemble(sourceCode);

    const errors = assemblyResult.problems.filter(p => p.isfatal);
    if (errors.length > 0) {
        console.error('Assembly failed:');
        errors.forEach(e => console.error(`Line ${e.line}: ${e.message}`));
        process.exit(1);
    }

    // 3. Setup Simulator
    console.log('Initializing Simulator...');
    const simulator = new FV1Simulator();
    simulator.loadProgram(assemblyResult.machineCode);

    const audioProcessor = new FV1AudioProcessor(simulator);

    // 4. Find WAV file
    const files = fs.readdirSync(wavDir);
    const wavFile = files.find(f => f.endsWith('.wav') && !f.endsWith('_processed.wav'));

    if (!wavFile) {
        console.error(`No input .wav file found in ${wavDir}`);
        process.exit(1);
    }

    const inputPath = path.join(wavDir, wavFile);
    const outputPath = path.join(wavDir, path.basename(wavFile, '.wav') + '_processed.wav');

    // 5. Process
    console.log(`Processing ${wavFile} -> ${path.basename(outputPath)}...`);
    const startTime = Date.now();
    
    try {
        await audioProcessor.processFile(inputPath, outputPath, 0.5, 0.5, 0.5);
        const duration = (Date.now() - startTime) / 1000;
        console.log(`Completed in ${duration.toFixed(2)}s`);
    } catch (e) {
        console.error('Processing failed:', e);
        process.exit(1);
    }
}

main();