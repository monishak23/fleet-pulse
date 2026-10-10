import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_SETTINGS } from '../config/app-settings';
import { StreamTransport, TransportError, TransportEvent } from './model';

/** The event names the server sends (see the API contract). */
const EVENT_NAMES = ['metric', 'ping'] as const;

@Injectable({ providedIn: 'root' })
export class SseTransport implements StreamTransport {
  readonly kind = 'sse' as const;
  private readonly sseUrl = inject(APP_SETTINGS).api.sseUrl;

  connect(accessToken: string): Observable<TransportEvent> {
    return new Observable<TransportEvent>((subscriber) => {
      // EventSource cannot set headers either, so the token goes in the query string.
      const url = new URL(this.sseUrl);
      url.searchParams.set('access_token', accessToken);
      const source = new EventSource(url.toString());

      const onMessage = (e: Event) =>
        subscriber.next({ type: 'message', data: (e as MessageEvent).data });

      source.onopen = () => subscriber.next({ type: 'open' });
      for (const name of EVENT_NAMES) {
        source.addEventListener(name, onMessage);
      }
      // No status code is available. Close first, or the browser retries on its own.
      source.onerror = () => {
        source.close();
        subscriber.error(new TransportError('sse', 'SSE connection failed or closed'));
      };

      // Teardown: runs on unsubscribe, and reports nothing.
      return () => {
        source.onopen = null;
        source.onerror = null;
        for (const name of EVENT_NAMES) {
          source.removeEventListener(name, onMessage);
        }
        source.close();
      };
    });
  }
}