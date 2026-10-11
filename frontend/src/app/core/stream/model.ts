import { Observable } from 'rxjs';

export type TransportKind = 'websocket' | 'sse' | 'polling';

export type ServiceStatus = 'healthy' | 'degraded' | 'down';


export interface MetricEvent {
    type: 'metric';
    offset: number; 
    serviceId: string;
    seq: number; 
    ts: number;
    p95: number; 
    errRate: number; 
    rps: number;
    status: ServiceStatus;
}

export type TransportEvent =
    | { type: 'open' }
    | { type: 'message'; data: unknown };

export class TransportError extends Error {
    constructor(
        readonly transport: TransportKind,
        message: string,
        readonly code?: number,
    ) {
        super(message);
        this.name = 'TransportError';
    }
}

export interface StreamTransport {
    readonly kind: TransportKind;
    connect(accessToken: string): Observable<TransportEvent>;
}

export interface SnapshotResponse {
    offset: number; 
    ts: number;
    metrics: MetricEvent[]; 
}