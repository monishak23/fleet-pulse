import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { APP_SETTINGS, DEFAULT_APP_SETTINGS } from '../config/app-settings';
import { MetricEvent, SnapshotResponse, TransportError, TransportEvent } from './model';
import { PollingTransport } from './polling-transport';

const url = `${DEFAULT_APP_SETTINGS.api.baseUrl}/metrics/snapshot`;
const interval = DEFAULT_APP_SETTINGS.stream.pollingIntervalMs;

const metric = (serviceId: string, offset: number): MetricEvent => ({
  type: 'metric',
  offset,
  serviceId,
  seq: 1,
  ts: 1,
  p95: 100,
  errRate: 0.5,
  rps: 900,
  status: 'healthy',
});
const snapshot = (): SnapshotResponse => ({
  offset: 2,
  ts: 1,
  metrics: [metric('svc-0001', 1), metric('svc-0002', 2)],
});

describe('PollingTransport', () => {
  let transport: PollingTransport;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_SETTINGS, useValue: DEFAULT_APP_SETTINGS },
      ],
    });
    transport = TestBed.inject(PollingTransport);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('emits open once, then every metric of the snapshot as a decoded message', () => {
    const events: TransportEvent[] = [];
    transport.connect().subscribe((e) => events.push(e));

    vi.advanceTimersByTime(1);
    httpMock.expectOne(url).flush(snapshot());

    expect(events.map((e) => e.type)).toEqual(['open', 'message', 'message']);
    expect(events[1]).toEqual({ type: 'message', data: metric('svc-0001', 1) });
  });

  it('polls again after the interval, without a second open', () => {
    const events: TransportEvent[] = [];
    transport.connect().subscribe((e) => events.push(e));

    vi.advanceTimersByTime(1);
    httpMock.expectOne(url).flush(snapshot());
    vi.advanceTimersByTime(interval);
    httpMock.expectOne(url).flush(snapshot());

    expect(events.filter((e) => e.type === 'open').length).toBe(1);
    expect(events.length).toBe(1 + 2 + 2);
  });

  it('does not start a new request while the previous one is still running', () => {
    transport.connect().subscribe();

    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(interval * 3); // three ticks pass, the request never answers

    const open = httpMock.match(url);
    expect(open.length).toBe(1);
    open[0].flush(snapshot()); // finish it so verify() is clean
  });

  it('errors with a TransportError that keeps the HTTP status', () => {
    let error: unknown;
    transport.connect().subscribe({ error: (e: unknown) => (error = e) });

    vi.advanceTimersByTime(1);
    httpMock.expectOne(url).flush({}, { status: 503, statusText: 'unavailable' });

    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).transport).toBe('polling');
    expect((error as TransportError).code).toBe(503);
  });

  it('cancels the request in flight on unsubscribe', () => {
    const sub = transport.connect().subscribe();
    vi.advanceTimersByTime(1);
    const request = httpMock.expectOne(url);

    sub.unsubscribe();

    expect(request.cancelled).toBe(true);
  });
});