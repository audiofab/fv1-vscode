/**
 * Main graph compiler
 * Orchestrates the compilation of a block diagram to FV-1 assembly
 */


import { BlockGraph } from '../types/Graph.js';
import { Block } from '../types/Block.js';
import { BlockRegistry } from '../blocks/BlockRegistry.js';
import { TopologicalSort } from './TopologicalSort.js';
import { CodeGenerationContext } from '../types/CodeGenContext.js';
import { CodeOptimizer } from './CodeOptimizer.js';
import { FV1Assembler } from '../../assembler/FV1Assembler.js';

export interface CompilationStatistics {
    instructionsUsed: number;
    registersUsed: number;
    memoryUsed: number;
    blocksProcessed: number;
}

export interface CompilationResult {
    success: boolean;
    assembly?: string;
    statistics?: CompilationStatistics;
    errors?: string[];
    warnings?: string[];
}

export class GraphCompiler {
    private registry: BlockRegistry;
    private topologicalSort: TopologicalSort;
    private optimizer: CodeOptimizer;

    constructor(registry: BlockRegistry) {
        this.registry = registry;
        this.topologicalSort = new TopologicalSort();
        this.optimizer = new CodeOptimizer();
    }

    /**
     * Compile a block diagram to FV-1 assembly code
     */
    compile(graph: BlockGraph, options: {
        regCount: number;
        progSize: number;
        delaySize: number;
        fv1AsmMemBug?: boolean;
        clampReals?: boolean;
    }): CompilationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // 1. Validate graph structure
        const validation = this.validateGraph(graph);
        if (!validation.valid) {
            return {
                success: false,
                errors: validation.errors,
                statistics: {
                    instructionsUsed: 0,
                    registersUsed: 0,
                    memoryUsed: 0,
                    blocksProcessed: 0
                }
            };
        }
        if (validation.warnings) {
            warnings.push(...validation.warnings);
        }

        // 2. Topological sort to determine execution order
        const sortResult = this.topologicalSort.sort(graph);
        if (!sortResult.success) {
            return {
                success: false,
                errors: [sortResult.error || 'Failed to sort blocks'],
                statistics: {
                    instructionsUsed: 0,
                    registersUsed: 0,
                    memoryUsed: 0,
                    blocksProcessed: 0
                }
            };
        }

        const executionOrder = sortResult.order!;

        // 3. Create code generation context
        const context = new CodeGenerationContext(graph);

        // 4. Pre-allocate registers for all connected outputs
        // This is necessary for feedback loops where blocks may read from outputs
        // that haven't been generated yet in the execution order
        this.preallocateAllOutputs(graph, context);

        // 5. Generate code for each block in execution order
        // Blocks will push their code to appropriate sections or push IR nodes
        try {
            // First, process sticky notes (header comments)
            for (const block of graph.blocks) {
                if (!executionOrder.includes(block.id) && block.type.includes('stickynote')) {
                    const definition = this.registry.getBlock(block.type);
                    if (definition) {
                        context.setCurrentBlock(block.id);
                        definition.generateCode(context);
                    }
                }
            }

            // Then process connected blocks in execution order
            for (const blockId of executionOrder) {
                const block = graph.blocks.find(b => b.id === blockId);
                if (!block) continue;

                const definition = this.registry.getBlock(block.type);
                if (!definition) {
                    errors.push(`Unknown block type: ${block.type}`);
                    continue;
                }

                context.setCurrentBlock(blockId);

                // If it's a template-based block (to be implemented), it will push to IR
                // For now, even legacy blocks can be adapted to push IR if they want
                definition.generateCode(context);

                context.resetScratchRegisters();
            }
        } catch (error) {
            return {
                success: false,
                errors: [`Code generation failed: ${error}`]
            };
        }

        // 6. Process IR and optimize (Move Pruning)
        const irResult = this.processIR(context);
        const sections = irResult.sections;
        warnings.push(...irResult.warnings);

        // 7. Assemble the final program with proper structure
        const codeLines: string[] = [];

