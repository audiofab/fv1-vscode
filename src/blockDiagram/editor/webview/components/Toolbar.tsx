/**
 * Toolbar Component
 */

import React from 'react';

interface ToolbarProps {
    stats: {
        blocks: number;
        connections: number;
        zoom: number;
    };
}

export const Toolbar: React.FC<ToolbarProps> = ({ stats }) => {
    return (
        <div className="toolbar">
            <div className="stats">
                Blocks: {stats.blocks} | Connections: {stats.connections} | Zoom: {stats.zoom}%
            </div>
        </div>
    );
};
