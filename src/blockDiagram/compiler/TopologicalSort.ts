/**
 * Topological sort for block execution order
 * Ensures blocks are processed in dependency order
 */

import { BlockGraph } from '../types/Graph.js';
import { Connection } from '../types/Connection.js';

export interface TopologicalSortResult {
    success: boolean;
    order?: string[];  // Block IDs in execution order
    error?: string;
}

export class TopologicalSort {
    /**
     * Perform topological sort on the block graph
     * Returns blocks in order such that all dependencies are processed first
     */
    sort(graph: BlockGraph): TopologicalSortResult {
        const sorted: string[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();
        
        // Build adjacency map (blockId -> blocks that depend on it)
        const dependencies = this.buildDependencyMap(graph);
        
        // Recursive visit function
        const visit = (blockId: string): boolean => {
            if (visited.has(blockId)) {
                return true;
            }
            
            if (visiting.has(blockId)) {
                // Circular dependency detected
                return false;
            }
            
            visiting.add(blockId);
            
            // Visit all blocks that this block depends on
            const deps = dependencies.get(blockId) || [];
            for (const depId of deps) {
                if (!visit(depId)) {
                    return false;
                }
            }
            
            visiting.delete(blockId);
            visited.add(blockId);
            sorted.push(blockId);
            
            return true;
        };
        
        // Start from all blocks
        for (const block of graph.blocks) {
            if (!visited.has(block.id)) {
                if (!visit(block.id)) {
                    return {
                        success: false,
                        error: 'Circular dependency detected in block graph'
                    };
                }
            }
        }
        
        return {
            success: true,
            order: sorted
        };
    }
    
    /**
     * Build a map of blockId -> blocks it depends on
     * A block depends on all blocks that connect to its inputs
     */
    private buildDependencyMap(graph: BlockGraph): Map<string, string[]> {
        const map = new Map<string, string[]>();
        
        // Initialize map for all blocks
        for (const block of graph.blocks) {
            map.set(block.id, []);
        }
        
        // Add dependencies based on connections
        for (const connection of graph.connections) {
            const deps = map.get(connection.to.blockId) || [];
            if (!deps.includes(connection.from.blockId)) {
                deps.push(connection.from.blockId);
            }
            map.set(connection.to.blockId, deps);
        }
        
        return map;
    }
    
    /**
     * Detect if graph has cycles
     */
    hasCycles(graph: BlockGraph): boolean {
        const result = this.sort(graph);
        return !result.success;
    }
}
