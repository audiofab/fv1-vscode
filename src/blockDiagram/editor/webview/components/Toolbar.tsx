/**
 * Toolbar Component
 */

import React from 'react';

interface ToolbarProps {
    onCompile: () => void;
    stats: {
        blocks: number;
        connections: number;
        zoom: number;
    };
}

export const Toolbar: React.FC<ToolbarProps> = ({ onCompile, stats }) => {
    return (
        <div className="toolbar">
            <button onClick={onCompile}>
                🔧 Compile
            </button>
            
            <div className="stats">
                Blocks: {stats.blocks} | Connections: {stats.connections} | Zoom: {stats.zoom}%
            </div>
        </div>
    );
};
