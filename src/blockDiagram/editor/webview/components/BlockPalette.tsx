/**
 * Block Palette Component - Shows available blocks
 */

import React, { useState, useEffect } from 'react';
import { BlockMetadata } from '../../../types/Block';

interface BlockPaletteProps {
    metadata: BlockMetadata[];
    onAddBlock: (type: string, position: { x: number; y: number }) => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    vscode: any;
}

export const BlockPalette: React.FC<BlockPaletteProps> = ({ metadata, onAddBlock, isCollapsed, onToggleCollapse, vscode }) => {

    // Group blocks by category
    const categories = metadata.reduce((acc, block) => {
        if (!acc[block.category]) {
            acc[block.category] = [];
        }
        acc[block.category].push(block);
        return acc;
    }, {} as Record<string, BlockMetadata[]>);

    // Track which categories are expanded (all collapsed by default)
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    // Listen for saved state from VS Code
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'paletteState' && message.expandedCategories) {
                setExpandedCategories(new Set(message.expandedCategories));
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Save state whenever it changes
    useEffect(() => {
        vscode.postMessage({
            type: 'savePaletteState',
            expandedCategories: Array.from(expandedCategories)
        });
    }, [expandedCategories, vscode]);

    const toggleCategory = (category: string) => {
        const newExpanded = new Set(expandedCategories);
        if (newExpanded.has(category)) {
            newExpanded.delete(category);
        } else {
            newExpanded.add(category);
        }
        setExpandedCategories(newExpanded);
    };

    const handleDragStart = (e: React.DragEvent, blockType: string) => {
        e.dataTransfer.setData('blockType', blockType);
    };

    return (
        <>
            <div className={`palette ${isCollapsed ? 'collapsed' : ''}`}>
                {!isCollapsed && (
                    <div className="palette-content">
                        {Object.entries(categories)
                            .sort(([a], [b]) => {
                                if (a === 'SpinCAD') return 1;
                                if (b === 'SpinCAD') return -1;
                                return a.localeCompare(b);
                            })
                            .map(([category, blocks]) => {
                                const isExpanded = expandedCategories.has(category);
                                return (
                                    <div key={category} className="palette-category-section">
                                        <div
                                            className="palette-category"
                                            onClick={() => toggleCategory(category)}
                                            style={{ cursor: 'pointer', userSelect: 'none' }}
                                        >
                                            <span className="category-toggle-icon">
                                                {isExpanded ? '▼' : '▶'}
                                            </span>
                                            {category}
                                        </div>
                                        {isExpanded && (
                                            <div className="palette-category-blocks">
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
                                        )}
                                    </div>
                                );
                            })}
                    </div>
                )}
            </div>
            <button
                className="palette-toggle-handle"
                onClick={onToggleCollapse}
                title={isCollapsed ? 'Show block palette' : 'Hide block palette'}
            >
                <div className="palette-toggle-icon">
                    {isCollapsed ? '›' : '‹'}
                </div>
            </button>
        </>
    );
};
