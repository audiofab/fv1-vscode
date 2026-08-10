/**
 * Block Component - Renders a single block on the canvas
 */

import React, { useRef, useState, useEffect } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import { PORT_RADIUS, PORT_SPACING, PORT_HIT_RADIUS, PORT_Y_OFFSET } from './portGeometry.js';
import type { Block, BlockMetadata } from '@audiofab-io/fv1-core/blockDiagram';

/**
 * Calculate relative luminance of a color
 * Returns a value between 0 (black) and 1 (white)
 */
function getLuminance(hexColor: string): number {
    // Remove # if present
    const hex = hexColor.replace('#', '');

    // Parse RGB values
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    // Apply gamma correction
    const rsRGB = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const gsRGB = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const bsRGB = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

    // Calculate relative luminance
    return 0.2126 * rsRGB + 0.7152 * gsRGB + 0.0722 * bsRGB;
}

/**
 * Determine text color (dark or light) based on background luminance
 * Uses WCAG contrast guidelines
 */
function getTextColor(backgroundColor: string): string {
    const luminance = getLuminance(backgroundColor);
    // If luminance is above 0.5, use dark text, otherwise use light
    return luminance > 0.5 ? '#212121' : '#ffffff';
}

interface BlockComponentProps {
    block: Block;
    metadata?: BlockMetadata;
    isSelected: boolean;
    onSelect: (ctrlKey: boolean) => void;
    onMove: (delta: { x: number; y: number }) => void;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    onPortClick: (blockId: string, portId: string, isOutput: boolean) => void;
    onContextMenu?: (e: any) => void;
    /** Port a dragged wire is currently snapped to, so it can be highlighted. */
    snapPort?: { blockId: string; portId: string } | null;
    vscode: any;
}

