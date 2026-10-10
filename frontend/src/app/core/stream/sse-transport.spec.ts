import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { APP_SETTINGS, DEFAULT_APP_SETTINGS } from '../config/app-settings';
import { TransportError, TransportEvent } from './model';
import { SseTransport } from './sse-transport';

class FakeEventSource {
  static last: FakeEventSource;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, (e: Event) => void>();
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(name: string, fn: (e: Event) => void) {
    this.listeners.set(name, fn);
  }
  removeEventListener(name: string) {
    this.listeners.delete(name);
  }
  close() {
    this.closed = true;
  }
  /** Test helper: deliver a named event, as the browser would. */
  emit(name: string, data: string) {
    this.listeners.get(name)?.({ data } as MessageEvent);
  }
  hasListener(name: string) {
    return this.listeners.has(name);
  }
}

describe('SseTransport', () => {
  let transport: SseTransport;

  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    TestBed.configureTestingModule({
      providers: [{ provide: APP_SETTINGS, useValue: DEFAULT_APP_SETTINGS }],
    });
    transport = TestBed.inject(SseTransport);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('puts the token in the query string', () => {
    transport.connect('tok').subscribe();
    expect(FakeEventSource.last.url).toContain('access_token=tok');
  });

  it('emits open, then raw metric and ping data untouched', () => {
    const events: TransportEvent[] = [];
    transport.connect('tok').subscribe((e) => events.push(e));
    const source = FakeEventSource.last;

    source.onopen?.();
    source.emit('metric', '{not json');
    source.emit('ping', '{"type":"ping","ts":1}');

    expect(events).toEqual([
      { type: 'open' },
      { type: 'message', data: '{not json' },
      { type: 'message', data: '{"type":"ping","ts":1}' },
    ]);
  });

  it('closes the source and errors when the connection fails', () => {
    let error: unknown;
    transport.connect('tok').subscribe({ error: (e: unknown) => (error = e) });
    const source = FakeEventSource.last;

    source.onerror?.();

    expect(source.closed).toBe(true);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).transport).toBe('sse');
  });

  it('closes the source on unsubscribe, without reporting an error', () => {
    let error: unknown;
    const sub = transport.connect('tok').subscribe({ error: (e: unknown) => (error = e) });
    const source = FakeEventSource.last;

    sub.unsubscribe();

    expect(source.closed).toBe(true);
    expect(source.hasListener('metric')).toBe(false);
    expect(error).toBeUndefined();
  });
});