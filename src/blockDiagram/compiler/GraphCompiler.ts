/**
 * Main graph compiler
 * Orchestrates the compilation of a block diagram to FV-1 assembly
 */

import { BlockGraph } from '../types/Graph.js';
import { Block } from '../types/Block.js';
import { BlockRegistry } from '../blocks/BlockRegistry.js';
import { TopologicalSort } from './TopologicalSort.js';
import { CodeGenerationContext } from '../types/CodeGenContext.js';

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
    
    constructor(registry: BlockRegistry) {
        this.registry = registry;
        this.topologicalSort = new TopologicalSort();
    }
    
    /**
     * Compile a block diagram to FV-1 assembly code
     */
    compile(graph: BlockGraph): CompilationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        
        // 1. Validate graph structure
        const validation = this.validateGraph(graph);
        if (!validation.valid) {
            return {
                success: false,
                errors: validation.errors
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
                errors: [sortResult.error || 'Failed to sort blocks']
            };
        }
        
        const executionOrder = sortResult.order!;
        
        // Add warning if feedback connections were detected
        if (sortResult.feedbackConnections && sortResult.feedbackConnections.size > 0) {
            warnings.push(`Detected ${sortResult.feedbackConnections.size} feedback connection(s). ` +
                         `These create valid feedback loops (e.g., delay → filter → back to delay).`);
        }
        
        // 3. Create code generation context
        const context = new CodeGenerationContext(graph);
        
        // 3a. Pre-allocate registers for all connected outputs
        // This is necessary for feedback loops where blocks may read from outputs
        // that haven't been generated yet in the execution order
        this.preallocateAllOutputs(graph, context);
        
        // 4. FIRST PASS: Collect EQU declarations and initialization code from all blocks
        const equDeclarations: string[] = [];
        const initCode: string[] = [];
        
        try {
            for (const blockId of executionOrder) {
                const block = graph.blocks.find(b => b.id === blockId);
                if (!block) {
                    continue;
                }
                
                const definition = this.registry.getBlock(block.type);
                if (!definition) {
                    errors.push(`Unknown block type: ${block.type}`);
                    continue;
                }
                
                // Set current block context
                context.setCurrentBlock(blockId);
                
                // Collect EQU declarations if block provides them
                if (definition.getEquDeclarations) {
                    const blockEqus = definition.getEquDeclarations(context);
                    equDeclarations.push(...blockEqus);
                }
                
                // Collect initialization code if block provides it
                if (definition.getInitCode) {
                    const blockInit = definition.getInitCode(context);
                    if (blockInit.length > 0) {
                        initCode.push(`;  from ${block.type}`);
                        initCode.push(...blockInit);
                    }
                }
            }
        } catch (error) {
            return {
                success: false,
                errors: [`First pass (EQU/init collection) failed: ${error}`]
            };
        }
        
        // 5. SECOND PASS: Generate main code for each block
        const bodyCode: string[] = [];
        try {
            for (const blockId of executionOrder) {
                const block = graph.blocks.find(b => b.id === blockId);
                if (!block) {
                    continue;
                }
                
                const definition = this.registry.getBlock(block.type);
                if (!definition) {
                    // Already reported in first pass
                    continue;
                }
                
                // Set current block context
                context.setCurrentBlock(blockId);
                
                // Add block section header comment
                const blockComment = this.generateBlockComment(block, context, graph);
                bodyCode.push(...blockComment);
                
                // Generate block code
                const blockCode = definition.generateCode(context);
                bodyCode.push(...blockCode);
                
                // Reset scratch registers for next block
                context.resetScratchRegisters();
            }
        } catch (error) {
            return {
                success: false,
                errors: [`Code generation failed: ${error}`]
            };
        }
        
        // 6. Assemble the final program with proper structure
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
        codeLines.push('; Generated by FV-1 Block Diagram Editor');
        codeLines.push(';================================================================================');
        codeLines.push('');
        
        // Section 2: EQU declarations
        const contextEqus = context.getEquDeclarations();
        const registerAliases = context.getRegisterAliases();
        
        if (equDeclarations.length > 0 || contextEqus.length > 0 || registerAliases.length > 0) {
            codeLines.push('; EQU Declarations');
            codeLines.push(';--------------------------------------------------------------------------------');
            
            // Subsection 2a: Constants
            if (equDeclarations.length > 0 || contextEqus.length > 0) {
                codeLines.push('; Constants');
                // Add block-specific EQUs first
                equDeclarations.forEach(line => codeLines.push(line));
                
                // Add context EQUs (programmatically registered)
                contextEqus.forEach(equ => {
                    codeLines.push(`equ\t${equ.name}\t${equ.value}`);
                });
                codeLines.push('');
            }
            
            // Subsection 2b: Register Aliases
            if (registerAliases.length > 0) {
                codeLines.push('; Register Aliases');
                registerAliases.forEach(alias => {
                    codeLines.push(`equ\t${alias.alias}\t${alias.register}`);
                });
                codeLines.push('');
            }
        }
        
        // Section 3: MEM declarations
        const memoryBlocks = context.getMemoryBlocks();
        if (memoryBlocks.length > 0) {
            codeLines.push('; Memory Allocations');
            codeLines.push(';--------------------------------------------------------------------------------');
            for (const mem of memoryBlocks) {
                codeLines.push(`mem\t${mem.name}\t${mem.size}`);
            }
            codeLines.push('');
        }
        
        // Section 4: Initialization code (runs once at startup)
        if (initCode.length > 0) {
            codeLines.push('; Initialization (runs once at startup)');
            codeLines.push(';--------------------------------------------------------------------------------');
            codeLines.push('skp\trun,\tstart');
            codeLines.push(...initCode);
            codeLines.push('start:');
            codeLines.push('');
        }
        
        // Section 5: Main code body (runs every sample)
        if (bodyCode.length > 0) {
            codeLines.push('; Main Program');
            codeLines.push(';--------------------------------------------------------------------------------');
            codeLines.push(...bodyCode);
        }
        
        // 6. Count instructions (rough estimate)
        const instructions = codeLines.filter(line => {
            const trimmed = line.trim();
            return trimmed.length > 0 && 
                   !trimmed.startsWith(';') && 
                   !trimmed.includes('equ');
        }).length;
        
        // Check instruction limit
        if (instructions > 128) {
            errors.push(
                `Program uses ${instructions} instructions, but FV-1 maximum is 128. ` +
                'Reduce complexity or optimize blocks.'
            );
        } else if (instructions > 120) {
            warnings.push(
                `Program uses ${instructions}/128 instructions. ` +
                'Very close to limit!'
            );
        }
        
        // 6. Build statistics
        const statistics: CompilationStatistics = {
            instructionsUsed: instructions,
            registersUsed: context.getUsedRegisterCount(),
            memoryUsed: context.getUsedMemorySize(),
            blocksProcessed: executionOrder.length
        };
        
        // Return result
        if (errors.length > 0) {
            return {
                success: false,
                errors,
                warnings: warnings.length > 0 ? warnings : undefined
            };
        }
        
        return {
            success: true,
            assembly: codeLines.join('\n'),
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
            errors.push('Graph is empty - add some blocks first');
            return { valid: false, errors };
        }
        
        // Check for at least one output block
        const hasOutput = graph.blocks.some(b => 
            b.type.startsWith('output.')
        );
        if (!hasOutput) {
            errors.push('Graph must have at least one output block (DACL or DACR)');
        }
        
        // Check for at least one input block
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
            
            // Check required inputs are connected
            for (const input of definition.inputs) {
                if (input.required) {
                    const hasConnection = graph.connections.some(
                        c => c.to.blockId === block.id && c.to.portId === input.id
                    );
                    if (!hasConnection) {
                        errors.push(
                            `Block '${definition.name}' (${block.id}) ` +
                            `requires input '${input.name}' to be connected`
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
}
