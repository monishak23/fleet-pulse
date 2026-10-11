import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { APP_SETTINGS } from '../config/app-settings';
import { FleetService } from '../fleet/fleet-service';
import { UiPreferencesService } from '../preferences/ui-preferences';
import { MetricEvent } from '../stream/model';
import { AuthService } from '../auth/service';
import { RuleCondition, AlertRule } from './rule-model';

@Injectable({ providedIn: 'root' })
export class RuleApi {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(APP_SETTINGS);

  list() {
    return this.http.get<AlertRule[]>(`${this.settings.api.baseUrl}/rules/`);
  }

  checkName(name: string, excludeId?: string) {
    return this.http.get<{ available: boolean }>(`${this.settings.api.baseUrl}/rules/check-name`, {
      params: { name, ...(excludeId ? { excludeId } : {}) },
    });
  }

  save(rule: Partial<AlertRule>, id?: string) {
    return id
      ? this.http.put<AlertRule>(`${this.settings.api.baseUrl}/rules/${id}`, rule)
      : this.http.post<AlertRule>(`${this.settings.api.baseUrl}/rules/`, rule);
  }

  delete(id: string) {
    return this.http.delete<void>(`${this.settings.api.baseUrl}/rules/${id}`);
  }
}

@Injectable({ providedIn: 'root' })
export class RuleMonitor {
  private readonly api = inject(RuleApi);
  private readonly fleet = inject(FleetService);
  private readonly auth = inject(AuthService);
  private readonly preferences = inject(UiPreferencesService);
  private readonly _rules = signal<readonly AlertRule[]>([]);
  readonly rules = this._rules.asReadonly();
  private readonly _incidents = signal<readonly RuleIncident[]>([]);
  readonly incidents = this._incidents.asReadonly();
  private readonly _error = signal<string | null>(null);
  readonly error = this._error.asReadonly();
  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();
  private loaded = false;
  private metricsSubscribed = false;
  private readonly activeSince = new Map<string, number>();
  private readonly notified = new Set<string>();

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this._loading.set(true);
    this._error.set(null);
    this.api.list().subscribe({
      next: (rules) => {
        this._rules.set(rules);
        this._loading.set(false);
      },
      error: () => {
        this.loaded = false;
        this._loading.set(false);
        this._error.set('Could not load alert rules.');
      },
    });
    this.fleet.initialize();
    if (!this.metricsSubscribed) {
      this.metricsSubscribed = true;
      this.fleet.metrics$.subscribe((metrics) => this.evaluateBatch(metrics));
    }
  }

  retry(): void {
    this.loaded = false;
    this.load();
  }

  replaceRules(rules: readonly AlertRule[]): void {
    this._rules.set(rules);
  }

  evaluate(metric: MetricEvent): void {
    this.evaluateBatch([metric]);
  }

  private evaluateBatch(metrics: readonly MetricEvent[]): void {
    const incidents = new Map(this._incidents().map((incident) => [incident.key, incident]));
    const rules = this._rules();
    for (const metric of metrics) {
      const now = metric.ts;
      for (const rule of rules) {
        const key = `${rule.id}:${metric.serviceId}`;
        if (rule.enabled === false) {
          this.activeSince.delete(key);
          this.notified.delete(key);
          incidents.delete(key);
          continue;
        }
        const matches = rule.conditions.every((condition) => matchesCondition(metric, condition));
        if (!matches) {
          this.activeSince.delete(key);
          this.notified.delete(key);
          incidents.delete(key);
          continue;
        }

        const startedAt = this.activeSince.get(key) ?? now;
        this.activeSince.set(key, startedAt);
        const durationMs = Math.max(
          ...rule.conditions.map((condition) => condition.durationSec * 1000),
        );
        if (now - startedAt < durationMs) continue;

        incidents.set(key, {
          key,
          ruleId: rule.id,
          ruleName: rule.name,
          serviceId: metric.serviceId,
          status: metric.status,
          openedAt: startedAt,
        });
        if (!this.notified.has(key)) {
          this.notified.add(key);
          this.notify(rule.name, metric.serviceId);
        }
      }
    }
    this._incidents.set([...incidents.values()].sort((a, b) => b.openedAt - a.openedAt));
  }

  private notify(ruleName: string, serviceId: string): void {
    if (!this.preferences.value().notificationsEnabled || !this.auth.isAuthenticated()) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(`Alert: ${ruleName}`, { body: `${serviceId} matched this rule.` });
  }
}

export interface RuleIncident {
  key: string;
  ruleId: string;
  ruleName: string;
  serviceId: string;
  status: string;
  openedAt: number;
}

export function matchesCondition(metric: MetricEvent, condition: RuleCondition): boolean {
  const value = metric[condition.metric];
  switch (condition.operator) {
    case '>':
      return value > condition.threshold;
    case '>=':
      return value >= condition.threshold;
    case '<':
      return value < condition.threshold;
    case '<=':
      return value <= condition.threshold;
  }
}
