/**
 * Block Component - Renders a single block on the canvas
 */

import React from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import { Block, BlockMetadata } from '../../../../types/Block';

interface BlockComponentProps {
    block: Block;
    metadata?: BlockMetadata;
    isSelected: boolean;
    onSelect: () => void;
    onMove: (position: { x: number; y: number }) => void;
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
    
    return (
        <Group
            x={block.position.x}
            y={block.position.y}
            draggable
            onDragMove={(e) => {
                // Update position during drag for real-time connection updates
                onMove({
                    x: e.target.x(),
                    y: e.target.y()
                });
            }}
            onDragEnd={(e) => {
                onMove({
                    x: e.target.x(),
                    y: e.target.y()
                });
            }}
            onClick={onSelect}
            onTap={onSelect}
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
