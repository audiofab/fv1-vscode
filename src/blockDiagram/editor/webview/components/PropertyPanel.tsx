/**
 * Property Panel Component - Shows and edits selected block properties
 */

import React, { useEffect, useState } from 'react';
import { Block, BlockMetadata } from '../../../../types/Block';

interface PropertyPanelProps {
    block: Block;
    metadata?: BlockMetadata;
    onUpdate: (updates: Partial<Block>) => void;
    onClose: () => void;
    vscode: any;
}

export const PropertyPanel: React.FC<PropertyPanelProps> = ({
    block,
    metadata,
    onUpdate,
    onClose,
    vscode
}) => {
    if (!metadata) return null;

    // Track display values for all parameters
    const [displayValues, setDisplayValues] = useState<Record<string, number>>({});
    // Track raw string input while user is actively typing (to allow '-', '.' etc)
    const [rawInputValues, setRawInputValues] = useState<Record<string, string>>({});

    // Convert code values to display values when block or metadata changes
    useEffect(() => {
        if (!metadata) return;

        const newDisplayValues: Record<string, number> = {};

        metadata.parameters.forEach(param => {
            const codeValue = block.parameters[param.id] ?? param.default;

            if (param.type === 'number' && (param.displayMin !== undefined || param.toDisplay)) {
                // Request conversion from extension
                const requestId = `${block.id}_${param.id}_${Date.now()}`;

                const messageHandler = (event: MessageEvent) => {
                    const message = event.data;
                    if (message.type === 'convertToDisplayResponse' && message.requestId === requestId) {
                        window.removeEventListener('message', messageHandler);
                        if (!message.error) {
                            // Store the converted value as-is
                            setDisplayValues(prev => ({
                                ...prev,
                                [param.id]: message.displayValue
                            }));
                        }
                    }
                };

                window.addEventListener('message', messageHandler);

                vscode.postMessage({
                    type: 'convertToDisplay',
                    blockType: metadata.type,
                    parameterId: param.id,
                    codeValue,
                    requestId
                });
            } else {
                newDisplayValues[param.id] = codeValue;
            }
        });

        // Set initial values for non-converted parameters
        setDisplayValues(prev => ({ ...prev, ...newDisplayValues }));
    }, [block, metadata, vscode]);

    const handleParameterChange = (paramId: string, value: any) => {
        onUpdate({
            parameters: {
                ...block.parameters,
                [paramId]: value
            }
        });
    };

    const handleDisplayValueChange = (paramId: string, newDisplayValue: number) => {
        const param = metadata.parameters.find(p => p.id === paramId);
        if (!param) return;

        // Update display value immediately for responsive UI
        setDisplayValues(prev => ({
            ...prev,
            [paramId]: newDisplayValue
        }));

        // Request conversion from extension
        const requestId = `${block.id}_${paramId}_${Date.now()}`;

        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'convertToCodeResponse' && message.requestId === requestId) {
                window.removeEventListener('message', messageHandler);
                if (!message.error) {
                    handleParameterChange(paramId, message.codeValue);
                }
            }
        };

        window.addEventListener('message', messageHandler);

        vscode.postMessage({
            type: 'convertToCode',
            blockType: metadata.type,
            parameterId: paramId,
            displayValue: newDisplayValue,
            requestId
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

                    {metadata.parameters.map((param: any) => {
                        // Get the raw display value from state
                        const rawDisplayValue = displayValues[param.id] ?? (block.parameters[param.id] ?? param.default);

                        // Use display range if available, otherwise use code range
                        const minValue = param.displayMin ?? param.min;
                        const maxValue = param.displayMax ?? param.max;
                        const stepValue = param.displayStep ?? param.step;
                        const decimals = param.displayDecimals ?? 2;

                        // Format display value
                        const displayValue = typeof rawDisplayValue === 'number'
                            ? parseFloat(rawDisplayValue.toFixed(decimals))
                            : rawDisplayValue;

                        // Check visibility condition
                        if (param.visibleIf) {
                            try {
                                const match = param.visibleIf.match(/(\w+)\s*(==|!=)\s*(['"]?[\w.-]+['"]?)/);
                                if (match) {
                                    const [, key, op, valStr] = match;
                                    const currentVal = block.parameters[key] ?? metadata.parameters.find((p: any) => p.id === key)?.default;
                                    const targetVal = valStr.replace(/['"]/g, '');

                                    let comparisonVal: any = targetVal;
                                    if (typeof currentVal === 'number') comparisonVal = parseFloat(targetVal);
                                    if (typeof currentVal === 'boolean') comparisonVal = (targetVal === 'true');

                                    const isVisible = op === '==' ? currentVal === comparisonVal : currentVal !== comparisonVal;
                                    if (!isVisible) return null;
                                }
                            } catch (e) {
                                console.error('Failed to evaluate visibility condition:', param.visibleIf, e);
                            }
                        }

                        return (
                            <div key={param.id} className="property-group">
                                <label className="property-label">
                                    {param.name}
                                    {param.displayUnit && (
                                        <span style={{ fontSize: '10px', fontWeight: 'normal', marginLeft: '4px' }}>
                                            ({param.displayUnit})
                                        </span>
                                    )}
                                    {param.description && (
                                        <span style={{ display: 'block', fontSize: '10px', fontWeight: 'normal' }}>
                                            {param.description}
                                        </span>
                                    )}
                                </label>

                                {param.type === 'number' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            className="property-input"
                                            value={rawInputValues[param.id] ?? String(displayValue)}
                                            style={{ width: '72px', flexShrink: 0 }}
                                            onChange={(e) => {
                                                const raw = e.target.value;
                                                // Always accept the raw string so '-' and '.' work as first chars
                                                setRawInputValues(prev => ({ ...prev, [param.id]: raw }));
                                                // Optimistically update the range slider if the value is already parseable
                                                const parsed = parseFloat(raw);
                                                if (!isNaN(parsed)) {
                                                    setDisplayValues(prev => ({ ...prev, [param.id]: parsed }));
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    e.currentTarget.blur();
                                                } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                                    // Step up/down by configured step value
                                                    e.preventDefault();
                                                    const current = parseFloat(rawInputValues[param.id] ?? String(displayValue));
                                                    if (isNaN(current)) return;
                                                    const step = stepValue ?? 1;
                                                    const next = parseFloat((current + (e.key === 'ArrowUp' ? step : -step)).toFixed(decimals));
                                                    const clamped = Math.min(maxValue ?? Infinity, Math.max(minValue ?? -Infinity, next));
                                                    setRawInputValues(prev => ({ ...prev, [param.id]: String(clamped) }));
                                                    setDisplayValues(prev => ({ ...prev, [param.id]: clamped }));
                                                }
                                            }}
                                            onFocus={(e) => {
                                                // Seed raw buffer from current display value when entering the field
                                                setRawInputValues(prev => ({
                                                    ...prev,
                                                    [param.id]: prev[param.id] ?? String(displayValue)
                                                }));
                                            }}
                                            onBlur={(e) => {
                                                // Parse and commit on blur; revert raw buffer to committed value
                                                const parsed = parseFloat(e.target.value);
                                                const committed = isNaN(parsed) ? displayValue : parsed;
                                                setRawInputValues(prev => ({ ...prev, [param.id]: String(committed) }));
                                                if (!isNaN(parsed)) {
                                                    if (param.displayMin !== undefined || param.displayMax !== undefined) {
                                                        handleDisplayValueChange(param.id, committed);
                                                    } else {
                                                        handleParameterChange(param.id, committed);
                                                    }
                                                }
                                            }}
                                        />
                                        <input
                                            type="range"
                                            style={{ flex: 1 }}
                                            value={displayValue}
                                            min={minValue}
                                            max={maxValue}
                                            step={stepValue}
                                            onChange={(e) => {
                                                const newDisplayValue = parseFloat(e.target.value);
                                                // Sync raw buffer so the text field stays in step with the slider
                                                setRawInputValues(prev => ({ ...prev, [param.id]: String(newDisplayValue) }));
                                                if (param.displayMin !== undefined || param.displayMax !== undefined) {
                                                    handleDisplayValueChange(param.id, newDisplayValue);
                                                } else {
                                                    handleParameterChange(param.id, newDisplayValue);
                                                }
                                            }}
                                        />
                                    </div>
                                )}

                                {param.type === 'select' && (
                                    <select
                                        className="property-input"
                                        value={block.parameters[param.id] ?? param.default}
                                        onChange={(e) => {
                                            // Parse the value to match the type of the default
                                            let value: any = e.target.value;
                                            if (typeof param.default === 'number') {
                                                value = parseFloat(value);
                                            } else if (typeof param.default === 'boolean') {
                                                value = value === 'true';
                                            }
                                            handleParameterChange(param.id, value);
                                        }}
                                    >
                                        {param.options?.map((opt: any) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                )}

                                {param.type === 'boolean' && (
                                    <input
                                        type="checkbox"
                                        checked={block.parameters[param.id] ?? param.default}
                                        onChange={(e) => handleParameterChange(param.id, e.target.checked)}
                                    />
                                )}

                                {param.type === 'string' && (
                                    param.multiline ? (
                                        <textarea
                                            className="property-input"
                                            style={{
                                                width: '100%',
                                                minHeight: '100px',
                                                fontFamily: 'var(--vscode-editor-font-family)',
                                                fontSize: '12px',
                                                resize: 'vertical'
                                            }}
                                            value={block.parameters[param.id] ?? param.default}
                                            onChange={(e) => handleParameterChange(param.id, e.target.value)}
                                        />
                                    ) : (
                                        <input
                                            type="text"
                                            className="property-input"
                                            value={block.parameters[param.id] ?? param.default}
                                            onChange={(e) => handleParameterChange(param.id, e.target.value)}
                                        />
                                    )
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
