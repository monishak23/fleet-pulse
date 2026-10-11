import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  catchError,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  Subject,
  tap,
  throwError,
} from 'rxjs';
import { APP_SETTINGS } from '../config/app-settings';
import { AuthResponse, Session, User } from './model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly settings = inject(APP_SETTINGS);

  private readonly ended = new Subject<void>();
  private readonly started = new Subject<void>();

  readonly sessionEnded$ = this.ended.asObservable();
  readonly sessionStarted$ = this.started.asObservable();

  private readonly session = signal<Session | null>(null);
  private refreshInFlight$: Observable<string> | null = null;

  readonly user = computed<User | null>(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly role = computed(() => this.user()?.role ?? null);
  readonly canEdit = computed(() => this.role() === 'operator');

  /**
   * Getter to get access token
   */
  get accessToken(): string | null {
    return this.session()?.accessToken ?? null;
  }


  /**
   * Login to the app
   *  
   * @param email User's email
   * @param password User's password
   * @returns Observable that emits the logged-in user on success, or an error on failure.
   */
  login(email: string, password: string): Observable<User> {
    return this.http
      .post<AuthResponse>(`${this.settings.api.baseUrl}/auth/login`, { email, password })
      .pipe(
        tap((res) => this.applySession(res)),
        map((res) => res.user),
      );
  }

  /**
   * Refresh the access token using the refresh token.
   * 
   * @returns Observable that emits the new access token on success, or an error on failure.
   */
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
        tap((res) => this.applySession(res)),
        map((res) => res.accessToken),
        catchError((err: unknown) => {
          if (err instanceof HttpErrorResponse && err.status === 401) {
            this.endSession();
          }
          return throwError(() => err);
        }),
        finalize(() => (this.refreshInFlight$ = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.refreshInFlight$;
  }

  /**
   * Ensure that the access token is fresh, refreshing it if necessary.
   * 
   * @param marginMs The margin in milliseconds before the token expires to consider it "fresh".
   * @returns Observable that emits the access token, either the current one if it's fresh enough, or a new one if it was refreshed.
   */
  ensureFreshToken(marginMs: number): Observable<string> {
    const current = this.session();
    if (!current) {
      return throwError(() => new Error('No session'));
    }
    return current.expiresAt - Date.now() > marginMs ? of(current.accessToken) : this.refresh();
  }

  /**
   * End the current session, clearing the stored tokens and user info, and navigating to the login page.
   */
  endSession(): void {
    if (!this.session()) return; 
    this.session.set(null);
    this.refreshInFlight$ = null;
    this.ended.next();
    void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }

  /**
   * Logout the user, ending the session.
   */
  logout(): void {
    this.endSession();
  }

  /**
   * Store the auth token
   * 
   * @param res The response from the server containing the access token, refresh token, and user info.
   */
  private applySession(res: AuthResponse): void {
    this.session.set({
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      expiresAt: Date.now() + res.expiresIn * 1000,
      user: res.user,
    });
    this.started.next();
  }
}