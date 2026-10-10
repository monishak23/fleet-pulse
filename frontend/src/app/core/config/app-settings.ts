import { InjectionToken } from '@angular/core';

export interface AppSettings {
  api: {
    baseUrl: string;
    wsUrl: string;
    sseUrl: string;
  };
  http: {
    timeoutMs: number; // brief: every request has a 10 s timeout
    maxAttempts: number; // brief: at most 3 attempts
    retryableStatuses: readonly number[]; // brief: 502, 503, 504, 429 (plus network errors)
  };
  stream: {
    wsConnectTimeoutMs: number; // brief: WS must connect within 5 s
    wsMaxFailures: number; // brief: 3 failures in a row, then SSE
    sseMaxFailures: number; // brief: 3 failures, then polling
    climbBackIntervalMs: number; // brief: retry the higher transport every 30 s
    pollingIntervalMs: number; // brief: poll /metrics/snapshot every 2 s
    pingIntervalMs: number; // brief: server pings every 5 s
    missedPingsLimit: number; // brief: two missed pings mean dead
    backoffBaseMs: number; // my choice, not in the brief
    backoffMaxMs: number; // brief: delays capped at 30 s
    reorderWindowMs: number; // brief: events up to 1 s late are still ordered
  };
  freshness: {
    staleAfterMs: number; // brief: data older than 10 s is marked stale
  };
  charts: {
    maxPointsPerSeries: number; // brief: at most 300 points per series
    historyMinutes: number; // brief: 15 minutes of history
  };
  ui: {
    batchIntervalMs: number; // my choice: how often buffered events are applied to the UI
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  api: {
    baseUrl: 'http://localhost:4000',
    wsUrl: 'ws://localhost:4000/stream',
    sseUrl: 'http://localhost:4000/stream/sse',
  },
  http: {
    timeoutMs: 10_000,
    maxAttempts: 3,
    retryableStatuses: [429, 502, 503, 504],
  },
  stream: {
    wsConnectTimeoutMs: 5_000,
    wsMaxFailures: 3,
    sseMaxFailures: 3,
    climbBackIntervalMs: 30_000,
    pollingIntervalMs: 2_000,
    pingIntervalMs: 5_000,
    missedPingsLimit: 2,
    backoffBaseMs: 1_000,
    backoffMaxMs: 30_000,
    reorderWindowMs: 1_000,
  },
  freshness: {
    staleAfterMs: 10_000,
  },
  charts: {
    maxPointsPerSeries: 300,
    historyMinutes: 15,
  },
  ui: {
    batchIntervalMs: 250,
  },
};

export const APP_SETTINGS = new InjectionToken<AppSettings>('APP_SETTINGS', {
  providedIn: 'root',
  factory: () => DEFAULT_APP_SETTINGS,
});