        // Section 1: Header comment
        codeLines.push(';================================================================================');
        codeLines.push(`; ${graph.metadata.name}`);
        if (graph.metadata.description) {
            codeLines.push(`; ${graph.metadata.description}`);
        }
        if (graph.metadata.author) {
            codeLines.push(`; Author: ${graph.metadata.author}`);
        }
        codeLines.push(`; Generated at ${new Date().toLocaleString()} by the Audiofab Easy Spin (FV-1)`);
        codeLines.push(';  Block Diagram Editor (https://www.audiofab.com/)');
        codeLines.push(';================================================================================');

        // Add any header comments from sticky notes
        const headerComments = context.getHeaderComments();
        if (headerComments.length > 0) {
            codeLines.push('');
            codeLines.push(...headerComments);
        }

        // Add pot mapping comments
        const potMappings = this.generatePotMappingComments(graph);
        if (potMappings.length > 0) {
            codeLines.push('');
            codeLines.push(...potMappings);
        }

        codeLines.push('');

        // Section 1.5: IR Header (EQU, MEM from blocks)
        if (irResult.sections.header && irResult.sections.header.length > 0) {
            codeLines.push('; Block Declarations');
            codeLines.push(';--------------------------------------------------------------------------------');
            codeLines.push(...irResult.sections.header);
            codeLines.push('');
        }

        // Section 2: Initialization (EQU, MEM, SKP)
        if (sections.init.length > 0) {
            codeLines.push('; Initialization');
            codeLines.push(';--------------------------------------------------------------------------------');
            codeLines.push(...sections.init);
            codeLines.push('');
        }

        // Section 3: Input Section (ADC reads, POT reads)
        if (sections.input.length > 0) {
            codeLines.push('; Input Section');
            codeLines.push(';--------------------------------------------------------------------------------');
            codeLines.push(...sections.input);
            codeLines.push('');
        }

        // Section 4: Main Program
        if (sections.main.length > 0) {
            codeLines.push('; Main Program');
            codeLines.push(';--------------------------------------------------------------------------------');
            codeLines.push(...sections.main);
            codeLines.push('');
        }

        // Section 5: Output Section (DAC writes)
        if (sections.output.length > 0) {
            codeLines.push('; Output Section');
            codeLines.push(';--------------------------------------------------------------------------------');
            codeLines.push(...sections.output);
            codeLines.push('');
        }

        // Apply post-processing optimizations to the complete code
        const optimizerResult = this.optimizer.optimize(codeLines);

        // 7. Assemble the code to get accurate instruction count
        let instructions = 0;
        try {
            const assembler = new FV1Assembler({
                fv1AsmMemBug: options.fv1AsmMemBug ?? true,
                clampReals: options.clampReals ?? true,
                regCount: options.regCount,
                progSize: options.progSize,
                delaySize: options.delaySize
            });
            const assemblyResult = assembler.assemble(optimizerResult.code.join('\n'));

            // Count actual instructions from machine code (exclude NOP padding)
            const NOP_ENCODING = 0x00000011;
            instructions = assemblyResult.machineCode.filter((code: number) => code !== NOP_ENCODING).length;

            // Check for assembly errors
            const assemblyErrors = assemblyResult.problems.filter((p: any) => p.isfatal);
            if (assemblyErrors.length > 0) {
                assemblyErrors.forEach((p: any) => {
                    errors.push(p.message);
                });
            }
        } catch (e) {
            // Fallback to rough estimate if assembly fails
            instructions = optimizerResult.code.filter(line => {
                const trimmed = line.trim();
                return trimmed.length > 0 &&
                    !trimmed.startsWith(';') &&
                    !trimmed.includes('equ') &&
                    !trimmed.includes('mem') &&
                    !trimmed.includes(':');  // Skip labels
            }).length;
            warnings.push('Could not accurately count instructions');
        }

        // Check instruction limit
        const maxProgSize = options.progSize;
        if (instructions > maxProgSize) {
            errors.push(
                `Program uses ${instructions} instructions, but FV-1 maximum is ${maxProgSize}. ` +
                'Reduce complexity or optimize blocks.'
            );
        } else if (instructions > maxProgSize * 0.95) {
            warnings.push(
                `Program uses ${instructions}/${maxProgSize} instructions. ` +
                'Very close to limit!'
            );
        }

        // 8. Build statistics
        const statistics: CompilationStatistics = {
            instructionsUsed: instructions,
            registersUsed: context.getUsedRegisterCount(),
            memoryUsed: context.getUsedMemorySize(),
            blocksProcessed: executionOrder.length
        };

