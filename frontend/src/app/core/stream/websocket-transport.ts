import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { APP_SETTINGS } from '../config/app-settings';
import { StreamTransport, TransportError, TransportEvent } from './model';

@Injectable({ providedIn: 'root' })
export class WebSocketTransport implements StreamTransport {
  readonly kind = 'websocket' as const;
  private readonly wsUrl = inject(APP_SETTINGS).api.wsUrl;

  connect(accessToken: string): Observable<TransportEvent> {
    return new Observable<TransportEvent>((subscriber) => {
      // Browsers cannot set headers on a WebSocket, so the token goes in the query string.
      const url = new URL(this.wsUrl);
      url.searchParams.set('access_token', accessToken);
      const socket = new WebSocket(url.toString());

      socket.onopen = () => subscriber.next({ type: 'open' });
      // Raw text is passed on untouched, so the parser can count bad JSON later.
      socket.onmessage = (e: MessageEvent) =>
        subscriber.next({ type: 'message', data: e.data });
      // `error` carries no detail and is always followed by `close`, so only close is used.
      socket.onclose = (e: CloseEvent) =>
        subscriber.error(
          new TransportError('websocket', e.reason || `Closed with code ${e.code}`, e.code),
        );

      // Teardown: detach the handlers first, so our own close() reports nothing.
      return () => {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.close();
      };
    });
  }
}