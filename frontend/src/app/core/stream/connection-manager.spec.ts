
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, Subscriber } from 'rxjs';
import { vi } from 'vitest';

import { AuthService } from '../auth/service';
import {
  APP_SETTINGS,
  DEFAULT_APP_SETTINGS,
} from '../config/app-settings';
import {
  backoffDelayMs,
  ConnectionManager,
  STREAM_TRANSPORTS,
} from './connection-manager';
import {
  StreamTransport,
  TransportError,
  TransportEvent,
  TransportKind,
} from './model';

const stream = DEFAULT_APP_SETTINGS.stream;

const max = () => 1;
const min = () => 0;

/* Backoff tests */

describe('backoffDelayMs', () => {
  it('doubles with every failure', () => {
    expect([1, 2, 3, 4].map((n) => backoffDelayMs(n, stream, max)))
      .toEqual([1000, 2000, 4000, 8000]);
  });

  it('never exceeds the cap', () => {
    expect(backoffDelayMs(6, stream, max)).toBe(30_000);
    expect(backoffDelayMs(50, stream, max)).toBe(30_000);
  });

  it('spreads clients between half the ceiling and the full ceiling', () => {
    expect(backoffDelayMs(3, stream, min)).toBe(2000);
    expect(backoffDelayMs(3, stream, max)).toBe(4000);
    expect(backoffDelayMs(3, stream, () => 0.5)).toBe(3000);
  });

  it('treats zero or a negative count as the first failure', () => {
    expect(backoffDelayMs(0, stream, max)).toBe(1000);
    expect(backoffDelayMs(-3, stream, max)).toBe(1000);
  });
});

/* A controllable transport for tests */

class FakeTransport implements StreamTransport {
  connects = 0;
  tokens: string[] = [];
  live: Subscriber<TransportEvent> | null = null;

  constructor(readonly kind: TransportKind) {}

  connect(token: string): Observable<TransportEvent> {
    return new Observable<TransportEvent>((subscriber) => {
      this.connects++;
      this.tokens.push(token);
      this.live = subscriber;

      return () => {
        this.live = null;
      };
    });
  }

  open() {
    this.live?.next({ type: 'open' });
  }

  message(data: unknown) {
    this.live?.next({ type: 'message', data });
  }

  fail(code?: number) {
    this.live?.error(new TransportError(this.kind, 'boom', code));
  }
}

/* ConnectionManager tests */

