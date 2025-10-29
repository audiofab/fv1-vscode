/**
 * Topological sort for block execution order
 * Ensures blocks are processed in dependency order
 */

import { BlockGraph } from '../types/Graph.js';
import { Connection } from '../types/Connection.js';

export interface TopologicalSortResult {
    success: boolean;
    order?: string[];  // Block IDs in execution order
    feedbackConnections?: Set<string>;  // Connection IDs that are feedback paths
    error?: string;
}

export class TopologicalSort {
    /**
     * Perform topological sort on the block graph using reverse traversal from outputs
     * 
     * Algorithm:
     * 1. Identify and exclude feedback connections to break cycles
     * 2. Find all terminal nodes (blocks with no outgoing connections)
     * 3. For each terminal node, traverse backwards through parents
     * 4. Generate code for leaf nodes (no inputs) first, working forward
     * 5. Each block is generated only once
     * 6. Feedback loops are detected by tracking visiting blocks in current path
     */
    sort(graph: BlockGraph): TopologicalSortResult {
        // Identify potential feedback connections by detecting cycles
        const feedbackConnections = this.identifyFeedbackConnections(graph);
        
        // Build parent map INCLUDING feedback connections (we need to visit all parents)
        const allParents = this.buildParentMap(graph, new Set());
        
        // Build child map EXCLUDING feedback connections (to find true terminal nodes)
        const children = this.buildChildMap(graph, feedbackConnections);
        
        // Track generated blocks and current path (for feedback detection)
        const generated = new Set<string>();
        const sorted: string[] = [];
        
        /**
         * Recursively visit a block and its parents, generating code in dependency order
         * @param blockId The block to visit
         * @param visiting Blocks currently being visited in this path (for feedback detection)
         */
        const visitReverse = (blockId: string, visiting: Set<string>): void => {
            // Already generated? Skip it
            if (generated.has(blockId)) {
                return;
            }
            
            // Visiting again in same path? Feedback loop - skip it
            if (visiting.has(blockId)) {
                return;
            }
            
            // Mark as visiting for this path
            const newVisiting = new Set(visiting);
            newVisiting.add(blockId);
            
            // First, recursively visit all parents (blocks providing inputs)
            // This includes feedback connections, so we visit the entire feedback path
            const parentBlocks = allParents.get(blockId) || [];
            for (const parentId of parentBlocks) {
                visitReverse(parentId, newVisiting);
            }
            
            // All parents have been generated, now generate this block
            if (!generated.has(blockId)) {
                generated.add(blockId);
                sorted.push(blockId);
            }
        };
        
        // Find all terminal nodes (blocks with no children - no outgoing connections)
        // Use children map that excludes feedback, so feedback path blocks aren't terminals
        const terminalNodes: string[] = [];
        for (const block of graph.blocks) {
            const blockChildren = children.get(block.id) || [];
            if (blockChildren.length === 0) {
                terminalNodes.push(block.id);
            }
        }
        
        // Process each terminal node, traversing backwards
        for (const terminalId of terminalNodes) {
            visitReverse(terminalId, new Set());
        }
        
        // Handle any orphaned blocks (not connected to terminal nodes)
        for (const block of graph.blocks) {
            if (!generated.has(block.id)) {
                visitReverse(block.id, new Set());
            }
        }
        
        return {
            success: true,
            order: sorted,
            feedbackConnections
        };
    }
    
    /**
     * Identify feedback connections by detecting which connections create cycles.
     * Uses a heuristic approach: connections that target "feedback" or "fb" ports
     * are candidates, and we verify they're part of a cycle.
     */
    private identifyFeedbackConnections(graph: BlockGraph): Set<string> {
        const feedbackConnections = new Set<string>();
        
        // First pass: Mark connections to ports with "feedback" in the name as candidates
        const feedbackCandidates = new Set<string>();
        for (const conn of graph.connections) {
            const portId = conn.to.portId.toLowerCase();
            if (portId.includes('feedback') || portId.includes('fb') || portId === 'fb_in') {
                feedbackCandidates.add(conn.id);
            }
        }
        
        // Second pass: Test each candidate - if removing it breaks the cycle, it's a feedback connection
        for (const candidateId of feedbackCandidates) {
            const testGraph = {
                ...graph,
                connections: graph.connections.filter(c => c.id !== candidateId)
            };
            
            if (!this.hasCyclesInternal(testGraph)) {
                // Removing this connection breaks a cycle, so it's a feedback connection
                feedbackConnections.add(candidateId);
            }
        }
        
        // If we still have cycles, try removing self-loops
        if (this.hasCyclesInternal(graph)) {
            for (const conn of graph.connections) {
                if (conn.from.blockId === conn.to.blockId) {
                    feedbackConnections.add(conn.id);
                }
            }
        }
        
        return feedbackConnections;
    }
    