export const BlockComponent: React.FC<BlockComponentProps> = ({
    block,
    metadata,
    isSelected,
    onSelect,
    onMove,
    onDragStart,
    onDragEnd,
    onPortClick,
    onContextMenu,
    snapPort,
    vscode
}) => {
    if (!metadata) return null;

    const [customLabel, setCustomLabel] = useState<string | null>(null);

    const width = metadata.width || 200;
    const height = metadata.height || 100;
    const color = metadata.color || '#607D8B';
    const textColor = getTextColor(color);
    const portRadius = PORT_RADIUS;
    const portSpacing = PORT_SPACING;
    const isSnapped = (portId: string) =>
        !!snapPort && snapPort.blockId === block.id && snapPort.portId === portId;

    const dragStateRef = useRef({
        isDragging: false,
        frameCount: 0
    });

    // Request custom label if block supports it
    useEffect(() => {
        if (metadata.hasCustomLabel) {
            // Listen for custom label response
            const handleMessage = (event: MessageEvent) => {
                const message = event.data;
                if (message.type === 'customLabelResponse' && message.blockId === block.id) {
                    setCustomLabel(message.label);
                }
            };

            window.addEventListener('message', handleMessage);

            // Request custom label
            vscode.postMessage({
                type: 'getCustomLabel',
                blockId: block.id,
                blockType: block.type,
                parameters: block.parameters
            });

            return () => {
                window.removeEventListener('message', handleMessage);
            };
        }
    }, [block.id, block.type, block.parameters, metadata.hasCustomLabel]);

    return (
        <Group
            x={block.position.x}
            y={block.position.y}
            draggable
            onDragStart={() => {
                dragStateRef.current = {
                    isDragging: true,
                    frameCount: 0
                };
                onDragStart?.();
            }}
            onDragMove={(e) => {
                if (!dragStateRef.current.isDragging) return;

                dragStateRef.current.frameCount++;

                // Get Konva's current position
                const konvaX = e.target.x();
                const konvaY = e.target.y();

                // Calculate delta from current block.position (not cached value)
                // This prevents accumulated error since block.position is the source of truth
                const delta = {
                    x: konvaX - block.position.x,
                    y: konvaY - block.position.y
                };

                // Update every few frames to reduce update frequency but stay responsive
                // Use modulo to throttle: update every 2nd frame for smoother performance
                if (dragStateRef.current.frameCount % 2 === 0 && (Math.abs(delta.x) > 0.1 || Math.abs(delta.y) > 0.1)) {
                    onMove(delta);
                }
            }}
            onDragEnd={(e) => {
                if (!dragStateRef.current.isDragging) return;

                // Calculate final delta from current block.position to Konva's end position
                const konvaX = e.target.x();
                const konvaY = e.target.y();
                const finalDelta = {
                    x: konvaX - block.position.x,
                    y: konvaY - block.position.y
                };

                dragStateRef.current.isDragging = false;

                // Always send final update to ensure perfect sync
                if (Math.abs(finalDelta.x) > 0.01 || Math.abs(finalDelta.y) > 0.01) {
                    onMove(finalDelta);
                }

                onDragEnd?.();
            }}
            onClick={(e) => {
                onSelect(e.evt.ctrlKey || e.evt.metaKey);
            }}
            onContextMenu={(e) => {
                if (onContextMenu) {
                    onContextMenu(e);
                }
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
                fill={textColor}
            />

            {/* Custom label (if available) */}
            {customLabel && (
                <Text
                    text={customLabel}
                    x={block.type.includes('stickynote') ? 10 : 0}
                    y={block.type.includes('stickynote') ? 30 : height / 2}
                    width={block.type.includes('stickynote') ? width - 20 : width}
                    height={block.type.includes('stickynote') ? height - 40 : undefined}
                    align={block.type.includes('stickynote') ? 'left' : 'center'}
                    verticalAlign={block.type.includes('stickynote') ? 'top' : 'middle'}
                    fontSize={block.type.includes('stickynote') ? 10 : 12}
                    fill={block.type.includes('stickynote') ? '#333' : textColor}
                    wrap="word"
                    ellipsis={block.type.includes('stickynote') ? true : false}
                />
            )}

            {/* Input ports */}
            {metadata.inputs.map((input, index) => {
                const y = PORT_Y_OFFSET + index * portSpacing;
                const portColor = input.type === 'control' ? '#FF9800' : '#4CAF50';
                return (
                    <Group key={input.id}>
                        {/* Invisible, larger grab target. Sits under the visible
                            dot and carries the handlers so the port can be hit
                            without pixel-hunting. */}
                        <Circle
                            x={0}
                            y={y}
                            radius={PORT_HIT_RADIUS}
                            fill="transparent"
                            onMouseUp={(e) => {
                                e.cancelBubble = true;
                                onPortClick(block.id, input.id, false);
                            }}
                            onTouchEnd={(e) => {
                                e.cancelBubble = true;
                                onPortClick(block.id, input.id, false);
                            }}
                        />
                        {isSnapped(input.id) && (
                            <Circle
                                x={0}
                                y={y}
                                radius={portRadius + 5}
                                stroke="#FFD54F"
                                strokeWidth={2.5}
                                listening={false}
                            />
                        )}
                        <Circle
                            x={0}
                            y={y}
                            radius={isSnapped(input.id) ? portRadius + 1.5 : portRadius}
                            fill={portColor}
                            stroke="white"
                            strokeWidth={2}
                            listening={false}
                        />
                        <Text
                            text={input.name}
                            x={portRadius + 5}
                            y={y - 6}
                            fontSize={10}
                            fill={textColor}
                        />
                    </Group>
                );
            })}

            {/* Output ports */}
            {metadata.outputs.map((output, index) => {
                const y = PORT_Y_OFFSET + index * portSpacing;
                return (
                    <Group key={output.id}>
                        <Circle
                            x={width}
                            y={y}
                            radius={PORT_HIT_RADIUS}
                            fill="transparent"
                            onMouseDown={(e) => {
                                e.cancelBubble = true;
                                onPortClick(block.id, output.id, true);
                            }}
                            onTouchStart={(e) => {
                                e.cancelBubble = true;
                                onPortClick(block.id, output.id, true);
                            }}
                        />
                        {isSnapped(output.id) && (
                            <Circle
                                x={width}
                                y={y}
                                radius={portRadius + 5}
                                stroke="#FFD54F"
                                strokeWidth={2.5}
                                listening={false}
                            />
                        )}
                        <Circle
                            x={width}
                            y={y}
                            radius={isSnapped(output.id) ? portRadius + 1.5 : portRadius}
                            fill="#2196F3"
                            stroke="white"
                            strokeWidth={2}
                            listening={false}
                        />
                        {/* Right-align via Konva rather than positioning by a
                            guessed text width. The old x was
                            `width - portRadius - 3 - name.length * 6`, which
                            assumes every glyph is 6px wide; in a proportional
                            font that error grows with the label, so "Triangle
                            Out" sat noticeably left of "Ramp Out" instead of
                            sharing a right edge. */}
                        <Text
                            text={output.name}
                            x={0}
                            y={y - 6}
                            width={width - portRadius - 3}
                            align="right"
                            fontSize={10}
                            fill={textColor}
                            listening={false}
                        />
                    </Group>
                );
            })}
        </Group>
    );
};
