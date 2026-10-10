import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { APP_SETTINGS, DEFAULT_APP_SETTINGS } from '../config/app-settings';
import { TransportError, TransportEvent } from './model';
import { WebSocketTransport } from './websocket-transport';

class FakeWebSocket {
  static last: FakeWebSocket;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeWebSocket.last = this;
  }
  close() {
    this.closed = true;
  }
}

describe('WebSocketTransport', () => {
  let transport: WebSocketTransport;

  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    TestBed.configureTestingModule({
      providers: [{ provide: APP_SETTINGS, useValue: DEFAULT_APP_SETTINGS }],
    });
    transport = TestBed.inject(WebSocketTransport);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('puts the token in the query string', () => {
    transport.connect('tok').subscribe();
    expect(FakeWebSocket.last.url).toContain('access_token=tok');
  });

  it('emits open, then raw messages untouched', () => {
    const events: TransportEvent[] = [];
    transport.connect('tok').subscribe((e) => events.push(e));
    const socket = FakeWebSocket.last;

    socket.onopen?.();
    socket.onmessage?.({ data: '{not json' });

    expect(events).toEqual([{ type: 'open' }, { type: 'message', data: '{not json' }]);
  });

  it('errors with the close code when the socket closes', () => {
    let error: unknown;
    transport.connect('tok').subscribe({ error: (e: unknown) => (error = e) });

    FakeWebSocket.last.onclose?.({ code: 4401, reason: 'token_expired' });

    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).code).toBe(4401);
    expect((error as TransportError).transport).toBe('websocket');
  });

  it('closes the socket on unsubscribe, without reporting an error', () => {
    let error: unknown;
    const sub = transport.connect('tok').subscribe({ error: (e: unknown) => (error = e) });
    const socket = FakeWebSocket.last;

    sub.unsubscribe();

    expect(socket.closed).toBe(true);
    expect(socket.onclose).toBeNull();
    expect(error).toBeUndefined();
  });
});