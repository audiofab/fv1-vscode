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
    
    // Track last position to calculate delta
    const lastPosRef = useRef({ x: block.position.x, y: block.position.y });
    
    return (
        <Group
            x={block.position.x}
            y={block.position.y}
            draggable
            onDragStart={() => {
                // Reset tracking position at start of drag
                lastPosRef.current = { x: block.position.x, y: block.position.y };
            }}
            onDragMove={(e) => {
                // Calculate delta from last position
                const newX = e.target.x();
                const newY = e.target.y();
                const delta = {
                    x: newX - lastPosRef.current.x,
                    y: newY - lastPosRef.current.y
                };
                lastPosRef.current = { x: newX, y: newY };
                onMove(delta);
            }}
            onDragEnd={(e) => {
                // Final delta calculation
                const newX = e.target.x();
                const newY = e.target.y();
                const delta = {
                    x: newX - lastPosRef.current.x,
                    y: newY - lastPosRef.current.y
                };
                if (delta.x !== 0 || delta.y !== 0) {
                    onMove(delta);
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