describe('ConnectionManager', () => {
  let ws: FakeTransport;
  let sse: FakeTransport;
  let polling: FakeTransport;
  let manager: ConnectionManager;
  let refresh$: Subject<string>;

  let auth: {
    refresh: ReturnType<typeof vi.fn>;
    ensureFreshToken: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    ws = new FakeTransport('websocket');
    sse = new FakeTransport('sse');
    polling = new FakeTransport('polling');
    refresh$ = new Subject<string>();

    auth = {
      refresh: vi.fn(() => refresh$.asObservable()),
      ensureFreshToken: vi.fn(() => of('tok')),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: APP_SETTINGS, useValue: DEFAULT_APP_SETTINGS },
        { provide: STREAM_TRANSPORTS, useValue: [ws, sse, polling] },
        { provide: AuthService, useValue: auth },
      ],
    });

    manager = TestBed.inject(ConnectionManager);
  });

  afterEach(() => {
    manager.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Fail a transport repeatedly, allowing retries to run. */
  function failTimes(
    transport: FakeTransport,
    n: number,
    waitMs = 2000,
  ) {
    for (let i = 0; i < n; i++) {
      transport.fail();
      vi.advanceTimersByTime(waitMs);
    }
  }

  describe('fallback', () => {
    it('starts on WebSocket and becomes live when it opens', () => {
      manager.start();

      expect(manager.transport()).toBe('websocket');
      expect(manager.phase()).toBe('connecting');
      expect(ws.tokens).toEqual(['tok']);

      ws.open();

      expect(manager.phase()).toBe('live');
    });

    it('retries the same transport after a delay and shows when', () => {
      manager.start();
      ws.fail();

      expect(manager.phase()).toBe('reconnecting');
      expect(manager.retryAt()).toBe(Date.now() + 500);

      vi.advanceTimersByTime(500);

      expect(ws.connects).toBe(2);
      expect(manager.phase()).toBe('connecting');
    });

    it('falls back to SSE after three WebSocket failures', () => {
      manager.start();
      failTimes(ws, 3);

      expect(ws.connects).toBe(3);
      expect(sse.connects).toBe(1);
      expect(manager.transport()).toBe('sse');
    });

    it('falls back to polling after three SSE failures', () => {
      manager.start();
      failTimes(ws, 3);
      failTimes(sse, 3);

      expect(manager.transport()).toBe('polling');
      expect(polling.connects).toBe(1);
    });

    it('keeps retrying polling instead of giving up', () => {
      manager.start();
      failTimes(ws, 3);
      failTimes(sse, 3);
      failTimes(polling, 5, stream.backoffMaxMs);

      expect(manager.transport()).toBe('polling');
      expect(polling.connects).toBe(6);
    });

    it('counts a WebSocket that does not open within five seconds as a failure', () => {
      manager.start();
      vi.advanceTimersByTime(stream.wsConnectTimeoutMs);

      expect(manager.phase()).toBe('reconnecting');
      expect(ws.live).toBeNull();
    });

    it('resets the failure count after a successful open', () => {
      manager.start();
      failTimes(ws, 2);

      ws.open();
      ws.fail();

      vi.advanceTimersByTime(2000);

      expect(sse.connects).toBe(0);
      expect(ws.connects).toBe(4);
    });

    it('passes validated message payloads through the parser', () => {
      const metric = {
        type: 'metric',
        offset: 1,
        serviceId: 'svc-1',
        seq: 1,
        ts: 123,
        p95: 50,
        errRate: 0.5,
        rps: 10,
        status: 'healthy',
      };

      const received: unknown[] = [];
      const subscription = manager.messages$.subscribe((message) => {
        received.push(message);
      });

      // Start first so the fake transport has an active subscriber.
      manager.start();

      expect(ws.connects).toBe(1);

      ws.message(JSON.stringify(metric));
      ws.message(
        JSON.stringify({ ...metric, offset: 2, seq: 2 }),
      );

      expect(received).toEqual([
        metric,
        { ...metric, offset: 2, seq: 2 },
      ]);

      subscription.unsubscribe();
    });

    it('stop closes the connection and cancels reconnects', () => {
      manager.start();
      ws.fail();

      manager.stop();
      vi.advanceTimersByTime(60_000);

      expect(manager.phase()).toBe('idle');
      expect(ws.connects).toBe(1);
      expect(ws.live).toBeNull();
    });
  });

  describe('heartbeat', () => {
    const limit = stream.pingIntervalMs * stream.missedPingsLimit;

    it('treats missed pings on an open connection as dead', () => {
      manager.start();
      ws.open();

      vi.advanceTimersByTime(limit - 1);
      expect(manager.phase()).toBe('live');

      vi.advanceTimersByTime(1);

      expect(manager.phase()).toBe('reconnecting');
      expect(ws.live).toBeNull();
    });

    it('resets the watchdog on every message', () => {
      manager.start();
      ws.open();

      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(limit - 1000);
        ws.message(`ping-${i}`);
      }

      expect(manager.phase()).toBe('live');
    });

    it('does not run a heartbeat on polling', () => {
      manager.start();
      failTimes(ws, 3);
      failTimes(sse, 3);

      polling.open();
      vi.advanceTimersByTime(60_000);

      expect(manager.phase()).toBe('live');
    });
  });

  describe('token handling', () => {
    it('waits for a fresh token before connecting, and uses it', () => {
      const token$ = new Subject<string>();
      auth.ensureFreshToken.mockReturnValue(token$.asObservable());

      manager.start();

      expect(ws.connects).toBe(0);
      expect(manager.phase()).toBe('connecting');

      token$.next('fresh');

      expect(ws.connects).toBe(1);
      expect(ws.tokens).toEqual(['fresh']);
    });

    it('counts a failed token refresh as an ordinary failure', () => {
      const token$ = new Subject<string>();
      auth.ensureFreshToken.mockReturnValue(token$.asObservable());

      manager.start();
      token$.error(new Error('network'));

      expect(manager.phase()).toBe('reconnecting');
      expect(ws.connects).toBe(0);
    });

    it('never connects if stopped while waiting for a token', () => {
      const token$ = new Subject<string>();
      auth.ensureFreshToken.mockReturnValue(token$.asObservable());

      manager.start();
      manager.stop();
      token$.next('late');

      expect(ws.connects).toBe(0);
      expect(manager.phase()).toBe('idle');
    });

    it('refreshes and reconnects when the server rejects the token, without counting a failure', () => {
      manager.start();
      ws.fail(4401);

      expect(auth.refresh).toHaveBeenCalledTimes(1);
      expect(ws.connects).toBe(1);

      refresh$.next('new-token');

      expect(ws.connects).toBe(2);

      failTimes(ws, 2);

      expect(sse.connects).toBe(0);
    });

    it('refreshes only once in a row when the server keeps rejecting the token', () => {
      manager.start();
      ws.fail(4401);

      refresh$.next('new-token');
      ws.fail(4401);

      expect(auth.refresh).toHaveBeenCalledTimes(1);
      expect(manager.phase()).toBe('reconnecting');
    });

    it('treats a failed refresh after a rejected token as an ordinary failure', () => {
      manager.start();
      ws.fail(4401);

      refresh$.error(new Error('network'));

      expect(manager.phase()).toBe('reconnecting');
    });
  });
});
