/**
 * Batch Convert SpinCAD Templates
 * Run with node: node convert-spincad.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SpinCADConverter } from '../out/blockDiagram/utils/SpinCADConverter.js';
import { parseMenu } from './parse-spincad-menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(__dirname, '../../SpinCAD-Designer/src/SpinCADBuilder');
const targetDir = 'C:\\_dev\\custom_blocks\\spincad';
const menuFile = path.resolve(__dirname, '../../SpinCAD-Designer/src/SpinCADBuilder/standard.spincadmenu');

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

console.log(`Loading menu from ${menuFile}...`);
const menuMap = parseMenu(menuFile);

console.log(`Converting templates from ${sourceDir} to ${targetDir}...`);

const files = fs.readdirSync(sourceDir);
let count = 0;

for (const file of files) {
    if (file.endsWith('.spincad')) {
        const basename = file.replace('.spincad', '').toLowerCase();

        // Only convert blocks that are in the menu
        if (!menuMap.has(basename)) {
            continue;
        }

        const menuInfo = menuMap.get(basename);

        try {
            const content = fs.readFileSync(path.join(sourceDir, file), 'utf8');
            const definition = SpinCADConverter.convert(content, undefined, file);

            definition.category = menuInfo.category;
            definition.subcategory = menuInfo.subcategory;
            if (menuInfo.displayName) {
                definition.name = menuInfo.displayName;
            }

            if (!definition.type.startsWith('spincad_')) {
                definition.type = 'spincad_' + definition.type;
            }

            const targetFile = path.join(targetDir, `${definition.type}.atl`);
            fs.writeFileSync(targetFile, SpinCADConverter.toATL(definition));
            count++;
        } catch (e) {
            console.error(`Error converting ${file}: ${e}`);
        }
    }
}

console.log(`Successfully converted ${count} templates.`);
