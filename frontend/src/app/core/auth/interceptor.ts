import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import {
  catchError,
  defer,
  of,
  retry,
  switchMap,
  throwError,
  timeout,
  timer,
  TimeoutError,
} from 'rxjs';
import { APP_SETTINGS, AppSettings } from '../config/app-settings';
import { isTokenExpired } from '../http/error';
import { AuthService } from './service';

const NETWORK_ERROR = 0;

export function isRetryableRequest(req: HttpRequest<unknown>): boolean {
  if (req.method === 'GET') return true;
  return req.method === 'POST' && req.headers.has('Idempotency-Key');
}

export function isRetryableError(err: unknown, statuses: readonly number[]): boolean {
  return (
    err instanceof HttpErrorResponse &&
    (err.status === NETWORK_ERROR || statuses.includes(err.status))
  );
}

export function retryDelayMs(
  err: HttpErrorResponse,
  retryNumber: number,
  http: AppSettings['http'],
): number {
  if (err.status === 429) {
    const seconds = Number(err.headers.get('Retry-After'));
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  const backoff = http.retryBaseDelayMs * 2 ** (retryNumber - 1);
  return backoff / 2 + Math.random() * (backoff / 2); 
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const { api, http } = inject(APP_SETTINGS);
  const auth = inject(AuthService);

  if (!req.url.startsWith(api.baseUrl)) {
    return next(req);
  }
  const isAuthEndpoint = req.url.startsWith(`${api.baseUrl}/auth/`);

  const withToken = (token: string) =>
    req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  const attempt$ = defer(() => {
    const sentToken = auth.accessToken;
    if (!sentToken || isAuthEndpoint) {
      return next(req);
    }
    return next(withToken(sentToken)).pipe(
      catchError((err: unknown) => {
        if (!isTokenExpired(err)) {
          return throwError(() => err);
        }
        const latest = auth.accessToken;
        const token$ = latest && latest !== sentToken ? of(latest) : auth.refresh();
        return token$.pipe(switchMap((token) => next(withToken(token))));
      }),
    );
  });

  return attempt$.pipe(
    timeout(http.timeoutMs),
    catchError((err: unknown) =>
      err instanceof TimeoutError
        ? throwError(
            () =>
              new HttpErrorResponse({ status: NETWORK_ERROR, statusText: 'Timeout', url: req.url }),
          )
        : throwError(() => err),
    ),
    retry({
      count: http.maxAttempts - 1, // maxAttempts counts the first try
      delay: (err, retryNumber) =>
        isRetryableRequest(req) && isRetryableError(err, http.retryableStatuses)
          ? timer(retryDelayMs(err as HttpErrorResponse, retryNumber, http))
          : throwError(() => err),
    }),
  );
};