/**
 * Batch Convert SpinCAD Templates
 * Run with node: node convert-spincad.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SpinCADConverter } from './src/blockDiagram/utils/SpinCADConverter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(__dirname, 'SpinCAD/src/SpinCADBuilder');
const targetDir = path.resolve(__dirname, 'resources/blocks');

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

console.log(`Converting templates from ${sourceDir} to ${targetDir}...`);

const files = fs.readdirSync(sourceDir);
let count = 0;

for (const file of files) {
    if (file.endsWith('.spincad')) {
        try {
            const content = fs.readFileSync(path.join(sourceDir, file), 'utf8');
            const definition = SpinCADConverter.convert(content);

            const targetFile = path.join(targetDir, `${definition.type}.json`);
            fs.writeFileSync(targetFile, JSON.stringify(definition, null, 2));
            count++;
        } catch (e) {
            console.error(`Error converting ${file}: ${e}`);
        }
    }
}

console.log(`Successfully converted ${count} templates.`);
