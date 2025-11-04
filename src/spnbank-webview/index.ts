/**
 * FV-1 Bank Editor - Webview Entry Point
 */

// Get the VS Code API
declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

interface SlotData {
    slot: number;
    path: string;
}

interface BankData {
    name?: string;
    slots: SlotData[];
}

let bankData: BankData = {
    name: '',
    slots: new Array(8).fill(null).map((_, i) => ({ slot: i + 1, path: '' }))
};

// Listen for messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.type) {
        case 'init':
        case 'update':
            bankData = message.data;
            render();
            break;
    }
});

function render() {
    const container = document.querySelector('.slots-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Ensure we have exactly 8 slots
    const slots = bankData.slots.slice();
    while (slots.length < 8) {
        slots.push({ slot: slots.length + 1, path: '' });
    }
    
    // Sort by slot number
    slots.sort((a, b) => a.slot - b.slot);
    
    slots.forEach(slot => {
        const slotEl = document.createElement('div');
        slotEl.className = `slot ${slot.path ? 'assigned' : ''}`;
        slotEl.dataset.slot = String(slot.slot);
        
        // Slot number
        const numberEl = document.createElement('div');
        numberEl.className = 'slot-number';
        numberEl.textContent = `Program ${slot.slot}`;
        slotEl.appendChild(numberEl);
        
        // Slot content
        const contentEl = document.createElement('div');
        contentEl.className = 'slot-content';
        
        if (slot.path) {
            // Icon
            const iconEl = document.createElement('div');
            iconEl.className = 'slot-icon';
            iconEl.textContent = '📄';
            contentEl.appendChild(iconEl);
            
            // Path (clickable)
            const pathEl = document.createElement('div');
            pathEl.className = 'slot-path';
            pathEl.textContent = slot.path;
            pathEl.onclick = () => {
                vscode.postMessage({ type: 'openFile', slotPath: slot.path });
            };
            contentEl.appendChild(pathEl);
        } else {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'slot-empty';
            emptyEl.textContent = 'Drag a file here or create new:';
            contentEl.appendChild(emptyEl);
            
            // Create new file buttons
            const createButtonsEl = document.createElement('div');
            createButtonsEl.className = 'create-buttons';
            
            const createSpnBtn = document.createElement('button');
            createSpnBtn.className = 'create-file-button';
            createSpnBtn.textContent = 'New .spn';
            createSpnBtn.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'createNewFile', slotNumber: slot.slot, fileType: 'spn' });
            };
            createButtonsEl.appendChild(createSpnBtn);
            
            const createDiagramBtn = document.createElement('button');
            createDiagramBtn.className = 'create-file-button';
            createDiagramBtn.textContent = 'New .spndiagram';
            createDiagramBtn.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'createNewFile', slotNumber: slot.slot, fileType: 'spndiagram' });
            };
            createButtonsEl.appendChild(createDiagramBtn);
            
            contentEl.appendChild(createButtonsEl);
        }
        
        slotEl.appendChild(contentEl);
        
        // Actions
        const actionsEl = document.createElement('div');
        actionsEl.className = 'slot-actions';
        
        if (slot.path) {
            const programBtn = document.createElement('button');
            programBtn.className = 'slot-button primary';
            programBtn.textContent = 'Program this slot';
            programBtn.onclick = () => programSlot(slot.slot);
            actionsEl.appendChild(programBtn);
            
            const clearBtn = document.createElement('button');
            clearBtn.className = 'slot-button secondary';
            clearBtn.textContent = 'Clear';
            clearBtn.onclick = () => clearSlot(slot.slot);
            actionsEl.appendChild(clearBtn);
        }
        
        slotEl.appendChild(actionsEl);
        
        // Drag and drop handlers
        slotEl.addEventListener('dragover', handleDragOver);
        slotEl.addEventListener('dragleave', handleDragLeave);
        slotEl.addEventListener('drop', handleDrop);
        
        container.appendChild(slotEl);
    });
}

function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).classList.add('drag-over');
}

function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).classList.remove('drag-over');
}

function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    const slotEl = e.currentTarget as HTMLElement;
    slotEl.classList.remove('drag-over');
    
    const slotNumber = parseInt(slotEl.dataset.slot || '0', 10);
    if (!slotNumber) return;
    
    // Try to get VS Code URI data first (internal drag from Explorer)
    const uriListData = e.dataTransfer?.getData('text/uri-list');
    if (uriListData) {
        const uris = uriListData.split('\n').filter(u => u.trim());
        if (uris.length > 0) {
            const uri = uris[0].trim();
            // Extract just the filename from the URI
            const match = uri.match(/[^/\\]+$/);
            if (match) {
                const fileName = match[0];
                
                // Check if it's a .spn or .spndiagram file
                if (!fileName.endsWith('.spn') && !fileName.endsWith('.spndiagram')) {
                    alert('Only .spn and .spndiagram files can be assigned to slots');
                    return;
                }
                
                // Update the slot with just the filename
                assignSlot(slotNumber, fileName);
                return;
            }
        }
    }
    
    // Fallback to file list (external drag)
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
        const file = files[0];
        const fileName = file.name;
        
        // Check if it's a .spn or .spndiagram file
        if (!fileName.endsWith('.spn') && !fileName.endsWith('.spndiagram')) {
            alert('Only .spn and .spndiagram files can be assigned to slots');
            return;
        }
        
        // Update the slot
        assignSlot(slotNumber, fileName);
    }
}

function assignSlot(slotNumber: number, filePath: string) {
    // Update the bank data
    const updatedSlots = bankData.slots.map(slot =>
        slot.slot === slotNumber ? { ...slot, path: filePath } : slot
    );
    
    const updatedData: BankData = {
        ...bankData,
        slots: updatedSlots
    };
    
    // Send update to extension
    vscode.postMessage({ type: 'update', data: updatedData });
}

function clearSlot(slotNumber: number) {
    assignSlot(slotNumber, '');
}

function programSlot(slotNumber: number) {
    // Send program request to extension
    vscode.postMessage({ type: 'programSlot', slotNumber });
}

// Set up event listeners for header buttons
document.addEventListener('DOMContentLoaded', () => {
    const programBankBtn = document.getElementById('programBankBtn');
    if (programBankBtn) {
        programBankBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'programBank' });
        });
    }
    
    const exportToHexBtn = document.getElementById('exportToHexBtn');
    if (exportToHexBtn) {
        exportToHexBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'exportToHex' });
        });
    }
});

// Initial render
console.log('[SpnBank Webview] Script loaded');
