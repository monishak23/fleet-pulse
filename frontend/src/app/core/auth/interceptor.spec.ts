import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpRequest,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, NEVER, Observable } from 'rxjs';
import { vi } from 'vitest';
import { APP_SETTINGS, DEFAULT_APP_SETTINGS } from '../config/app-settings';
import { isSessionEnded } from '../http/error';
import { authInterceptor, isRetryableError, isRetryableRequest } from './interceptor';
import { AuthResponse } from './model';
import { AuthService } from './service';

const base = DEFAULT_APP_SETTINGS.api.baseUrl;
const user = { id: 'u-1', email: 'operator@pulse.dev', role: 'operator' as const };
const tokens = (access: string, refresh: string): AuthResponse => ({
  accessToken: access,
  refreshToken: refresh,
  expiresIn: 60,
  user,
});
const expired = { error: { code: 'token_expired', message: 'Access token expired', details: [] } };
const refreshInvalid = { error: { code: 'refresh_invalid', message: 'Refresh token invalid', details: [] } };
const tokenInvalid = { error: { code: 'token_invalid', message: 'Invalid', details: [] } };
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);

    TestBed.inject(AuthService).login('operator@pulse.dev', 'pulse123').subscribe();
    httpMock.expectOne(`${base}/auth/login`).flush(tokens('old-access', 'old-refresh'));
  });

  afterEach(() => httpMock.verify());

  const pending = () => httpMock.match((r) => r.url === `${base}/services`);

  it('sends exactly one refresh when 10 parallel requests fail with token_expired', () => {
    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      http.get<number>(`${base}/services`).subscribe((v) => results.push(v));
    }

    const firstAttempts = pending();
    expect(firstAttempts.length).toBe(10);
    firstAttempts.forEach((r) => r.flush(expired, unauthorized));

    const refreshes = httpMock.match(`${base}/auth/refresh`);
    expect(refreshes.length).toBe(1);
    expect(refreshes[0].request.body).toEqual({ refreshToken: 'old-refresh' });
    refreshes[0].flush(tokens('new-access', 'new-refresh'));

    const replays = pending();
    expect(replays.length).toBe(10);
    replays.forEach((r, i) => {
      expect(r.request.headers.get('Authorization')).toBe('Bearer new-access');
      r.flush(i);
    });
    expect(results.length).toBe(10);
  });

  it('replays a late-failing request with the new token without a second refresh', () => {
    http.get(`${base}/services`).subscribe();
    http.get(`${base}/services`).subscribe();
    const [a, b] = pending();

    a.flush(expired, unauthorized);
    httpMock.expectOne(`${base}/auth/refresh`).flush(tokens('new-access', 'new-refresh'));

    b.flush(expired, unauthorized); // arrives after the refresh finished
    expect(httpMock.match(`${base}/auth/refresh`).length).toBe(0);

    const replays = pending();
    expect(replays.length).toBe(2);
    replays.forEach((r) => {
      expect(r.request.headers.get('Authorization')).toBe('Bearer new-access');
      r.flush(1);
    });
  });

  it('stops every waiting request when the refresh is rejected', () => {
    const errors: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      http.get(`${base}/services`).subscribe({ error: (e: unknown) => errors.push(e) });
    }
    pending().forEach((r) => r.flush(expired, unauthorized));

    httpMock.expectOne(`${base}/auth/refresh`).flush(refreshInvalid, unauthorized);
    expect(errors.length).toBe(3);
    expect(errors.every((e) => isSessionEnded(e))).toBe(true);
  });

  it('ends the session on token_invalid, without a refresh', () => {
    const auth = TestBed.inject(AuthService);
    let error: unknown;
    http.get(`${base}/services`).subscribe({ error: (e: unknown) => (error = e) });

    pending()[0].flush(tokenInvalid, unauthorized);

    expect(httpMock.match(`${base}/auth/refresh`).length).toBe(0);
    expect(auth.isAuthenticated()).toBe(false);
    expect(isSessionEnded(error)).toBe(true);
  });

  it('stops in-flight requests when the session ends', () => {
    const auth = TestBed.inject(AuthService);
    let error: unknown;
    http.get(`${base}/services`).subscribe({ error: (e: unknown) => (error = e) });
    const [request] = pending();

    auth.endSession();

    expect(isSessionEnded(error)).toBe(true);
    expect(request.cancelled).toBe(true);
  });
});

