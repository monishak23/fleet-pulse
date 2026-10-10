
import { Injectable, signal } from '@angular/core';
import { MetricEvent, ServiceStatus } from './model';

export interface PingEvent {
  type: 'ping';
  ts: number;
}

export type ParsedStreamEvent = MetricEvent | PingEvent;

const VALID_STATUSES: readonly ServiceStatus[] = [
  'healthy',
  'degraded',
  'down',
];

@Injectable({ providedIn: 'root' })
export class StreamEventParser {
  private readonly _malformedCount = signal(0);
  readonly malformedCount = this._malformedCount.asReadonly();

  /** Parse JSON text from WebSocket/SSE or decoded objects from polling. */
  parse(payload: unknown): ParsedStreamEvent | null {
    let value: unknown = payload;

    if (typeof value === 'string') {
      try {
        value = JSON.parse(value) as unknown;
      } catch {
        return this.invalid();
      }
    }

    if (!this.isRecord(value)) {
      return this.invalid();
    }

    if (value['type'] === 'ping') {
      if (this.isFiniteNumber(value['ts'])) {
        return { type: 'ping', ts: value['ts'] };
      }

      return this.invalid();
    }

    if (!this.isMetric(value)) {
      return this.invalid();
    }

    return value;
  }

  private isMetric(
    value: Record<string, unknown>,
  ): value is Record<string, unknown> & MetricEvent {
    return (
      value['type'] === 'metric' &&
      Number.isSafeInteger(value['offset']) &&
      (value['offset'] as number) >= 0 &&
      typeof value['serviceId'] === 'string' &&
      value['serviceId'].length > 0 &&
      Number.isSafeInteger(value['seq']) &&
      (value['seq'] as number) >= 0 &&
      this.isFiniteNumber(value['ts']) &&
      this.isFiniteNumber(value['p95']) &&
      (value['p95'] as number) >= 0 &&
      this.isFiniteNumber(value['errRate']) &&
      (value['errRate'] as number) >= 0 &&
      (value['errRate'] as number) <= 100 &&
      this.isFiniteNumber(value['rps']) &&
      (value['rps'] as number) >= 0 &&
      VALID_STATUSES.includes(value['status'] as ServiceStatus)
    );
  }

  private isRecord(
    value: unknown,
  ): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private invalid(): null {
    this._malformedCount.update((count) => count + 1);
    return null;
  }
}
