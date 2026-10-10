import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, map, Observable, shareReplay, Subject, tap, throwError } from 'rxjs';
import { APP_SETTINGS } from '../config/app-settings';
import { AuthResponse, Session, User } from './model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly ended = new Subject<void>();
  /** Emits when the session ends. In-flight requests and the stream listen to it. */
  readonly sessionEnded$ = this.ended.asObservable();
  private readonly http = inject(HttpClient);
  private readonly settings = inject(APP_SETTINGS);

  // Tokens live in memory only. A page reload means signing in again.
  private readonly session = signal<Session | null>(null);

  // The refresh request currently running, shared by every caller (single-flight)
  private refreshInFlight$: Observable<string> | null = null;

  readonly user = computed<User | null>(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly role = computed(() => this.user()?.role ?? null);

  get accessToken(): string | null {
    return this.session()?.accessToken ?? null;
  }

  login(email: string, password: string): Observable<User> {
    return this.http
      .post<AuthResponse>(`${this.settings.api.baseUrl}/auth/login`, { email, password })
      .pipe(
        tap((res) => this.applySession(res)),
        map((res) => res.user),
      );
  }

  /** Returns the new access token. Concurrent callers share ONE network request. */
  refresh(): Observable<string> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }
    const current = this.session();
    if (!current) {
      return throwError(() => new Error('No session to refresh'));
    }

    this.refreshInFlight$ = this.http
      .post<AuthResponse>(`${this.settings.api.baseUrl}/auth/refresh`, {
        refreshToken: current.refreshToken,
      })
      .pipe(
        tap((res) => this.applySession(res)), // the refresh token rotates, so store the new one
        map((res) => res.accessToken),
        catchError((err: unknown) => {
          // Only a rejected refresh token ends the session.
          // Network errors and 5xx keep it, so the app can recover later.
          if (err instanceof HttpErrorResponse && err.status === 401) {
            this.endSession();
          }
          return throwError(() => err);
        }),
        finalize(() => (this.refreshInFlight$ = null)),
        finalize(() => (this.refreshInFlight$ = null)), // next expiry starts a fresh refresh
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.refreshInFlight$;
  }

  applySession(res: AuthResponse): void {
    this.session.set({
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      user: res.user,
    });
  }

    /** The server rejected our credentials: clear everything and go to login. */
  endSession(): void {
    if (!this.session()) return; // already ended, so emit only once
    this.session.set(null);
    this.refreshInFlight$ = null;
    this.ended.next();
    void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }

  logout(): void {
    this.endSession();
  }
}