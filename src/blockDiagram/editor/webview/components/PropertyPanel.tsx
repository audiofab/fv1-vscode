/**
 * Property Panel Component - Shows and edits selected block properties
 */

import React from 'react';
import { Block, BlockMetadata } from '../../../../types/Block';

interface PropertyPanelProps {
    block: Block;
    metadata?: BlockMetadata;
    onUpdate: (updates: Partial<Block>) => void;
    onClose: () => void;
}

export const PropertyPanel: React.FC<PropertyPanelProps> = ({
    block,
    metadata,
    onUpdate,
    onClose
}) => {
    if (!metadata) return null;
    
    const handleParameterChange = (paramId: string, value: any) => {
        onUpdate({
            parameters: {
                ...block.parameters,
                [paramId]: value
            }
        });
    };
    
    return (
        <div className="property-panel">
            <h3>{metadata.name}</h3>
            <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginBottom: '16px' }}>
                {metadata.description}
            </p>
            
            {metadata.parameters && metadata.parameters.length > 0 && (
                <div>
                    <h4 style={{ marginBottom: '12px', fontSize: '12px' }}>Parameters</h4>
                    
                    {metadata.parameters.map(param => {
                        const value = block.parameters[param.id] ?? param.default;
                        
                        return (
                            <div key={param.id} className="property-group">
                                <label className="property-label">
                                    {param.name}
                                    {param.description && (
                                        <span style={{ display: 'block', fontSize: '10px', fontWeight: 'normal' }}>
                                            {param.description}
                                        </span>
                                    )}
                                </label>
                                
                                {param.type === 'number' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input
                                            type="number"
                                            className="property-input"
                                            value={value}
                                            min={param.min}
                                            max={param.max}
                                            step={param.step}
                                            onChange={(e) => handleParameterChange(param.id, parseFloat(e.target.value))}
                                        />
                                        <input
                                            type="range"
                                            style={{ flex: 1 }}
                                            value={value}
                                            min={param.min}
                                            max={param.max}
                                            step={param.step}
                                            onChange={(e) => handleParameterChange(param.id, parseFloat(e.target.value))}
                                        />
                                    </div>
                                )}
                                
                                {param.type === 'select' && (
                                    <select
                                        className="property-input"
                                        value={value}
                                        onChange={(e) => handleParameterChange(param.id, e.target.value)}
                                    >
                                        {param.options?.map(opt => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                
                                {param.type === 'boolean' && (
                                    <input
                                        type="checkbox"
                                        checked={value}
                                        onChange={(e) => handleParameterChange(param.id, e.target.checked)}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            
            <button
                onClick={onClose}
                style={{
                    marginTop: '16px',
                    width: '100%',
                    padding: '6px',
                    backgroundColor: 'var(--vscode-button-background)',
                    color: 'var(--vscode-button-foreground)',
                    border: 'none',
                    borderRadius: '2px',
                    cursor: 'pointer'
                }}
            >
                Close
            </button>
        </div>
    );
};
