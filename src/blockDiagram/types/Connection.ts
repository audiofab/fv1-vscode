/**
 * Connection type definitions
 */

export interface ConnectionEndpoint {
    blockId: string;
    portId: string;
}

export interface Connection {
    id: string;
    from: ConnectionEndpoint;
    to: ConnectionEndpoint;
}

export interface ConnectionValidationResult {
    valid: boolean;
    error?: string;
}
