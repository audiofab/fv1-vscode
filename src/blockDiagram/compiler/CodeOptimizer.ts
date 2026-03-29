/**
 * Code Optimizer
 * Post-processing optimizations for generated FV-1 assembly code
 */

export enum OptimizationLevel {
    None = 0,
    Standard = 1,
    Aggressive = 2
}

export interface OptimizationResult {
    code: string[];
    optimizationsApplied: number;
    details: string[];
}

export class CodeOptimizer {
    /**
     * Apply all optimizations to generated code
     */
    optimize(code: string[], level: OptimizationLevel = OptimizationLevel.Aggressive): OptimizationResult {
        if (level === OptimizationLevel.None) {
            return { code, optimizationsApplied: 0, details: ['Optimization level 0 (None) selected.'] };
        }

        let optimizedCode = [...code];
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
        // This is the primary move-pruning pass (Standard Level 1)
        const beforeForwarding = optimizedCode.length;
        optimizedCode = this.optimizeAccumulatorForwarding(optimizedCode);
        const forwardingCount = beforeForwarding - optimizedCode.length;
        if (forwardingCount > 0) {
            totalOptimizations += forwardingCount;
            details.push(`Optimized ${forwardingCount} accumulator forwarding pattern(s)`);
        }

        // Optimization 3: Dead Store Elimination (Aggressive Level 2)
        if (level >= OptimizationLevel.Aggressive) {
            const beforeDSE = optimizedCode.length;
            optimizedCode = this.optimizeDeadStoreElimination(optimizedCode);
            const dseCount = beforeDSE - optimizedCode.length;
            if (dseCount > 0) {
                totalOptimizations += dseCount;
                details.push(`Eliminated ${dseCount} dead store instruction(s) (Level 2)`);
            }
        }

        // Optimization 4: Prune unused registers
        const unusedRegResult = this.optimizeUnusedRegisters(optimizedCode);
        optimizedCode = unusedRegResult.code;
        if (unusedRegResult.applied) {
            totalOptimizations += unusedRegResult.count;
            details.push(`Pruned ${unusedRegResult.count} unused register declaration(s)`);
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
                    // Only optimize if they match exactly
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

    /**
     * Optimization 3: Dead Store Elimination (Level 2)
     * 
     * Identifies wrax instructions whose written register is NEVER read again.
     * This frequently occurs after 'accumulator forwarding' eliminates the rdax.
     * 
     * Handles:
     *   wrax <REG>, 1.0  ; with bridge comment
     *   ...
     *   wrax <TARGET>, 0.0
     * 
     * If <REG> is dead, it becomes:
     *   ; wrax <REG>, 1.0 (Elided)
     *   ...
     *   wrax <TARGET>, 0.0
     */
    private optimizeDeadStoreElimination(code: string[]): string[] {
        // Step 1: Analyze register usage
        const writeIndices = new Map<string, number[]>();
        const readIndices = new Map<string, number[]>();

        for (let i = 0; i < code.length; i++) {
            const line = code[i].trim();
            if (!line || line.startsWith(';')) continue;

            const codePart = line.split(';')[0].trim();
            const tokens = codePart.split(/\s+/);
            const op = tokens[0].toLowerCase();

            // Instructions that read from a register (not memory/hardware aliases)
            const readsReg = ['rdax', 'maxx', 'mulx'].includes(op);
            // Instructions that write to a register (not delay memory)
            const writesReg = ['wrax'].includes(op);

            if (readsReg || writesReg) {
                // Handle different instruction formats
                let reg = '';
                if (op === 'cho') {
                    // cho rda, RMPx, FLAGS, ADDR
                    if (tokens.length >= 5) reg = tokens[4].replace(',', '');
                } else {
                    reg = tokens[1] ? tokens[1].replace(',', '') : '';
                }

                if (reg) {
                    if (readsReg) {
                        if (!readIndices.has(reg)) readIndices.set(reg, []);
                        readIndices.get(reg)!.push(i);
                    }
                    if (writesReg) {
                        if (!writeIndices.has(reg)) writeIndices.set(reg, []);
                        writeIndices.get(reg)!.push(i);
                    }
                }
            }
        }

        // Step 2: Eliminate dead stores
        const optimized: string[] = [...code];
        const hardwareRegisters = [
            'SIN0_RATE', 'SIN0_RANGE', 'SIN1_RATE', 'SIN1_RANGE',
            'RMP0_RATE', 'RMP0_RANGE', 'RMP1_RATE', 'RMP1_RANGE',
            'POT0', 'POT1', 'POT2', 'ADCL', 'ADCR',
            'DACL', 'DACR', 'ADDR_PTR',
            'SIN0', 'SIN1', 'RMP0', 'RMP1', 'COS0', 'COS1'
        ];
        
        for (const [reg, indices] of writeIndices.entries()) {
            // Never prune hardware registers
            if (hardwareRegisters.includes(reg.toUpperCase())) continue;

            const reads = readIndices.get(reg) || [];
            
            for (const writeIdx of indices) {
                const line = optimized[writeIdx].trim();
                if (line.startsWith(';')) continue; // Already optimized out or comment

                // In FV-1, registers persist across samples (loop iterations).
                // A store is dead if it is overwritten before being read.
                // We must check if there's a read later in this loop OR at the start of the next loop.
                const nextRead = reads.find(readIdx => readIdx > writeIdx);
                const sameLoopWrites = indices.filter(idx => idx > writeIdx);
                const nextWrite = sameLoopWrites.length > 0 ? sameLoopWrites[0] : undefined;

                let isDead = false;
                if (nextRead !== undefined) {
                    // There is a read after this write in the same loop.
                    // It is dead ONLY if there is another write to the same register BEFORE that read.
                    if (nextWrite !== undefined && nextWrite < nextRead) {
                        isDead = true;
                    } else {
                        isDead = false;
                    }
                } else {
                    // There is no read after this write in the same loop iteration.
                    // Check if it is read at the beginning of the NEXT loop iteration (wrap-around).
                    const firstRead = reads[0];
                    const firstWrite = indices[0];
                    if (firstRead !== undefined && (firstWrite === undefined || firstRead < firstWrite)) {
                        isDead = false; // Live: read at the start of the next cycle
                    } else {
                        isDead = true; // Dead: never read or overwritten before being read
                    }
                }
                
                if (isDead) {
                    // This store is candidate for elimination if it has an ACC-preserving multiplier (1.0)
                    // OR if it's followed by another instruction that makes the ACC-clearing effect redundant.
                    
                    const wraxMatch = line.match(/^wrax\s+(\w+),\s*(k_1|1|1\.0)(?:\s*;.*)?$/i);
                    if (wraxMatch) {
                        // wrax REG, 1.0 only exists to preserve ACC. If REG is dead, it's useless.
                        optimized[writeIdx] = `; OPTIMIZED (DSE) - ${line.trim()} (Register ${reg} is never read effectively)`;
                    } else {
                        // If it clears ACC (wrax REG, 0), it might still be needed for the CLR side effect.
                        // However, if the NEXT instruction is a WRAX/CLR/ABS/SOF etc. that overwrites ACC, we can still prune.
                        let nextOpIndex = writeIdx + 1;
                        while (nextOpIndex < optimized.length) {
                            const nextLine = optimized[nextOpIndex].trim();
                            if (nextLine && !nextLine.startsWith(';')) break;
                            nextOpIndex++;
                        }
                        
                        if (nextOpIndex < optimized.length) {
                            const nextLine = optimized[nextOpIndex].trim().toLowerCase();
                            // If next instruction sets ACC entirely ignoring previous value
                            if (nextLine.startsWith('rdax') || nextLine.startsWith('clr') || nextLine.startsWith('or') || nextLine.startsWith('sof') || nextLine.startsWith('cho rda')) {
                                optimized[writeIdx] = `; OPTIMIZED (DSE) - ${line.trim()} (Pruned clearing write to dead register)`;
                            }
                        }
                    }
                }
            }
        }

        // Filter out the commented lines to actually reduce instruction count
        return optimized.filter(line => !line.trim().startsWith('; OPTIMIZED (DSE)'));
    }

    /**
     * Optimization 4: Prune unused registers
     * 
     * Finds `equ <alias> REG<num>` and checks if `<alias>` or `REG<num>` 
     * is ever used in the code. If not, it comments out the declaration.
     */
    private optimizeUnusedRegisters(code: string[]): { code: string[], applied: boolean, count: number } {
        const optimized: string[] = [...code];
        let prunedCount = 0;

        // Step 1: Find all equ declarations for REGs
        const regEqus: { lineIndex: number, alias: string, reg: string }[] = [];
        for (let i = 0; i < optimized.length; i++) {
            const line = optimized[i].trim();
            if (line.toLowerCase().startsWith('equ')) {
                // Match: equ alias REGx
                const match = line.match(/^equ\s+([a-zA-Z0-9_]+)\s+(REG[0-9]+)(?:\s*;.*)?$/i);
                if (match) {
                    regEqus.push({
                        lineIndex: i,
                        alias: match[1],
                        reg: match[2]
                    });
                }
            }
        }

        // Step 2: Check usage of each alias and register
        for (const equMatch of regEqus) {
            let isUsed = false;

            for (let i = 0; i < optimized.length; i++) {
                if (i === equMatch.lineIndex) continue;

                const line = optimized[i].trim();
                // Ignore empty lines and pure comments
                if (!line || line.startsWith(';')) continue;

                // Remove comment portion for search
                const codePart = line.split(';')[0];

                // Use regex boundary to ensure we match whole words
                const aliasRegex = new RegExp(`\\b${equMatch.alias}\\b`);
                const regRegex = new RegExp(`\\b${equMatch.reg}\\b`, 'i');

                if (aliasRegex.test(codePart) || regRegex.test(codePart)) {
                    isUsed = true;
                    break;
                }
            }

            if (!isUsed) {
                // Comment out the unused EQU
                const originalLine = optimized[equMatch.lineIndex];
                optimized[equMatch.lineIndex] = `; OPTIMIZED OUT - ${originalLine.trim()} (Unused register)`;
                prunedCount++;
            }
        }

        return {
            code: optimized,
            applied: prunedCount > 0,
            count: prunedCount
        };
    }
}
