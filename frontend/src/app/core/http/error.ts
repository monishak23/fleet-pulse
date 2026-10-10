import { HttpErrorResponse } from '@angular/common/http';

const SESSION_ENDED = 'SessionEnded';

// Error body shape from the API contract
export interface ApiErrorBody {
    error: {
        code: string;
        message: string;
        details: { field: string; message: string }[];
    };
}

export function describeHttpError(err: unknown): string {
    if (isSessionEnded(err)) {
        return 'Your session has ended. Please sign in again.';
    }
    if (err instanceof HttpErrorResponse) {
        if (err.status === 0) {
            return 'Cannot reach the server. Check your connection and try again.';
        }
        const body = err.error as ApiErrorBody | null;
        if (body?.error?.message) {
            return body.error.message;
        }
    }
    return 'Something went wrong. Please try again.';
}

export function apiErrorCode(err: unknown): string | null {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as ApiErrorBody | null;
    return body?.error?.code ?? null;
  }
  return null;
}

export function isTokenExpired(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 401 && apiErrorCode(err) === 'token_expired';
}

// Given to requests that were cancelled because the session ended.
// A distinct error lets the UI say "please sign in again" instead of a generic failure.
export function sessionEndedError(): Error {
    const err = new Error('Session ended');
    err.name = SESSION_ENDED;
    return err;
}

export function isSessionEnded(err: unknown): boolean {
    return err instanceof Error && err.name === SESSION_ENDED;
}

export function isTokenInvalid(err: unknown): boolean {
    return err instanceof HttpErrorResponse && err.status === 401 && apiErrorCode(err) === 'token_invalid';
}
