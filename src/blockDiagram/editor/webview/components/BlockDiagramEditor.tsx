/**
 * Main Block Diagram Editor Component
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Stage, Layer } from 'react-konva';
import { BlockGraph, createEmptyGraph } from '../../../types/Graph';
import { Block } from '../../../types/Block';
import { Connection } from '../../../types/Connection';
import { BlockMetadata } from '../../../types/Block';
import { BlockComponent } from './BlockComponent';
import { ConnectionComponent } from './ConnectionComponent';
import { Toolbar } from './Toolbar';
import { BlockPalette } from './BlockPalette';
import { PropertyPanel } from './PropertyPanel';
import { v4 as uuidv4 } from 'uuid';

interface BlockDiagramEditorProps {
    vscode: any;
}

export const BlockDiagramEditor: React.FC<BlockDiagramEditorProps> = ({ vscode }) => {
    console.log('[Editor] Component rendering...');
    
    // Graph state
    const [graph, setGraph] = useState<BlockGraph>(createEmptyGraph());
    const [blockMetadata, setBlockMetadata] = useState<BlockMetadata[]>([]);
    
    console.log('[Editor] Current graph:', graph);
    console.log('[Editor] Block metadata count:', blockMetadata.length);
    
    // Canvas state
    const [zoom, setZoom] = useState(1.0);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
    const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
    
    // Selection state
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    
    // Drag state
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    
    // Connection drawing state
    const [connectingFrom, setConnectingFrom] = useState<{ blockId: string; portId: string } | null>(null);
    const [connectionPreview, setConnectionPreview] = useState<{ x: number; y: number } | null>(null);
    
    const stageRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Handle messages from VS Code
    useEffect(() => {
        console.log('[Editor] Setting up message handler');
        
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log('[Editor] Received message:', message.type, message);
            
            switch (message.type) {
                case 'init':
                    console.log('[Editor] Initializing with graph:', message.graph);
                    setGraph(message.graph);
                    if (message.graph.canvas) {
                        setZoom(message.graph.canvas.zoom);
                        setPan({ x: message.graph.canvas.panX, y: message.graph.canvas.panY });
                    }
                    break;
                    
                case 'blockMetadata':
                    console.log('[Editor] Received block metadata:', message.metadata.length, 'blocks');
                    setBlockMetadata(message.metadata);
                    break;
            }
        };
        
        window.addEventListener('message', handleMessage);
        
        // Signal that webview is ready
        console.log('[Editor] Sending ready signal...');
        vscode.postMessage({ type: 'ready' });
        
        return () => window.removeEventListener('message', handleMessage);
    }, [vscode]);
    
    // Update canvas size
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                setCanvasSize({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        };
        
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);
    
    // Update canvas size when palette collapse state changes
    useEffect(() => {
        // Wait for CSS transition to complete (0.2s) plus a small buffer
        const timer = setTimeout(() => {
            if (containerRef.current) {
                setCanvasSize({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        }, 250); // 250ms = 200ms transition + 50ms buffer
        
        return () => clearTimeout(timer);
    }, [isPaletteCollapsed]);
    
    // Save graph changes
    const saveGraph = useCallback((newGraph: BlockGraph) => {
        const updatedGraph = {
            ...newGraph,
            canvas: {
                zoom,
                panX: pan.x,
                panY: pan.y
            }
        };
        
        setGraph(updatedGraph);
        vscode.postMessage({ type: 'update', graph: updatedGraph });
    }, [vscode, zoom, pan]);
    
    // Add block
    const addBlock = useCallback((type: string, position: { x: number; y: number }) => {
        const newBlock: Block = {
            id: `block_${uuidv4()}`,
            type,
            position,
            parameters: {}
        };
        
        // Initialize default parameters
        const metadata = blockMetadata.find(m => m.type === type);
        if (metadata) {
            // This will be populated from block definition
        }
        
        const newGraph = {
            ...graph,
            blocks: [...graph.blocks, newBlock]
        };
        
        saveGraph(newGraph);
        setSelectedBlockId(newBlock.id);
    }, [graph, blockMetadata, saveGraph]);
    
    // Update block
    const updateBlock = useCallback((blockId: string, updates: Partial<Block>) => {
        const newGraph = {
            ...graph,
            blocks: graph.blocks.map(b => 
                b.id === blockId ? { ...b, ...updates } : b
            )
        };
        saveGraph(newGraph);
    }, [graph, saveGraph]);
    
    // Delete block
    const deleteBlock = useCallback((blockId: string) => {
        const newGraph = {
            ...graph,
            blocks: graph.blocks.filter(b => b.id !== blockId),
            connections: graph.connections.filter(
                c => c.from.blockId !== blockId && c.to.blockId !== blockId
            )
        };
        saveGraph(newGraph);
        setSelectedBlockId(null);
    }, [graph, saveGraph]);
    
    // Validate connection before adding
    const validateConnection = useCallback((
        from: { blockId: string; portId: string },
        to: { blockId: string; portId: string }
    ): { valid: boolean; error?: string } => {
        // Find the blocks
        const fromBlock = graph.blocks.find(b => b.id === from.blockId);
        const toBlock = graph.blocks.find(b => b.id === to.blockId);
        
        if (!fromBlock || !toBlock) {
            return { valid: false, error: 'Block not found' };
        }
        
        // Get block metadata
        const fromMetadata = blockMetadata.find(m => m.type === fromBlock.type);
        const toMetadata = blockMetadata.find(m => m.type === toBlock.type);
        
        if (!fromMetadata || !toMetadata) {
            return { valid: false, error: 'Block metadata not found' };
        }
        
        // Find the ports
        const fromPort = fromMetadata.outputs.find(p => p.id === from.portId);
        const toPort = toMetadata.inputs.find(p => p.id === to.portId);
        
        if (!fromPort || !toPort) {
            return { valid: false, error: 'Port not found' };
        }
        
        // Rule 1: Prevent self-loops
        if (from.blockId === to.blockId) {
            return { 
                valid: false, 
                error: `Cannot connect a block to itself (${fromMetadata.name})` 
            };
        }
        
        // Rule 2: Check port type compatibility
        if (fromPort.type !== toPort.type) {
            return { 
                valid: false, 
                error: `Port type mismatch: Cannot connect ${fromPort.type} output '${fromPort.name}' to ${toPort.type} input '${toPort.name}'. Types must match (audio→audio or control→control).` 
            };
        }
        
        // Rule 3: Check for multiple connections to same input
        const existingConnection = graph.connections.find(
            c => c.to.blockId === to.blockId && c.to.portId === to.portId
        );
        
        if (existingConnection) {
            return { 
                valid: false, 
                error: `Input '${toPort.name}' on ${toMetadata.name} is already connected. Each input can only have one source.` 
            };
        }
        
        return { valid: true };
    }, [graph, blockMetadata]);
    
    // Add connection
    const addConnection = useCallback((
        from: { blockId: string; portId: string },
        to: { blockId: string; portId: string }
    ) => {
        // Check if connection already exists
        const exists = graph.connections.some(
            c => c.from.blockId === from.blockId && 
                 c.from.portId === from.portId &&
                 c.to.blockId === to.blockId && 
                 c.to.portId === to.portId
        );
        
        if (exists) return;
        
        // Validate the connection
        const validation = validateConnection(from, to);
        if (!validation.valid) {
            // Show error message to user
            vscode.postMessage({ 
                type: 'error', 
                message: validation.error
            });
            return;
        }
        
        const newConnection: Connection = {
            id: `conn_${uuidv4()}`,
            from,
            to
        };
        
        const newGraph = {
            ...graph,
            connections: [...graph.connections, newConnection]
        };
        
        saveGraph(newGraph);
    }, [graph, saveGraph, validateConnection, vscode]);
    
    // Delete connection
    const deleteConnection = useCallback((connectionId: string) => {
        const newGraph = {
            ...graph,
            connections: graph.connections.filter(c => c.id !== connectionId)
        };
        saveGraph(newGraph);
        setSelectedConnectionId(null);
    }, [graph, saveGraph]);
    
    // Compile
    const handleCompile = useCallback(() => {
        vscode.postMessage({ type: 'compile', graph });
    }, [vscode, graph]);
    
    // Handle wheel (zoom)
    const handleWheel = useCallback((e: any) => {
        e.evt.preventDefault();
        
        const stage = stageRef.current;
        if (!stage) return;
        
        const oldScale = zoom;
        const pointer = stage.getPointerPosition();
        
        const mousePointTo = {
            x: (pointer.x - pan.x) / oldScale,
            y: (pointer.y - pan.y) / oldScale,
        };
        
        const direction = e.evt.deltaY > 0 ? -1 : 1;
        const newScale = Math.max(0.1, Math.min(5, oldScale * (1 + direction * 0.05)));
        
        setZoom(newScale);
        setPan({
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        });
    }, [zoom, pan]);
    
    // Handle canvas drag (pan)
    const handleCanvasMouseDown = useCallback((e: any) => {
        // Check if clicking on empty canvas (not a block or connection)
        const clickedOnEmpty = e.target === e.target.getStage();
        
        if (clickedOnEmpty) {
            // Deselect everything
            setSelectedBlockId(null);
            setSelectedConnectionId(null);
            
            // Only pan with middle mouse or space+drag
            if (e.evt.button === 1 || e.evt.shiftKey) {
                setIsDragging(true);
                setDragStart({ x: e.evt.clientX - pan.x, y: e.evt.clientY - pan.y });
            }
        }
    }, [pan]);
    
    const handleCanvasMouseMove = useCallback((e: any) => {
        if (isDragging) {
            setPan({
                x: e.evt.clientX - dragStart.x,
                y: e.evt.clientY - dragStart.y,
            });
        }
        
        // Update connection preview - use stage coordinates adjusted for zoom/pan
        if (connectingFrom) {
            const stage = stageRef.current;
            if (stage) {
                const pointerPos = stage.getPointerPosition();
                if (pointerPos) {
                    // Convert screen coordinates to canvas coordinates
                    setConnectionPreview({
                        x: (pointerPos.x - pan.x) / zoom,
                        y: (pointerPos.y - pan.y) / zoom
                    });
                }
            }
        }
    }, [isDragging, dragStart, connectingFrom, pan, zoom]);
    
    const handleCanvasMouseUp = useCallback(() => {
        setIsDragging(false);
        // Don't clear connecting state here - let it be cancelled by Escape or completing connection
    }, []);
    
    // Handle block selection
    const handleBlockSelect = useCallback((blockId: string) => {
        setSelectedBlockId(blockId);
        setSelectedConnectionId(null);
    }, []);
    
    // Handle connection selection
    const handleConnectionSelect = useCallback((connectionId: string) => {
        setSelectedConnectionId(connectionId);
        setSelectedBlockId(null);
    }, []);
    
    // Handle port click (start connection)
    const handlePortClick = useCallback((blockId: string, portId: string, isOutput: boolean) => {
        if (isOutput) {
            // Start connection from output
            setConnectingFrom({ blockId, portId });
        } else {
            // Complete connection to input
            if (connectingFrom) {
                addConnection(connectingFrom, { blockId, portId });
                setConnectingFrom(null);
                setConnectionPreview(null);
            }
        }
    }, [connectingFrom, addConnection]);
    
    // Handle keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedBlockId) {
                    deleteBlock(selectedBlockId);
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            } else if (e.key === 'Escape') {
                setSelectedBlockId(null);
                setSelectedConnectionId(null);
                setConnectingFrom(null);
                setConnectionPreview(null);
            }
        };
        
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedBlockId, selectedConnectionId, deleteBlock, deleteConnection]);
    
    // Handle drag and drop from palette
    const handleCanvasDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const blockType = e.dataTransfer.getData('blockType');
        if (blockType && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const x = (e.clientX - rect.left - pan.x) / zoom;
            const y = (e.clientY - rect.top - pan.y) / zoom;
            addBlock(blockType, { x, y });
        }
    }, [addBlock, pan, zoom]);
    
    const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault(); // Allow drop
    }, []);
    
    // Get selected block
    const selectedBlock = selectedBlockId 
        ? graph.blocks.find(b => b.id === selectedBlockId) 
        : null;
    
    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <Toolbar
                onCompile={handleCompile}
                stats={{
                    blocks: graph.blocks.length,
                    connections: graph.connections.length,
                    zoom: Math.round(zoom * 100)
                }}
            />
            
            <BlockPalette
                metadata={blockMetadata}
                onAddBlock={addBlock}
                isCollapsed={isPaletteCollapsed}
                onToggleCollapse={() => setIsPaletteCollapsed(!isPaletteCollapsed)}
            />
            
            <div 
                ref={containerRef} 
                className={`canvas-container ${isPaletteCollapsed ? 'palette-collapsed' : ''}`}
                onDrop={handleCanvasDrop}
                onDragOver={handleCanvasDragOver}
            >
                <Stage
                    ref={stageRef}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    scaleX={zoom}
                    scaleY={zoom}
                    x={pan.x}
                    y={pan.y}
                    onWheel={handleWheel}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    draggable={false}
                >
                    <Layer>
                        {/* Render connections */}
                        {graph.connections.map(conn => {
                            console.log('[Editor] Rendering connection:', conn.id, 'from', conn.from.blockId, conn.from.portId, 'to', conn.to.blockId, conn.to.portId);
                            return (
                                <ConnectionComponent
                                    key={conn.id}
                                    connection={conn}
                                    blocks={graph.blocks}
                                    blockMetadata={blockMetadata}
                                    isSelected={conn.id === selectedConnectionId}
                                    onSelect={() => handleConnectionSelect(conn.id)}
                                />
                            );
                        })}
                        
                        {/* Render connection preview */}
                        {connectingFrom && connectionPreview && (
                            <ConnectionComponent
                                connection={{
                                    id: 'preview',
                                    from: connectingFrom,
                                    to: { blockId: 'preview', portId: 'preview' }
                                }}
                                blocks={graph.blocks}
                                blockMetadata={blockMetadata}
                                isSelected={false}
                                onSelect={() => {}}
                                previewEnd={connectionPreview}
                            />
                        )}
                        
                        {/* Render blocks */}
                        {graph.blocks.map(block => (
                            <BlockComponent
                                key={block.id}
                                block={block}
                                metadata={blockMetadata.find(m => m.type === block.type)}
                                isSelected={block.id === selectedBlockId}
                                onSelect={() => handleBlockSelect(block.id)}
                                onMove={(newPos) => updateBlock(block.id, { position: newPos })}
                                onPortClick={handlePortClick}
                            />
                        ))}
                    </Layer>
                </Stage>
            </div>
            
            {selectedBlock && (
                <PropertyPanel
                    block={selectedBlock}
                    metadata={blockMetadata.find(m => m.type === selectedBlock.type)}
                    onUpdate={(updates) => updateBlock(selectedBlock.id, updates)}
                    onClose={() => setSelectedBlockId(null)}
                />
            )}
        </div>
    );
};
