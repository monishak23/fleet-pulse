import { Injectable, signal } from '@angular/core';

export interface UiPreferences {
  denseRows: boolean;
  notificationsEnabled: boolean;
  staleAfterSeconds: number;
}

const STORAGE_KEY = 'fleet-pulse-preferences';
const DEFAULT_PREFERENCES: UiPreferences = {
  denseRows: false,
  notificationsEnabled: false,
  staleAfterSeconds: 10,
};

@Injectable({ providedIn: 'root' })
export class UiPreferencesService {
  private readonly _error = signal<string | null>(null);
  readonly error = this._error.asReadonly();
  private readonly _value = signal(this.read());
  readonly value = this._value.asReadonly();

  save(value: UiPreferences): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      this._value.set(value);
      this._error.set(null);
    } catch {
      this._error.set('Could not save preferences in this browser.');
    }
  }

  private read(): UiPreferences {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_PREFERENCES;
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES;
      const saved = value as Partial<UiPreferences>;
      return {
        denseRows: saved.denseRows === true,
        notificationsEnabled: saved.notificationsEnabled === true,
        staleAfterSeconds:
          typeof saved.staleAfterSeconds === 'number' &&
          Number.isFinite(saved.staleAfterSeconds) &&
          saved.staleAfterSeconds >= 1 &&
          saved.staleAfterSeconds <= 60
            ? saved.staleAfterSeconds
            : DEFAULT_PREFERENCES.staleAfterSeconds,
      };
    } catch {
      this._error.set('Could not read saved preferences; defaults are in use.');
      return DEFAULT_PREFERENCES;
    }
  }
}