const httpSettings = DEFAULT_APP_SETTINGS.http;
const servicesUrl = `${base}/services`;

describe('retry rules (pure functions)', () => {
  it('retries GET, and POST only with an idempotency key', () => {
    const key = { headers: new HttpHeaders({ 'Idempotency-Key': 'k1' }) };
    expect(isRetryableRequest(new HttpRequest('GET', servicesUrl))).toBe(true);
    expect(isRetryableRequest(new HttpRequest('POST', servicesUrl, {}))).toBe(false);
    expect(isRetryableRequest(new HttpRequest('POST', servicesUrl, {}, key))).toBe(true);
  });

  it('never retries PUT or DELETE', () => {
    expect(isRetryableRequest(new HttpRequest('PUT', servicesUrl, {}))).toBe(false);
    expect(isRetryableRequest(new HttpRequest('DELETE', servicesUrl))).toBe(false);
  });

  it('retries network errors, 429, 502, 503, 504', () => {
    for (const status of [0, 429, 502, 503, 504]) {
      expect(isRetryableError(new HttpErrorResponse({ status }), httpSettings.retryableStatuses)).toBe(true);
    }
  });

  it('does not retry other 4xx, 500, or non-HTTP errors', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      expect(isRetryableError(new HttpErrorResponse({ status }), httpSettings.retryableStatuses)).toBe(false);
    }
    expect(isRetryableError(new Error('session ended'), httpSettings.retryableStatuses)).toBe(false);
  });
});

describe('authInterceptor retry behaviour', () => {
  let client: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // jitter becomes the lowest delay
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: APP_SETTINGS, useValue: DEFAULT_APP_SETTINGS },
        {
          provide: AuthService,
          // sessionEnded$ never emits here: these tests are not about logout.
          useValue: { accessToken: 'tok', refresh: () => EMPTY, sessionEnded$: NEVER },
        },
      ],
    });
    client = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Subscribes and records the outcome. */
  function run(request$: Observable<unknown>) {
    const result: { value?: unknown; error?: HttpErrorResponse } = {};
    request$.subscribe({
      next: (v) => (result.value = v),
      error: (e: HttpErrorResponse) => (result.error = e),
    });
    return result;
  }

  const fail = (status: number, headers: Record<string, string> = {}) =>
    httpMock.expectOne(servicesUrl).flush({}, { status, statusText: 'fail', headers });

  it('retries a GET on 503 and succeeds on the second try', () => {
    const result = run(client.get(servicesUrl));
    fail(503);
    vi.advanceTimersByTime(1000);
    httpMock.expectOne(servicesUrl).flush({ ok: true });
    expect(result.value).toEqual({ ok: true });
  });

  it('gives up after 3 attempts in total', () => {
    const result = run(client.get(servicesUrl));
    fail(503);
    vi.advanceTimersByTime(1000);
    fail(503);
    vi.advanceTimersByTime(2000);
    fail(503);
    expect(result.error?.status).toBe(503);
    httpMock.expectNone(servicesUrl); // no 4th attempt
  });

  it('does not retry a 404', () => {
    const result = run(client.get(servicesUrl));
    fail(404);
    vi.advanceTimersByTime(10000);
    expect(result.error?.status).toBe(404);
    httpMock.expectNone(servicesUrl);
  });

  it('does not retry a POST without an idempotency key', () => {
    const result = run(client.post(servicesUrl, {}));
    fail(503);
    vi.advanceTimersByTime(10000);
    expect(result.error?.status).toBe(503);
    httpMock.expectNone(servicesUrl);
  });

  it('retries a POST that carries an idempotency key', () => {
    const headers = new HttpHeaders({ 'Idempotency-Key': 'k1' });
    const result = run(client.post(servicesUrl, {}, { headers }));
    fail(503);
    vi.advanceTimersByTime(1000);
    httpMock.expectOne(servicesUrl).flush({ id: 'r-1' });
    expect(result.value).toEqual({ id: 'r-1' });
  });

  it('waits for Retry-After on a 429', () => {
    run(client.get(servicesUrl));
    fail(429, { 'Retry-After': '2' });
    vi.advanceTimersByTime(1999);
    httpMock.expectNone(servicesUrl); // still waiting
    vi.advanceTimersByTime(1);
    httpMock.expectOne(servicesUrl).flush({});
  });
});