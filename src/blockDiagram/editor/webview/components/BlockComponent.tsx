/**
 * Block Component - Renders a single block on the canvas
 */

import React, { useRef } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import { Block, BlockMetadata } from '../../../../types/Block';

interface BlockComponentProps {
    block: Block;
    metadata?: BlockMetadata;
    isSelected: boolean;
    onSelect: (ctrlKey: boolean) => void;
    onMove: (delta: { x: number; y: number }) => void;
    onPortClick: (blockId: string, portId: string, isOutput: boolean) => void;
}

export const BlockComponent: React.FC<BlockComponentProps> = ({
    block,
    metadata,
    isSelected,
    onSelect,
    onMove,
    onPortClick
}) => {
    if (!metadata) return null;
    
    const width = metadata.width || 200;
    const height = metadata.height || 100;
    const color = metadata.color || '#607D8B';
    const portRadius = 6;
    const portSpacing = 20;
    
    const dragStateRef = useRef({ 
        isDragging: false,
        frameCount: 0
    });
    
    return (
        <Group
            x={block.position.x}
            y={block.position.y}
            draggable
            onDragStart={() => {
                dragStateRef.current = {
                    isDragging: true,
                    frameCount: 0
                };
            }}
            onDragMove={(e) => {
                if (!dragStateRef.current.isDragging) return;
                
                dragStateRef.current.frameCount++;
                
                // Get Konva's current position
                const konvaX = e.target.x();
                const konvaY = e.target.y();
                
                // Calculate delta from current block.position (not cached value)
                // This prevents accumulated error since block.position is the source of truth
                const delta = {
                    x: konvaX - block.position.x,
                    y: konvaY - block.position.y
                };
                
                // Update every few frames to reduce update frequency but stay responsive
                // Use modulo to throttle: update every 2nd frame for smoother performance
                if (dragStateRef.current.frameCount % 2 === 0 && (Math.abs(delta.x) > 0.1 || Math.abs(delta.y) > 0.1)) {
                    onMove(delta);
                }
            }}
            onDragEnd={(e) => {
                if (!dragStateRef.current.isDragging) return;
                
                // Calculate final delta from current block.position to Konva's end position
                const konvaX = e.target.x();
                const konvaY = e.target.y();
                const finalDelta = {
                    x: konvaX - block.position.x,
                    y: konvaY - block.position.y
                };
                
                dragStateRef.current.isDragging = false;
                
                // Always send final update to ensure perfect sync
                if (Math.abs(finalDelta.x) > 0.01 || Math.abs(finalDelta.y) > 0.01) {
                    onMove(finalDelta);
                }
            }}
            onClick={(e) => {
                onSelect(e.evt.ctrlKey || e.evt.metaKey);
            }}
            onTap={(e) => {
                onSelect(false); // Touch doesn't have ctrl key
            }}
        >
            {/* Main block rectangle */}
            <Rect
                width={width}
                height={height}
                fill={color}
                stroke={isSelected ? '#FFD700' : '#000'}
                strokeWidth={isSelected ? 3 : 1}
                cornerRadius={4}
                shadowColor="black"
                shadowBlur={10}
                shadowOpacity={0.3}
                shadowOffsetX={2}
                shadowOffsetY={2}
            />
            
            {/* Block title */}
            <Text
                text={metadata.name}
                x={10}
                y={10}
                width={width - 20}
                fontSize={14}
                fontStyle="bold"
                fill="white"
            />
            
            {/* Input ports */}
            {metadata.inputs.map((input, index) => {
                const y = 40 + index * portSpacing;
                const portColor = input.type === 'control' ? '#FF9800' : '#4CAF50';
                return (
                    <Group key={input.id}>
                        <Circle
                            x={0}
                            y={y}
                            radius={portRadius}
                            fill={portColor}
                            stroke="white"
                            strokeWidth={2}
                            onMouseUp={(e) => {
                                e.cancelBubble = true;
                                onPortClick(block.id, input.id, false);
                            }}
                            onTouchEnd={(e) => {
                                e.cancelBubble = true;
                                onPortClick(block.id, input.id, false);
                            }}
                        />
                        <Text
                            text={input.name}
                            x={portRadius + 5}
                            y={y - 6}
                            fontSize={10}
                            fill="white"
                        />
                    </Group>
                );
            })}
            
            {/* Output ports */}
            {metadata.outputs.map((output, index) => {
                const y = 40 + index * portSpacing;
                return (
                    <Group key={output.id}>
                        <Circle
                            x={width}
                            y={y}
                            radius={portRadius}
                            fill="#2196F3"
                            stroke="white"
                            strokeWidth={2}
                            onMouseDown={(e) => {
                                e.cancelBubble = true;
                                onPortClick(block.id, output.id, true);
                            }}
                            onTouchStart={(e) => {
                                e.cancelBubble = true;
                                onPortClick(block.id, output.id, true);
                            }}
                        />
                        <Text
                            text={output.name}
                            x={width - portRadius - 5 - output.name.length * 6}
                            y={y - 6}
                            fontSize={10}
                            fill="white"
                        />
                    </Group>
                );
            })}
        </Group>
    );
};