        // Add optimization info to warnings
        if (optimizerResult.optimizationsApplied > 0) {
            warnings.push(`Applied ${optimizerResult.optimizationsApplied} code optimization(s)`);
            optimizerResult.details.forEach(detail => {
                warnings.push(`  - ${detail}`);
            });
        }

        // Return result
        if (errors.length > 0) {
            return {
                success: false,
                assembly: optimizerResult.code.join('\n'),  // Include assembly even with errors so it can be viewed
                statistics,  // Include statistics even on failure so status bar shows usage
                errors,
                warnings: warnings.length > 0 ? warnings : undefined
            };
        }

        return {
            success: true,
            assembly: optimizerResult.code.join('\n'),
            statistics,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    /**
     * Generate a descriptive comment block for a block's code section
     */
    private generateBlockComment(
        block: Block,
        context: CodeGenerationContext,
        graph: BlockGraph
    ): string[] {
        const definition = this.registry.getBlock(block.type);
        if (!definition) {
            return [];
        }

        const lines: string[] = [];
        lines.push(';===============================================================================');
        lines.push(`; ${definition.name} (${block.id})`);

        // Show inputs if any
        if (definition.inputs.length > 0) {
            const inputInfo: string[] = [];
            for (const input of definition.inputs) {
                const inputReg = context.getInputRegister(block.id, input.id);
                if (inputReg) {
                    inputInfo.push(`${input.name}: ${inputReg}`);
                } else if (!input.required) {
                    inputInfo.push(`${input.name}: (not connected)`);
                }
            }
            if (inputInfo.length > 0) {
                lines.push(`; Inputs: ${inputInfo.join(', ')}`);
            }
        }

        // Show outputs if any
        if (definition.outputs.length > 0) {
            const outputInfo: string[] = [];
            for (const output of definition.outputs) {
                // Get the register allocation for this output
                const alloc = (context as any).registerAllocations.find(
                    (a: any) => a.blockId === block.id && a.portId === output.id
                );
                if (alloc) {
                    outputInfo.push(`${output.name}: ${alloc.alias}`);
                }
            }
            if (outputInfo.length > 0) {
                lines.push(`; Outputs: ${outputInfo.join(', ')}`);
            }
        }

        // Show parameter values if any
        if (definition.parameters.length > 0) {
            const paramInfo: string[] = [];
            for (const param of definition.parameters) {
                const value = block.parameters[param.id];
                if (value !== undefined) {
                    paramInfo.push(`${param.name}=${value}`);
                }
            }
            if (paramInfo.length > 0) {
                lines.push(`; Parameters: ${paramInfo.join(', ')}`);
            }
        }

        lines.push(';-------------------------------------------------------------------------------');

        return lines;
    }

    /**
     * Validate the graph structure
     */
    private validateGraph(graph: BlockGraph): {
        valid: boolean;
        errors?: string[];
        warnings?: string[]
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check for blocks
        if (graph.blocks.length === 0) {
            // Empty graph is valid - just won't generate any code
            warnings.push('Graph is empty - add some blocks to generate code');
            return { valid: true, warnings };
        }

        // Check for at least one output block (warning only)
        const hasOutput = graph.blocks.some(b =>
            b.type.startsWith('output.')
        );
        if (!hasOutput) {
            warnings.push('Graph has no output blocks - add DACL or DACR to hear sound');
        }

        // Check for at least one input block (warning only)
        const hasInput = graph.blocks.some(b =>
            b.type.startsWith('input.')
        );
        if (!hasInput) {
            warnings.push('Graph has no input blocks - output will be silent');
        }

        // Validate each block's connections
        for (const block of graph.blocks) {
            const definition = this.registry.getBlock(block.type);
            if (!definition) {
                errors.push(`Unknown block type: ${block.type} (block ${block.id})`);
                continue;
            }

            // Check required inputs are connected (warning only for better UX)
            for (const input of definition.inputs) {
                if (input.required) {
                    const hasConnection = graph.connections.some(
                        c => c.to.blockId === block.id && c.to.portId === input.id
                    );
                    if (!hasConnection) {
                        warnings.push(
                            `Block '${definition.name}' (${block.id}) ` +
                            `has unconnected required input '${input.name}'`
                        );
                    }
                }
            }
        }

        // Validate connections
        for (const connection of graph.connections) {
            // Check source block exists
            const sourceBlock = graph.blocks.find(b => b.id === connection.from.blockId);
            if (!sourceBlock) {
                errors.push(`Connection references non-existent source block: ${connection.from.blockId}`);
                continue;
            }

            // Check dest block exists
            const destBlock = graph.blocks.find(b => b.id === connection.to.blockId);
            if (!destBlock) {
                errors.push(`Connection references non-existent destination block: ${connection.to.blockId}`);
                continue;
            }

            // Check for self-loops
            if (connection.from.blockId === connection.to.blockId) {
                errors.push(
                    `Self-loop detected: Block ${sourceBlock.type} (${connection.from.blockId}) ` +
                    `cannot have its output connected to its own input`
                );
                continue;
            }

            // Check ports exist
            const sourceDef = this.registry.getBlock(sourceBlock.type);
            const destDef = this.registry.getBlock(destBlock.type);

            if (!sourceDef || !destDef) continue;

            const sourcePort = sourceDef.outputs.find(p => p.id === connection.from.portId);
            const destPort = destDef.inputs.find(p => p.id === connection.to.portId);

            if (!sourcePort) {
                errors.push(
                    `Connection references non-existent output port '${connection.from.portId}' ` +
                    `on block ${connection.from.blockId}`
                );
                continue;
            }

            if (!destPort) {
                errors.push(
                    `Connection references non-existent input port '${connection.to.portId}' ` +
                    `on block ${connection.to.blockId}`
                );
                continue;
            }

            // Validate port type compatibility
            if (sourcePort.type !== destPort.type) {
                errors.push(
                    `Port type mismatch: Cannot connect ${sourcePort.type} output ` +
                    `'${sourcePort.name}' from ${sourceDef.name} (${sourceBlock.id}) ` +
                    `to ${destPort.type} input '${destPort.name}' on ${destDef.name} (${destBlock.id}). ` +
                    `Port types must match (audio→audio or control→control).`
                );
            }
        }

        // Check for multiple connections to the same input (multiple drivers)
        const inputConnections = new Map<string, string[]>();
        for (const connection of graph.connections) {
            const inputKey = `${connection.to.blockId}:${connection.to.portId}`;
            if (!inputConnections.has(inputKey)) {
                inputConnections.set(inputKey, []);
            }
            inputConnections.get(inputKey)!.push(connection.from.blockId);
        }

        for (const [inputKey, sources] of inputConnections.entries()) {
            if (sources.length > 1) {
                const [blockId, portId] = inputKey.split(':');
                const block = graph.blocks.find(b => b.id === blockId);
                const def = block ? this.registry.getBlock(block.type) : undefined;
                const port = def?.inputs.find(p => p.id === portId);

                errors.push(
                    `Multiple connections to the same input: ` +
                    `${def?.name || 'Unknown'} (${blockId}) input '${port?.name || portId}' ` +
                    `has ${sources.length} connections. Each input can only have one source.`
                );
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    /**
     * Generate pot mapping comments showing which parameters each pot controls
     */
    private generatePotMappingComments(graph: BlockGraph): string[] {
        const comments: string[] = [];
        const potMappings = new Map<number, string[]>(); // pot number -> list of controlled parameters

        // Find all pot blocks
        for (const block of graph.blocks) {
            if (block.type === 'input.pot') {
                const potNumber = block.parameters['potNumber'] ?? 0;

                // Find what this pot is connected to
                const connections = graph.connections.filter(
                    c => c.from.blockId === block.id
                );

                if (connections.length > 0) {
                    const targets: string[] = [];

                    for (const conn of connections) {
                        const targetBlock = graph.blocks.find(b => b.id === conn.to.blockId);
                        if (targetBlock) {
                            const targetDef = this.registry.getBlock(targetBlock.type);
                            if (targetDef) {
                                const inputPort = targetDef.inputs.find(p => p.id === conn.to.portId);
                                const targetLabel = `${targetDef.name}${inputPort ? ` (${inputPort.name})` : ''}`;
                                targets.push(targetLabel);
                            }
                        }
                    }

                    if (targets.length > 0) {
                        if (!potMappings.has(potNumber)) {
                            potMappings.set(potNumber, []);
                        }
                        potMappings.get(potNumber)!.push(...targets);
                    }
                }
            }
        }

        // Generate comments for pots that are mapped
        if (potMappings.size > 0) {
            comments.push('; Potentiometer Assignments');
            comments.push(';--------------------------------------------------------------------------------');

            // Sort by pot number
            const sortedPots = Array.from(potMappings.keys()).sort((a, b) => a - b);

            for (const potNumber of sortedPots) {
                const targets = potMappings.get(potNumber)!;
                if (targets.length > 0) {
                    comments.push(`; POT${potNumber}: ${targets.join(', ')}`);
                }
            }
        }

        return comments;
    }

    /**
     * Pre-allocate registers for all connected outputs
     * This ensures registers exist before any code generation, which is necessary
     * for feedback loops where blocks may need to read from outputs that haven't
     * been generated yet in the execution order
     */
    private preallocateAllOutputs(graph: BlockGraph, context: CodeGenerationContext): void {
        // Find all unique output ports that are connected
        const connectedOutputs = new Set<string>();

        for (const connection of graph.connections) {
            const key = `${connection.from.blockId}:${connection.from.portId}`;
            connectedOutputs.add(key);
        }

        // Allocate a register for each connected output
        for (const key of connectedOutputs) {
            const [blockId, portId] = key.split(':');
            context.allocateRegister(blockId, portId);
        }
    }

    /**
     * Process semantic IR nodes and optimize assembly
     */
    private processIR(context: CodeGenerationContext): { sections: any, warnings: string[] } {
        const sections = context.getCodeSections();
        const irNodes = context.getIR();
        const warnings: string[] = [];

        if (irNodes.length === 0) {
            return { sections, warnings };
        }

        // Convert IR nodes to code and group by section
        const irSections: Record<string, string[]> = {
            header: [],
            init: [],
            input: [],
            main: [],
            output: []
        };

        // Track accumulator state for move pruning
        let accValue: string | null = null;
        let optimizedCount = 0;

        for (const node of irNodes) {
            let skipNode = false;

            // Specialized move pruning (WRAX -> LDAX optimization)
            if (node.op === 'LDAX') {
                const reg = node.args[0];
                if (reg === accValue) {
                    // Accumulator already contains this register value
                    skipNode = true;
                    optimizedCount++;
                } else {
                    accValue = reg;
                }
            } else if (node.op === 'WRAX') {
                const reg = node.args[0];
                const multiplier = node.args[1];
                accValue = multiplier === '0' || multiplier === '0.0' ? reg : null;
            } else if (node.op === 'WRA' || node.op === 'WRAL' || node.op === 'WRAR') {
                // These clear ACC or modify it, reset tracker for safety if not 0 multiplier
                const multiplier = node.args[1];
                accValue = null;
            } else if (['CLR', 'ABS', 'NEG', 'NOT'].includes(node.op)) {
                accValue = null;
            } else if (['RDAX', 'MAXX', 'MULX', 'RDA', 'CHO'].includes(node.op)) {
                // Instructions that modify ACC based on a register/memory
                accValue = null;
            }

            if (!skipNode) {
                // Special handling for labels (end with :) and comments (op is ;)
                if (node.op.endsWith(':')) {
                    irSections[node.section].push(node.op);
                } else if (node.op === ';') {
                    // Comments should join with space, not comma
                    irSections[node.section].push(`;\t${node.args.join(' ')}`);
                } else {
                    const isDeclaration = ['EQU', 'MEM'].includes(node.op);
                    const separator = isDeclaration ? '\t' : ', ';
                    const line = `${node.op.toLowerCase()}\t${node.args.join(separator)}`;

                    let finalLine = line;
                    if (node.comment) {
                        finalLine += `\t; ${node.comment}`;
                    }
                    irSections[node.section].push(finalLine);
                }
            }
        }

        if (optimizedCount > 0) {
            warnings.push(`Pruned ${optimizedCount} redundant move instruction(s)`);
        }

        // Merge IR code into structured sections
        sections.init.push(...irSections.init);
        sections.input.push(...irSections.input);
        sections.main.push(...irSections.main);
        sections.output.push(...irSections.output);

        return { sections, warnings };
    }
}
