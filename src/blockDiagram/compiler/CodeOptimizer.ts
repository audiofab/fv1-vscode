/**
 * Code Optimizer
 * Post-processing optimizations for generated FV-1 assembly code
 */

export interface OptimizationResult {
    code: string[];
    optimizationsApplied: number;
    details: string[];
}

export class CodeOptimizer {
    /**
     * Apply all optimizations to generated code
     */
    optimize(code: string[]): OptimizationResult {
        let optimizedCode = code;
        let totalOptimizations = 0;
        const details: string[] = [];
        
        // Optimization 1: Ensure accumulator is cleared after input section
        const inputClearResult = this.ensureAccumulatorClearedAfterInput(optimizedCode);
        optimizedCode = inputClearResult.code;
        if (inputClearResult.applied) {
            totalOptimizations++;
            details.push(inputClearResult.detail);
        }
        
        // Optimization 2: Accumulator forwarding (removes wrax k_0 + rdax k_1 pairs)
        const beforeForwarding = optimizedCode.length;
        optimizedCode = this.optimizeAccumulatorForwarding(optimizedCode);
        const forwardingCount = beforeForwarding - optimizedCode.length;
        if (forwardingCount > 0) {
            totalOptimizations += forwardingCount;
            details.push(`Optimized ${forwardingCount} accumulator forwarding pattern(s)`);
        }
        
        return {
            code: optimizedCode,
            optimizationsApplied: totalOptimizations,
            details
        };
    }
    
    /**
     * Optimization 1: Ensure accumulator is cleared after input section
     * 
     * Finds the "; Input Section" marker and ensures the last instruction
     * before "; Main Program" clears the accumulator.
     */
    private ensureAccumulatorClearedAfterInput(code: string[]): { code: string[], applied: boolean, detail: string } {
        // Find the input section start and main section start
        let inputSectionStart = -1;
        let mainSectionStart = -1;
        
        for (let i = 0; i < code.length; i++) {
            const line = code[i].trim();
            if (line === '; Input Section') {
                inputSectionStart = i;
            } else if (line === '; Main Program') {
                mainSectionStart = i;
                break;
            }
        }
        
        // If we don't have both sections, skip this optimization
        if (inputSectionStart === -1 || mainSectionStart === -1) {
            return { code, applied: false, detail: '' };
        }
        
        // Find the last instruction in the input section
        let lastInstructionIndex = -1;
        for (let i = mainSectionStart - 1; i > inputSectionStart; i--) {
            const trimmed = code[i].trim();
            if (trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('---')) {
                lastInstructionIndex = i;
                break;
            }
        }
        
        if (lastInstructionIndex === -1) {
            // No instructions in input section, add CLR before main section
            const newCode = [...code];
            newCode.splice(mainSectionStart, 0, 'clr    ; Clear accumulator (optimization)');
            return { 
                code: newCode, 
                applied: true, 
                detail: 'Added CLR after input section (no instructions found)' 
            };
        }
        
        const lastInstruction = code[lastInstructionIndex].trim();
        
        // Check if it's a WRAX instruction with a coefficient
        const wraxMatch = lastInstruction.match(/^wrax\s+(\w+),\s*(.+?)(?:\s*;.*)?$/i);
        
        if (wraxMatch) {
            const register = wraxMatch[1];
            const coefficient = wraxMatch[2].trim();
            
            // If coefficient is not already zero, change it to zero
            if (coefficient !== 'k_0' && coefficient !== '0' && coefficient !== '0.0') {
                const newCode = [...code];
                const comment = lastInstruction.includes(';') ? 
                    lastInstruction.substring(lastInstruction.indexOf(';')) : '';
                newCode[lastInstructionIndex] = `wrax\t${register},\t0${comment ? '\t' + comment : ''}\t; Optimized: clear accumulator`;
                return { 
                    code: newCode, 
                    applied: true, 
                    detail: `Changed wrax coefficient to 0 for accumulator clear (was ${coefficient})` 
                };
            }
            // If already zero, accumulator is cleared - no action needed
            return { code, applied: false, detail: '' };
        } else {
            // Last instruction doesn't clear accumulator, add CLR
            const newCode = [...code];
            newCode.splice(lastInstructionIndex + 1, 0, 'clr    ; Clear accumulator (optimization)');
            return { 
                code: newCode, 
                applied: true, 
                detail: 'Added CLR after input section' 
            };
        }
    }
    
    /**
     * Optimization 2: Accumulator forwarding
     * 
     * Replaces the pattern:
     *   wrax <SYMBOL>, k_0
     *   rdax <SYMBOL>, k_1
     * 
     * With:
     *   wrax <SYMBOL>, k_1  ; Optimized: accumulator forwarded
     * 
     * This eliminates the unnecessary clear + reload when the value is already in ACC.
     */
    private optimizeAccumulatorForwarding(code: string[]): string[] {
        if (code.length < 2) {
            return code;
        }
        
        const optimized: string[] = [];
        let i = 0;
        
        while (i < code.length) {
            const currentLine = code[i].trim();
            
            // Check if this is a WRAX instruction with k_0
            const wraxMatch = currentLine.match(/^wrax\s+(\w+),\s*(k_0|0|0\.0)(?:\s*;.*)?$/i);
            
            if (wraxMatch && i + 1 < code.length) {
                const wraxRegister = wraxMatch[1];
                
                // Look ahead for the next non-comment, non-empty line
                let nextInstructionIndex = i + 1;
                while (nextInstructionIndex < code.length) {
                    const nextTrimmed = code[nextInstructionIndex].trim();
                    if (nextTrimmed && !nextTrimmed.startsWith(';')) {
                        break;
                    }
                    nextInstructionIndex++;
                }
                
                if (nextInstructionIndex < code.length) {
                    const nextLine = code[nextInstructionIndex].trim();
                    
                    // Check if next instruction is RDAX of the same register with k_1
                    const rdaxMatch = nextLine.match(/^rdax\s+(\w+),\s*(k_1|1|1\.0)(?:\s*;.*)?$/i);
                    
                    if (rdaxMatch && rdaxMatch[1] === wraxRegister) {
                        // Found the pattern! Optimize it
                        
                        // Keep the original wrax line as a comment
                        optimized.push(`; ${code[i]}\t`);
                        
                        // Add the optimized wrax with k_one coefficient
                        const existingComment = currentLine.includes(';') ? 
                            currentLine.substring(currentLine.indexOf(';')) : '';
                        optimized.push(`wrax\t${wraxRegister},\t${rdaxMatch[2].trim()}${existingComment ? '\t' + existingComment : ''}\t; Optimization: accumulator forwarded`);
                        
                        // Add any comments between wrax and rdax
                        for (let j = i + 1; j < nextInstructionIndex; j++) {
                            optimized.push(code[j]);
                        }
                        
                        // Keep the original rdax line as a comment
                        optimized.push(`; ${code[nextInstructionIndex]}\t; rdax not needed with accumulator forwarding optimization`);
                        
                        // Skip past both instructions
                        i = nextInstructionIndex + 1;
                        continue;
                    }
                }
            }
            
            // No optimization applied, keep the line as-is
            optimized.push(code[i]);
            i++;
        }
        
        return optimized;
    }
}
