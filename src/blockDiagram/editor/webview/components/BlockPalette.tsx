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

    // Group blocks by category and subcategory
    const hierarchy = metadata.reduce((acc, block) => {
        if (!acc[block.category]) {
            acc[block.category] = { blocks: [], subcategories: {} };
        }

        if (block.subcategory) {
            if (!acc[block.category].subcategories[block.subcategory]) {
                acc[block.category].subcategories[block.subcategory] = [];
            }
            acc[block.category].subcategories[block.subcategory].push(block);
        } else {
            acc[block.category].blocks.push(block);
        }

        return acc;
    }, {} as Record<string, { blocks: BlockMetadata[], subcategories: Record<string, BlockMetadata[]> }>);

    // Track which categories/subcategories are expanded (all collapsed by default)
    // Format: "Category" or "Category::Subcategory"
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

    // Listen for saved state from VS Code
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'paletteState' && message.expandedCategories) {
                setExpandedNodes(new Set(message.expandedCategories));
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Save state whenever it changes
    useEffect(() => {
        vscode.postMessage({
            type: 'savePaletteState',
            expandedCategories: Array.from(expandedNodes)
        });
    }, [expandedNodes, vscode]);

    const toggleNode = (nodeId: string) => {
        const newExpanded = new Set(expandedNodes);
        if (newExpanded.has(nodeId)) {
            newExpanded.delete(nodeId);
        } else {
            newExpanded.add(nodeId);
        }
        setExpandedNodes(newExpanded);
    };

    const handleDragStart = (e: React.DragEvent, blockType: string) => {
        e.dataTransfer.setData('blockType', blockType);
    };

    return (
        <>
            <div className={`palette ${isCollapsed ? 'collapsed' : ''}`}>
                {!isCollapsed && (
                    <div className="palette-content">
                        {Object.entries(hierarchy)
                            .sort(([a], [b]) => {
                                if (a === 'SpinCAD (elmgen)') return 1;
                                if (b === 'SpinCAD (elmgen)') return -1;
                                if (a === 'SpinCAD') return 1;
                                if (b === 'SpinCAD') return -1;
                                return a.localeCompare(b);
                            })
                            .map(([category, content]) => {
                                const isExpanded = expandedNodes.has(category);
                                return (
                                    <div key={category} className="palette-category-section">
                                        <div
                                            className="palette-category"
                                            onClick={() => toggleNode(category)}
                                            style={{ cursor: 'pointer', userSelect: 'none' }}
                                        >
                                            <span className="category-toggle-icon">
                                                {isExpanded ? '▼' : '▶'}
                                            </span>
                                            {category}
                                        </div>
                                        {isExpanded && (
                                            <div className="palette-category-blocks">
                                                {/* Render subcategories first */}
                                                {Object.entries(content.subcategories)
                                                    .sort(([a], [b]) => a.localeCompare(b))
                                                    .map(([subcategory, blocks]) => {
                                                        const subId = `${category}::${subcategory}`;
                                                        const isSubExpanded = expandedNodes.has(subId);
                                                        return (
                                                            <div key={subId} className="palette-subcategory-section" style={{ marginLeft: '10px' }}>
                                                                <div
                                                                    className="palette-subcategory"
                                                                    onClick={() => toggleNode(subId)}
                                                                    style={{ cursor: 'pointer', userSelect: 'none', padding: '4px 8px', fontSize: '0.9em', color: 'var(--vscode-descriptionForeground)' }}
                                                                >
                                                                    <span className="category-toggle-icon" style={{ fontSize: '0.8em', marginRight: '4px' }}>
                                                                        {isSubExpanded ? '▼' : '▶'}
                                                                    </span>
                                                                    {subcategory}
                                                                </div>
                                                                {isSubExpanded && (
                                                                    <div className="palette-subcategory-blocks" style={{ marginLeft: '10px' }}>
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

                                                {/* Render blocks directly in this category */}
                                                {content.blocks.map(block => (
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
