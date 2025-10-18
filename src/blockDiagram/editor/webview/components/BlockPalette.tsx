/**
 * Block Palette Component - Shows available blocks
 */

import React from 'react';
import { BlockMetadata } from '../../../../types/Block';

interface BlockPaletteProps {
    metadata: BlockMetadata[];
    onAddBlock: (type: string, position: { x: number; y: number }) => void;
}

export const BlockPalette: React.FC<BlockPaletteProps> = ({ metadata, onAddBlock }) => {
    // Group blocks by category
    const categories = metadata.reduce((acc, block) => {
        if (!acc[block.category]) {
            acc[block.category] = [];
        }
        acc[block.category].push(block);
        return acc;
    }, {} as Record<string, BlockMetadata[]>);
    
    const handleDragStart = (e: React.DragEvent, blockType: string) => {
        e.dataTransfer.setData('blockType', blockType);
    };
    
    return (
        <div className="palette">
            {Object.entries(categories).map(([category, blocks]) => (
                <div key={category}>
                    <div className="palette-category">{category}</div>
                    {blocks.map(block => (
                        <div
                            key={block.type}
                            className="palette-block"
                            draggable
                            onDragStart={(e) => handleDragStart(e, block.type)}
                            style={{ borderLeft: `4px solid ${block.color}` }}
                        >
                            <div className="palette-block-name">{block.name}</div>
                            <div className="palette-block-desc">{block.description}</div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};
