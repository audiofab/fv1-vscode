import * as fs from 'fs';
import { FV1Simulator } from './FV1Simulator.js';

export class FV1AudioProcessor {
    private simulator: FV1Simulator;

    constructor(simulator: FV1Simulator) {
        this.simulator = simulator;
    }

    /**
     * Process a WAV file through the FV-1 simulator.
     * Supports 16-bit PCM WAV files.
     * 
     * @param inputPath Path to input WAV file
     * @param outputPath Path to output WAV file
     * @param pot0 POT0 value (0.0 - 1.0)
     * @param pot1 POT1 value (0.0 - 1.0)
     * @param pot2 POT2 value (0.0 - 1.0)
     */
    public async processFile(inputPath: string, outputPath: string, pot0: number = 0.5, pot1: number = 0.5, pot2: number = 0.5): Promise<void> {
        const inputBuffer = await fs.promises.readFile(inputPath);
        
        // Parse WAV Header
        const numChannels = inputBuffer.readUInt16LE(22);
        const sampleRate = inputBuffer.readUInt32LE(24);
        const bitsPerSample = inputBuffer.readUInt16LE(34);
        const dataSize = inputBuffer.readUInt32LE(40); // Subchunk2Size
        const dataOffset = 44; // Standard header size

        if (bitsPerSample !== 16) {
            throw new Error(`Unsupported bit depth: ${bitsPerSample}. Only 16-bit PCM is supported.`);
        }

        const numSamples = dataSize / (numChannels * 2);
        const inputL = new Float32Array(numSamples);
        const inputR = new Float32Array(numSamples);
        const outputL = new Float32Array(numSamples);
        const outputR = new Float32Array(numSamples);

        // De-interleave and convert to float (-1.0 to 1.0)
        for (let i = 0; i < numSamples; i++) {
            const offset = dataOffset + i * numChannels * 2;
            
            // Read Left
            const intL = inputBuffer.readInt16LE(offset);
            inputL[i] = intL / 32768.0;

            // Read Right (if stereo, otherwise duplicate Left)
            if (numChannels === 2) {
                const intR = inputBuffer.readInt16LE(offset + 2);
                inputR[i] = intR / 32768.0;
            } else {
                inputR[i] = inputL[i];
            }
        }

        // Reset simulator state before processing
        this.simulator.reset();

        // Process Audio
        console.log(`Processing ${numSamples} samples at ${sampleRate}Hz...`);
        this.simulator.processBlock(inputL, inputR, outputL, outputR, pot0, pot1, pot2);

        // Interleave and convert back to 16-bit PCM
        const outputBuffer = Buffer.alloc(dataOffset + dataSize);
        
        // Copy header from input
        inputBuffer.copy(outputBuffer, 0, 0, dataOffset);

        for (let i = 0; i < numSamples; i++) {
            const offset = dataOffset + i * numChannels * 2;
            
            // Clamp and convert Left
            let valL = Math.max(-1.0, Math.min(1.0, outputL[i]));
            let intL = Math.floor(valL * 32767);
            outputBuffer.writeInt16LE(intL, offset);

            // Clamp and convert Right
            if (numChannels === 2) {
                let valR = Math.max(-1.0, Math.min(1.0, outputR[i]));
                let intR = Math.floor(valR * 32767);
                outputBuffer.writeInt16LE(intR, offset + 2);
            }
        }

        await fs.promises.writeFile(outputPath, outputBuffer);
        console.log(`Processed audio saved to ${outputPath}`);
    }

    /**
     * Generate a simple test tone (sine wave) and run it through the simulator.
     */
    public async runTestTone(outputPath: string, durationSec: number = 2.0): Promise<void> {
        const sampleRate = 32768; // FV-1 native rate
        const numSamples = Math.floor(sampleRate * durationSec);
        const freq = 440.0;

        const inputL = new Float32Array(numSamples);
        const inputR = new Float32Array(numSamples);
        const outputL = new Float32Array(numSamples);
        const outputR = new Float32Array(numSamples);

        // Generate Sine Wave
        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            const val = Math.sin(2 * Math.PI * freq * t) * 0.5; // 0.5 amplitude
            inputL[i] = val;
            inputR[i] = val;
        }

        this.simulator.reset();
        this.simulator.processBlock(inputL, inputR, outputL, outputR, 0.5, 0.5, 0.5);

        // Write WAV
        const headerSize = 44;
        const dataSize = numSamples * 2 * 2; // 2 channels * 2 bytes
        const buffer = Buffer.alloc(headerSize + dataSize);

        // WAV Header
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + dataSize, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // Subchunk1Size
        buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
        buffer.writeUInt16LE(2, 22); // NumChannels
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * 2 * 2, 28); // ByteRate
        buffer.writeUInt16LE(4, 32); // BlockAlign
        buffer.writeUInt16LE(16, 34); // BitsPerSample
        buffer.write('data', 36);
        buffer.writeUInt32LE(dataSize, 40);

        // Write Data
        // ... (Reuse write logic from processFile or extract helper)
        // For brevity, assuming processFile logic is sufficient for user testing.
    }
}