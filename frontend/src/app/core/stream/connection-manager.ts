import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { AuthService } from '../auth/service';
import { APP_SETTINGS, AppSettings } from '../config/app-settings';
import { StreamTransport, TransportError, TransportKind } from './model';
import { PollingTransport } from './polling-transport';
import { SseTransport } from './sse-transport';
import { WebSocketTransport } from './websocket-transport';
import { ParsedStreamEvent, StreamEventParser } from './stream-event-parser';

/**
 * Delay before reconnect attempt number `failures` (1 = first retry).
 * Grows exponentially up to backoffMaxMs. Half of the delay is fixed and half is random,
 * so clients that fail together do not retry together, and nobody retries instantly.
 * A successful connection resets the count to 0 (the manager does that).
 */
export function backoffDelayMs(
  failures: number,
  stream: AppSettings['stream'],
  random: () => number = Math.random,
): number {
  const attempt = Math.max(1, Math.floor(failures));
  const ceiling = Math.min(stream.backoffMaxMs, stream.backoffBaseMs * 2 ** (attempt - 1));
  return ceiling / 2 + random() * (ceiling / 2);
}

/** Transports in priority order. A fourth transport is added here and nowhere else. */
export const STREAM_TRANSPORTS = new InjectionToken<StreamTransport[]>('STREAM_TRANSPORTS', {
  providedIn: 'root',
  factory: () => [inject(WebSocketTransport), inject(SseTransport), inject(PollingTransport)],
});

export type ConnectionPhase = 'idle' | 'connecting' | 'live' | 'reconnecting';

/** How many failures in a row a transport may have before we move down. */
function maxFailures(kind: TransportKind, stream: AppSettings['stream']): number {
  switch (kind) {
    case 'websocket':
      return stream.wsMaxFailures;
    case 'sse':
      return stream.sseMaxFailures;
    default:
      return Infinity; // the last resort never gives up: it keeps retrying with backoff
  }
}

/** The server rejected our token: WebSocket close 4401, or HTTP 401 where a status is visible. */
function isAuthFailure(err: unknown): boolean {
  return err instanceof TransportError && (err.code === 4401 || err.code === 401);
}

@Injectable({ providedIn: 'root' })
export class ConnectionManager {
  private readonly appSettings = inject(APP_SETTINGS);
  private readonly settings = this.appSettings.stream;
  private readonly authSettings = this.appSettings.auth;
  private readonly transports = inject(STREAM_TRANSPORTS);
  private readonly auth = inject(AuthService);

  private readonly parser = inject(StreamEventParser);

private readonly out = new Subject<ParsedStreamEvent>();
readonly messages$ = this.out.asObservable();

  private readonly _phase = signal<ConnectionPhase>('idle');
  private readonly _transport = signal<TransportKind | null>(null);
  private readonly _retryAt = signal<number | null>(null);
  readonly phase = this._phase.asReadonly();
  /** The transport we are using or trying right now. */
  readonly transport = this._transport.asReadonly();
  /** When the next reconnect starts (epoch ms), for "Reconnecting in 4 s". */
  readonly retryAt = this._retryAt.asReadonly();

  private running = false;
  private level = 0; // index into transports
  private failures = 0; // failures in a row on the current transport
  private authRetried = false; // one token refresh per outage, so a rejecting server cannot loop us
  private run = 0; // changes on every attempt, so late callbacks can be ignored
  private subscription: Subscription | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.level = 0;
    this.failures = 0;
    this.authRetried = false;
    this.attempt();
  }

  stop(): void {
    this.running = false;
    this.teardown();
    this._phase.set('idle');
    this._transport.set(null);
    this._retryAt.set(null);
  }

  /** (Re)starts the dead-connection watchdog. Any message proves the connection is alive. */
  private armHeartbeat(run: number): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    // Polling asks the server itself every 2 s, so it needs no heartbeat.
    if (this.transports[this.level].kind === 'polling') return;
    const limit = this.settings.pingIntervalMs * this.settings.missedPingsLimit;
    this.heartbeatTimer = setTimeout(() => {
      if (run !== this.run) return;
      this.subscription?.unsubscribe();
      this.onFailure();
    }, limit);
  }

  private teardown(): void {
    this.run++;
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.connectTimer = this.retryTimer = this.heartbeatTimer = null;
  }

  private attempt(): void {
    this.teardown();
    const run = this.run;
    const transport = this.transports[this.level];
    this._transport.set(transport.kind);
    this._phase.set('connecting');
    this._retryAt.set(null);

    // One container for everything this attempt starts, so teardown() cancels it all
    const job = new Subscription();
    this.subscription = job;
    job.add(
      // WebSocket and SSE carry the token in the URL and are checked only when they open,
      // so make sure it has not expired (or is about to) before connecting.
      this.auth.ensureFreshToken(this.authSettings.tokenExpiryMarginMs).subscribe({
        next: (token) => {
          if (run === this.run) this.open(transport, token, run, job);
        },
        error: () => {
          if (run === this.run) this.onFailure(); // a failed token refresh is an ordinary failure
        },
      }),
    );
  }

  private open(transport: StreamTransport, token: string, run: number, job: Subscription): void {
    // Polling has its own 10 s HTTP timeout. The others must open within the limit.
    if (transport.kind !== 'polling') {
      this.connectTimer = setTimeout(() => {
        if (run !== this.run) return;
        this.subscription?.unsubscribe();
        this.onFailure();
      }, this.settings.wsConnectTimeoutMs);
    }

    // If the transport fails synchronously, `job` is already closed and add() cancels it at once
    job.add(
      transport.connect(token).subscribe({
        next: (event) => {
          if (run !== this.run) return;
          if (event.type === 'open') {
            if (this.connectTimer) clearTimeout(this.connectTimer);
            this.connectTimer = null;
            this.failures = 0; // a success resets the count
            this.authRetried = false;
            this._phase.set('live');
          } else {
            const parsed = this.parser.parse(event.data);

            if (parsed) {
                this.out.next(parsed);
            }
          }
          this.armHeartbeat(run); // open, metric or ping: the connection is alive
        },
        error: (err: unknown) => {
          if (run === this.run) this.onFailure(err);
        },
      }),
    );
  }

  private onFailure(err?: unknown): void {
    // Backstop: the token looked valid but the server still rejected it (for example after a
    // server restart). Refresh once and reconnect, without counting it as a transport failure.
    if (isAuthFailure(err) && !this.authRetried) {
      this.authRetried = true;
      this.refreshThenReconnect();
      return;
    }

    this.failures++;
    const transport = this.transports[this.level];
    const hasLower = this.level < this.transports.length - 1;

    if (hasLower && this.failures >= maxFailures(transport.kind, this.settings)) {
      this.level++;
      this.failures = 0;
      this.attempt(); // move down at once, the delay is for retries on the same transport
      return;
    }

    this.teardown();
    const delay = backoffDelayMs(this.failures, this.settings);
    this._phase.set('reconnecting');
    this._retryAt.set(Date.now() + delay);
    this.retryTimer = setTimeout(() => this.attempt(), delay);
  }

  private refreshThenReconnect(): void {
    this.teardown();
    const run = this.run;
    this._phase.set('connecting');
    this._retryAt.set(null);

    const job = new Subscription();
    this.subscription = job;
    job.add(
      this.auth.refresh().subscribe({
        next: () => {
          if (run === this.run && this.running) this.attempt();
        },
        error: () => {
          // A rejected refresh ends the session elsewhere. A network error is an ordinary failure.
          if (run === this.run && this.running) this.onFailure();
        },
      }),
    );
  }
}