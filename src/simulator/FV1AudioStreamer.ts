import * as fs from 'fs';

/**
 * Handles streaming samples from a 16-bit PCM WAV file.
 */
export class FV1AudioStreamer {
    private buffer: Buffer | null = null;
    private sampleRate: number = 32768;
    private numChannels: number = 2;
    private numSamples: number = 0;
    private currentSample: number = 0;
    private dataOffset: number = 44;
    private lastL: number = 0;
    private lastR: number = 0;

    /**
     * Loads a WAV file into memory.
     */
    public async loadWav(path: string): Promise<void> {
        if (!fs.existsSync(path)) {
            throw new Error(`WAV file not found: ${path}`);
        }
        this.buffer = await fs.promises.readFile(path);

        // Basic RIFF/WAV parsing
        const riff = this.buffer.toString('ascii', 0, 4);
        if (riff !== 'RIFF') throw new Error('Not a valid RIFF file');

        const wave = this.buffer.toString('ascii', 8, 12);
        if (wave !== 'WAVE') throw new Error('Not a valid WAVE file');

        this.numChannels = this.buffer.readUInt16LE(22);
        this.sampleRate = this.buffer.readUInt32LE(24);
        const bitsPerSample = this.buffer.readUInt16LE(34);

        if (bitsPerSample !== 16) {
            throw new Error(`Only 16-bit PCM WAV files are supported. Found: ${bitsPerSample}-bit`);
        }

        // Find data chunk (it's not always at offset 44)
        let offset = 12;
        while (offset < this.buffer.length) {
            const chunkId = this.buffer.toString('ascii', offset, offset + 4);
            const chunkSize = this.buffer.readUInt32LE(offset + 4);
            if (chunkId === 'data') {
                this.dataOffset = offset + 8;
                this.numSamples = chunkSize / (this.numChannels * 2);
                break;
            }
            offset += 8 + chunkSize;
        }

        this.currentSample = 0;
        console.log(`Loaded WAV: ${path}, ${this.sampleRate}Hz, ${this.numChannels} channels, ${this.numSamples} samples`);
    }

    /**
     * Gets the next left/right sample pair.
     * Returns 0s if end of file reached (or loops).
     */
    public getNextSample(): { l: number, r: number } {
        if (!this.buffer || this.numSamples === 0) {
            return { l: 0, r: 0 };
        }

        if (this.currentSample >= this.numSamples) {
            this.currentSample = 0; // Loop the audio
        }

        const offset = this.dataOffset + this.currentSample * this.numChannels * 2;
        if (offset + (this.numChannels * 2) > this.buffer.length) {
            this.currentSample = 0;
            return { l: 0, r: 0 };
        }

        const intL = this.buffer.readInt16LE(offset);
        this.lastL = intL / 32768.0;

        this.lastR = this.lastL;
        if (this.numChannels === 2) {
            const intR = this.buffer.readInt16LE(offset + 2);
            this.lastR = intR / 32768.0;
        }

        this.currentSample++;
        return { l: this.lastL, r: this.lastR };
    }

    public getLastSample(): { l: number, r: number } {
        return { l: this.lastL, r: this.lastR };
    }

    public reset() {
        this.currentSample = 0;
    }

    public getSampleRate(): number {
        return this.sampleRate;
    }

    public isLoaded(): boolean {
        return this.buffer !== null;
    }

    public getNumSamples(): number {
        return this.numSamples;
    }

    public getCurrentSample(): number {
        return this.currentSample;
    }
}
