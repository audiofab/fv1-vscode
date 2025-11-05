/**
 * Connection Component - Renders bezier curves between blocks
 */

import React from 'react';
import { Line } from 'react-konva';
import { Connection } from '../../../../types/Connection';
import { Block, BlockMetadata } from '../../../../types/Block';

interface ConnectionComponentProps {
    connection: Connection;
    blocks: Block[];
    blockMetadata: BlockMetadata[];
    isSelected: boolean;
    onSelect: () => void;
    previewEnd?: { x: number; y: number };
}

export const ConnectionComponent: React.FC<ConnectionComponentProps> = ({
    connection,
    blocks,
    blockMetadata,
    isSelected,
    onSelect,
    previewEnd
}) => {
    // Find source and destination blocks
    const fromBlock = blocks.find(b => b.id === connection.from.blockId);
    const toBlock = previewEnd ? null : blocks.find(b => b.id === connection.to.blockId);
    
    if (!fromBlock) {
        console.warn('[Connection] fromBlock not found:', connection.from.blockId);
        return null;
    }
    
    // Get metadata
    const fromMetadata = blockMetadata.find(m => m.type === fromBlock.type);
    if (!fromMetadata) {
        console.warn('[Connection] fromMetadata not found for type:', fromBlock.type);
        return null;
    }
    
    // Calculate port positions
    const fromOutputIndex = fromMetadata.outputs.findIndex(o => o.id === connection.from.portId);
    if (fromOutputIndex === -1) {
        console.warn('[Connection] fromPort not found:', connection.from.portId, 'in outputs:', fromMetadata.outputs.map(o => o.id));
        return null;
    }
    
    const fromX = fromBlock.position.x + (fromMetadata.width || 200);
    const fromY = fromBlock.position.y + 40 + fromOutputIndex * 20;
    
    let toX, toY;
    
    if (previewEnd) {
        // Preview mode
        toX = previewEnd.x;
        toY = previewEnd.y;
    } else if (toBlock) {
        const toMetadata = blockMetadata.find(m => m.type === toBlock.type);
        if (!toMetadata) {
            console.warn('[Connection] toMetadata not found for type:', toBlock.type);
            return null;
        }
        
        const toInputIndex = toMetadata.inputs.findIndex(i => i.id === connection.to.portId);
        if (toInputIndex === -1) {
            console.warn('[Connection] toPort not found:', connection.to.portId, 'in inputs:', toMetadata.inputs.map(i => i.id));
            return null;
        }
        
        toX = toBlock.position.x;
        toY = toBlock.position.y + 40 + toInputIndex * 20;
    } else {
        console.warn('[Connection] toBlock not found:', connection.to.blockId);
        return null;
    }
    
    // Calculate bezier control points with guaranteed perpendicular segments
    const dx = toX - fromX;
    const dy = toY - fromY;
    
    // Guaranteed minimum perpendicular segment length (always visible)
    // Use a larger minimum to ensure connections are always visible at ports
    const minPerpendicularLength = 80; // Minimum 80 pixels horizontal from each port
    
    // For very close blocks, still maintain minimum distance
    // For far blocks, can use a percentage-based approach
    const perpendicularLength = Math.max(
        minPerpendicularLength, 
        Math.min(150, Math.abs(dx) * 0.4) // Max 150px, or 40% of distance
    );
    
    // Control points create guaranteed horizontal segments at both ends
    const controlPoint1X = fromX + perpendicularLength;
    const controlPoint2X = toX - perpendicularLength;
    
    const points = [
        fromX, fromY,
        controlPoint1X, fromY,
        controlPoint2X, toY,
        toX, toY
    ];
    
    return (
        <Line
            points={points}
            stroke={isSelected ? '#FFD700' : (previewEnd ? '#888' : '#666')}
            strokeWidth={isSelected ? 3 : 2}
            hitStrokeWidth={20}
            tension={0}
            bezier
            onClick={onSelect}
            onTap={onSelect}
            dash={previewEnd ? [5, 5] : undefined}
        />
    );
};
