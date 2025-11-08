/**
 * Sticky Note block - for adding documentation and comments to block diagrams
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext, ValidationContext, ValidationResult } from '../../types/Block.js';

export class StickyNoteBlock extends BaseBlock {
    readonly type = 'other.stickynote';
    readonly category = 'Utility';
    readonly name = 'Sticky Note';
    readonly description = 'Add documentation comments to your diagram';
    readonly color = '#FFEB3B'; // Yellow sticky note color
    readonly width = 120;
    
    constructor() {
        super();
        
        // No inputs or outputs - this is just for documentation
        this._inputs = [];
        this._outputs = [];
        
        // Text parameter for the note content
        this._parameters = [
            {
                id: 'text',
                name: 'Note',
                type: 'string',
                default: 'Add your notes here...',
                multiline: true,
                description: 'Text content for the sticky note. Will be added as comments in the assembly output.'
            }
        ];
        
        // Make it square-ish like a sticky note (180x180)
        this.autoCalculateHeight();
    }
    
    /**
     * Override to make sticky notes square
     */
    protected calculateMinHeight(): number {
        return 120; // Match width for square appearance
    }

    /**
     * Display a preview of the note text on the block
     * Show only what fits in the 120x120 square
     */
    getCustomLabel(parameters: Record<string, any>): string | null {
        const text = parameters['text'] ?? 'Add your notes here...';
        // Limit to ~20 characters per line, ~6 lines (to fit in 120x120)
        const maxChars = 20 * 6; // ~120 chars total
        if (text.length > maxChars) {
            return text.substring(0, maxChars - 3) + '...';
        }
        return text;
    }

    generateCode(ctx: CodeGenContext): void {
        const text = this.getParameterValue<string>(ctx, this.type, 'text', '');
        
        if (!text || text.trim() === '' || text === 'Add your notes here...') {
            return; // Don't add empty notes
        }
        
        // Add the note text as comments in the header section
        const lines = text.split('\n');
        ctx.pushHeaderComment(';');
        for (const line of lines) {
            // Wrap long lines at 80 characters
            if (line.length <= 76) { // 76 = 80 - "; " - "  "
                ctx.pushHeaderComment(`;   ${line}`);
            } else {
                // Split long lines
                const words = line.split(' ');
                let currentLine = '';
                for (const word of words) {
                    if ((currentLine + ' ' + word).length <= 76) {
                        currentLine += (currentLine ? ' ' : '') + word;
                    } else {
                        if (currentLine) {
                            ctx.pushHeaderComment(`;   ${currentLine}`);
                        }
                        currentLine = word;
                    }
                }
                if (currentLine) {
                    ctx.pushHeaderComment(`;   ${currentLine}`);
                }
            }
        }
        ctx.pushHeaderComment(';');
    }
    
    validate(ctx: ValidationContext): ValidationResult {
        // Sticky notes are always valid - they don't affect the audio processing
        return { valid: true };
    }
}
