import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, concatMap, defer, exhaustMap, from, Observable, throwError, timer } from 'rxjs';
import { APP_SETTINGS } from '../config/app-settings';
import { isSessionEnded } from '../http/error';
import { SnapshotResponse, StreamTransport, TransportError, TransportEvent } from './model';

@Injectable({ providedIn: 'root' })
export class PollingTransport implements StreamTransport {
  readonly kind = 'polling' as const;
  private readonly http = inject(HttpClient);
  private readonly settings = inject(APP_SETTINGS);

  // No token argument: the HTTP interceptor adds the current token to each request.
  connect(): Observable<TransportEvent> {
    const url = `${this.settings.api.baseUrl}/metrics/snapshot`;

    return defer(() => {
      let opened = false;
      return timer(0, this.settings.stream.pollingIntervalMs).pipe(
        // exhaustMap ignores a tick while the previous request is still running.
        exhaustMap(() => this.http.get<SnapshotResponse>(url)),
        concatMap((snapshot) => {
          const events: TransportEvent[] = [];
          if (!opened) {
            opened = true;
            events.push({ type: 'open' });
          }
          // Already decoded, so there is no JSON text to parse again.
          for (const metric of snapshot.metrics) {
            events.push({ type: 'message', data: metric });
          }
          return from(events);
        }),
        catchError((err: unknown) => {
          // A session-ended error must reach the app unchanged, not look like a network failure.
          if (isSessionEnded(err)) return throwError(() => err);
          const status = err instanceof HttpErrorResponse ? err.status : undefined;
          return throwError(() => new TransportError('polling', 'Snapshot request failed', status));
        }),
      );
    });
  }
}