    /**
     * Build a map of blockId -> blocks that provide inputs to it (parents)
     * @param graph The block graph
     * @param feedbackConnections Set of connection IDs to exclude (these are feedback paths)
     */
    private buildParentMap(graph: BlockGraph, feedbackConnections: Set<string>): Map<string, string[]> {
        const map = new Map<string, string[]>();
        
        // Initialize map for all blocks
        for (const block of graph.blocks) {
            map.set(block.id, []);
        }
        
        // Add parent relationships based on connections
        for (const connection of graph.connections) {
            // Ignore self-loops
            if (connection.from.blockId === connection.to.blockId) {
                continue;
            }
            
            // Skip feedback connections
            if (feedbackConnections.has(connection.id)) {
                continue;
            }
            
            // connection.from is a parent of connection.to
            const parentList = map.get(connection.to.blockId) || [];
            if (!parentList.includes(connection.from.blockId)) {
                parentList.push(connection.from.blockId);
            }
            map.set(connection.to.blockId, parentList);
        }
        
        return map;
    }
    
    /**
     * Build a map of blockId -> blocks that consume its outputs (children)
     * @param graph The block graph
     * @param feedbackConnections Set of connection IDs to exclude (these are feedback paths)
     */
    private buildChildMap(graph: BlockGraph, feedbackConnections: Set<string>): Map<string, string[]> {
        const map = new Map<string, string[]>();
        
        // Initialize map for all blocks
        for (const block of graph.blocks) {
            map.set(block.id, []);
        }
        
        // Add child relationships based on connections
        for (const connection of graph.connections) {
            // Ignore self-loops
            if (connection.from.blockId === connection.to.blockId) {
                continue;
            }
            
            // Skip feedback connections
            if (feedbackConnections.has(connection.id)) {
                continue;
            }
            
            // connection.to is a child of connection.from
            const childList = map.get(connection.from.blockId) || [];
            if (!childList.includes(connection.to.blockId)) {
                childList.push(connection.to.blockId);
            }
            map.set(connection.from.blockId, childList);
        }
        
        return map;
    }
    
    /**
     * Build a map of blockId -> blocks it depends on
     * A block depends on all blocks that connect to its inputs
     * @param graph The block graph
     * @param feedbackConnections Set of connection IDs to exclude (these are feedback paths)
     * 
     * Feedback connections are EXCLUDED from the dependency map to break cycles.
     * They are handled separately to ensure proper execution order.
     */
    private buildDependencyMap(graph: BlockGraph, feedbackConnections: Set<string>): Map<string, string[]> {
        const map = new Map<string, string[]>();
        
        // Initialize map for all blocks
        for (const block of graph.blocks) {
            map.set(block.id, []);
        }
        
        // Add dependencies based on connections
        for (const connection of graph.connections) {
            // Ignore self-loops (block connected to itself)
            // These are valid for delay/memory-based blocks
            if (connection.from.blockId === connection.to.blockId) {
                continue;
            }
            
            // Skip feedback connections - they don't create forward dependencies
            if (feedbackConnections.has(connection.id)) {
                continue;
            }
            
            // Normal forward connection: destination depends on source
            const deps = map.get(connection.to.blockId) || [];
            if (!deps.includes(connection.from.blockId)) {
                deps.push(connection.from.blockId);
            }
            map.set(connection.to.blockId, deps);
        }
        
        return map;
    }
    
    /**
     * Check if the graph has cycles using DFS
     * Used internally for feedback detection
     */
    private hasCyclesInternal(graph: BlockGraph): boolean {
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const dependencies = this.buildDependencyMap(graph, new Set()); // No feedback exclusions
        
        const visit = (blockId: string): boolean => {
            if (visited.has(blockId)) {
                return false; // No cycle on this path
            }
            
            if (visiting.has(blockId)) {
                return true; // Cycle detected!
            }
            
            visiting.add(blockId);
            
            const deps = dependencies.get(blockId) || [];
            for (const depId of deps) {
                if (visit(depId)) {
                    return true;
                }
            }
            
            visiting.delete(blockId);
            visited.add(blockId);
            return false;
        };
        
        for (const block of graph.blocks) {
            if (!visited.has(block.id)) {
                if (visit(block.id)) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Detect if graph has cycles
     */
    hasCycles(graph: BlockGraph): boolean {
        const result = this.sort(graph);
        return !result.success;
    }
}
