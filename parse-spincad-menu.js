import * as fs from 'fs';
import * as path from 'path';

export function parseMenu(menuFilePath) {
    if (!fs.existsSync(menuFilePath)) {
        throw new Error(`Menu file not found: ${menuFilePath}`);
    }

    const content = fs.readFileSync(menuFilePath, 'utf8');
    const lines = content.split('\n');

    const menuMap = new Map();
    let currentCategory = 'SpinCAD';
    let currentSubcategory = '';

    for (let line of lines) {
        line = line.trim();
        // Ignore comments and empty lines
        if (!line || line.startsWith('//')) {
            continue;
        }

        if (line.startsWith('@menu ')) {
            // Extract menu name
            const match = line.match(/@menu\s+"([^"]+)"/);
            if (match) {
                currentSubcategory = match[1];
            }
        } else if (line.startsWith('@menuitem ')) {
            // Extract item name and block ID
            // Format: @menuitem "Display Name" BlockID
            const match = line.match(/@menuitem\s+"([^"]+)"\s+(\S+)/);
            if (match) {
                const displayName = match[1];
                const blockId = match[2];
                menuMap.set(blockId.toLowerCase(), {
                    id: blockId,
                    displayName: displayName,
                    category: 'SpinCAD',
                    subcategory: currentSubcategory
                });
            }
        }
    }

    return menuMap;
}
