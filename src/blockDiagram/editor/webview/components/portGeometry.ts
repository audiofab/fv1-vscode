/**
 * Port geometry, shared by BlockComponent (which draws the ports) and
 * BlockDiagramEditor (which snaps to them).
 *
 * These must agree exactly — if the editor computes a port at a different
 * place than the renderer draws it, wires snap to empty space.
 */

import type { Block, BlockMetadata } from '@audiofab-io/fv1-core/blockDiagram';

/** Drawn radius of a port dot. */
export const PORT_RADIUS = 6;
/** Vertical pitch between ports on the same side of a block. */
export const PORT_SPACING = 20;
/** Y of the first port, relative to the block's top edge. */
export const PORT_Y_OFFSET = 40;

/**
 * Invisible click target around each port. Larger than the dot so a port can
 * be grabbed without pixel-hunting; the visible dot stays small.
 *
 * Capped at half PORT_SPACING: Konva resolves overlapping shapes by picking the
 * topmost, so hit circles wider than the port pitch would let a lower port steal
 * clicks aimed at the one above it.
 */
export const PORT_HIT_RADIUS = PORT_SPACING / 2;

/**
 * How close (in canvas units) the cursor must come to a compatible port for a
 * dragged wire to snap onto it. Generous on purpose — it only ever snaps to
 * ports that would make a *legal* connection, so a wrong snap is not possible.
 */
export const PORT_SNAP_RADIUS = 30;
// Note: unlike the hit radius, this may exceed the port pitch safely — snapping
// is a nearest-match search, so overlap resolves by distance, not draw order.

export interface PortHandle {
    blockId: string;
    portId: string;
    isOutput: boolean;
    /** 'audio' | 'control' — used to reject incompatible snaps. */
    portType: string;
    x: number;
    y: number;
}

export function blockWidth(metadata: BlockMetadata | undefined): number {
    return metadata?.width || 200;
}

/** Canvas-space position of one port, or null if the block/port is unknown. */
export function getPortPosition(
    block: Block,
    metadata: BlockMetadata | undefined,
    portId: string,
    isOutput: boolean,
): { x: number; y: number } | null {
    if (!metadata) return null;
    const list = isOutput ? metadata.outputs : metadata.inputs;
    const index = list.findIndex(p => p.id === portId);
    if (index < 0) return null;
    return {
        x: block.position.x + (isOutput ? blockWidth(metadata) : 0),
        y: block.position.y + PORT_Y_OFFSET + index * PORT_SPACING,
    };
}

/** Every port on every block, flattened, in canvas space. */
export function collectPorts(
    blocks: Block[],
    blockMetadata: BlockMetadata[],
): PortHandle[] {
    const out: PortHandle[] = [];
    for (const block of blocks) {
        const metadata = blockMetadata.find(m => m.type === block.type);
        if (!metadata) continue;
        const w = blockWidth(metadata);
        metadata.inputs.forEach((p, i) => {
            out.push({
                blockId: block.id, portId: p.id, isOutput: false, portType: p.type,
                x: block.position.x,
                y: block.position.y + PORT_Y_OFFSET + i * PORT_SPACING,
            });
        });
        metadata.outputs.forEach((p, i) => {
            out.push({
                blockId: block.id, portId: p.id, isOutput: true, portType: p.type,
                x: block.position.x + w,
                y: block.position.y + PORT_Y_OFFSET + i * PORT_SPACING,
            });
        });
    }
    return out;
}

/**
 * Nearest port to (x, y) that passes `isEligible`, within PORT_SNAP_RADIUS.
 * Returns null when nothing qualifies, which leaves the wire following the
 * cursor as before.
 */
export function findSnapPort(
    ports: PortHandle[],
    x: number,
    y: number,
    isEligible: (p: PortHandle) => boolean,
    radius: number = PORT_SNAP_RADIUS,
): PortHandle | null {
    let best: PortHandle | null = null;
    let bestDist = radius * radius;
    for (const p of ports) {
        if (!isEligible(p)) continue;
        const dx = p.x - x, dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestDist) { bestDist = d2; best = p; }
    }
    return best;
}
