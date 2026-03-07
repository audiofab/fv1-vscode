/**
 * Batch Convert SpinCAD Templates
 * 
 * This script automates the conversion of .spincad files from the SpinCAD-Designer 
 * repository into ATL (.atl) files for use in the FV-1 VS Code extension.
 * 
 * Usage: node scripts/batch-convert-spincad.js [targetDir]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SpinCADConverter } from '../out/blockDiagram/utils/SpinCADConverter.js';
import { parseMenu } from './parse-spincad-menu.js';
import { parseJavaBlock, toATL as toJavaATL } from './convert-spincad-java.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths relative to the fv1-vscode root
const spincadDesignerDir = path.resolve(__dirname, '../../SpinCAD-Designer');
const sourceDir = path.join(spincadDesignerDir, 'src/SpinCADBuilder');
const javaSourceDir = path.join(spincadDesignerDir, 'src/com/holycityaudio/SpinCAD');
const menuFile = path.join(sourceDir, 'standard.spincadmenu');
const defaultTargetDir = path.resolve(__dirname, '../resources/blocks/spincad');

const targetDir = process.argv[2] || defaultTargetDir;

async function run() {
    console.log('--- SpinCAD Batch Conversion ---');

    if (!fs.existsSync(spincadDesignerDir)) {
        console.error(`Error: SpinCAD-Designer directory not found at ${spincadDesignerDir}`);
        console.error('Please ensure the SpinCAD-Designer repository is cloned in the same parent directory as fv1-vscode.');
        process.exit(1);
    }

    if (!fs.existsSync(menuFile)) {
        console.error(`Error: Menu file not found at ${menuFile}`);
        process.exit(1);
    }

    if (!fs.existsSync(targetDir)) {
        console.log(`Creating target directory: ${targetDir}`);
        fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log(`Source: ${sourceDir}`);
    console.log(`Menu:   ${menuFile}`);
    console.log(`Target: ${targetDir}`);
    console.log('');

    console.log('Parsing SpinCAD menu...');
    let menuMap = parseMenu(menuFile);
    console.log(`Found ${menuMap.size} valid blocks in the menu.`);

    console.log('Scanning source directory for .spincad files...');
    const sourceFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.spincad'));
    const fileByNameMap = new Map();
    const fileByIDMap = new Map();

    for (const file of sourceFiles) {
        const filePath = path.join(sourceDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');

        for (const line of lines) {
            const nameMatch = line.match(/^@name\s+"([^"]+)"/);
            if (nameMatch) {
                fileByNameMap.set(nameMatch[1].trim().toLowerCase(), file);
                break;
            }
        }
        fileByIDMap.set(file.replace('.spincad', '').toLowerCase(), file);
    }

    console.log('Scanning Java source directories...');
    const javaSourceDir = path.join(spincadDesignerDir, 'src/com/holycityaudio/SpinCAD');
    const javaGenDir = path.join(spincadDesignerDir, 'src-gen/com/holycityaudio/SpinCAD');

    const javaFileMap = new Map();
    const javaDirs = [
        path.join(javaSourceDir, 'CADBlocks'),
        path.join(javaSourceDir, 'ControlBlocks'),
        path.join(javaGenDir, 'CADBlocks'),
        path.join(javaGenDir, 'ControlBlocks')
    ];

    for (const dir of javaDirs) {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.java'));
        for (const file of files) {
            // Map by multiple possible basenames to be safe
            const base1 = file.replace('CADBlock.java', '').toLowerCase();
            const base2 = file.replace('Block.java', '').toLowerCase();
            const base3 = file.replace('.java', '').toLowerCase();

            if (!javaFileMap.has(base1)) javaFileMap.set(base1, path.join(dir, file));
            if (!javaFileMap.has(base2)) javaFileMap.set(base2, path.join(dir, file));
            if (!javaFileMap.has(base3)) javaFileMap.set(base3, path.join(dir, file));
        }
    }

    let successCount = 0;
    let errorCount = 0;
    let skipCount = 0;

    for (const [id, menuInfo] of menuMap.entries()) {
        // 1. Try .spincad by ID or Name
        let spincadFile = fileByIDMap.get(id) || fileByNameMap.get(menuInfo.displayName.toLowerCase());

        if (spincadFile) {
            const sourcePath = path.join(sourceDir, spincadFile);
            try {
                const content = fs.readFileSync(sourcePath, 'utf8');
                const definition = SpinCADConverter.convert(content, undefined, spincadFile);

                definition.category = menuInfo.category;
                definition.subcategory = menuInfo.subcategory;
                definition.name = menuInfo.displayName;

                if (!definition.type.startsWith('spincad_')) {
                    definition.type = 'spincad_' + definition.type;
                }

                fs.writeFileSync(path.join(targetDir, `${definition.type}.atl`), SpinCADConverter.toATL(definition));
                successCount++;
                continue;
            } catch (e) {
                console.error(`Error converting .spincad ${spincadFile} (${id}): ${e.message}`);
                errorCount++;
                continue;
            }
        }

        // 2. Try Java block
        let javaFile = javaFileMap.get(id);
        if (javaFile) {
            try {
                const content = fs.readFileSync(javaFile, 'utf8');
                const definition = parseJavaBlock(content, path.basename(javaFile), menuInfo);

                if (!definition.type.startsWith('spincad_')) {
                    definition.type = 'spincad_' + definition.type;
                }

                fs.writeFileSync(path.join(targetDir, `${definition.type}.atl`), toJavaATL(definition));
                successCount++;
                continue;
            } catch (e) {
                console.error(`Error converting .java ${path.basename(javaFile)} (${id}): ${e.message}`);
                errorCount++;
                continue;
            }
        }

        console.warn(`Warning: No source file found for: ${menuInfo.displayName} (${id})`);
        skipCount++;
    }

    console.log('');
    console.log('--- Conversion Summary ---');
    console.log(`Successfully converted: ${successCount}`);
    console.log(`Missing/Skipped:        ${skipCount}`);
    console.log(`Errors:                 ${errorCount}`);
    console.log('');

    if (errorCount === 0 && skipCount === 0) {
        console.log('SUCCESS: All 96 menu items converted correctly.');
    } else {
        console.warn(`DONE: Process completed with ${skipCount} skips and ${errorCount} errors.`);
    }
}

run().catch(err => {
    console.error(`Unhandled error: ${err.message}`);
    process.exit(1);
});
