import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { bufferTime, forkJoin, Subject } from 'rxjs';
import { APP_SETTINGS } from '../config/app-settings';
import { ConnectionManager } from '../stream/connection-manager';
import { MetricEvent, ServiceStatus, SnapshotResponse } from '../stream/model';

export interface Fleets {
  id: string;
  name: string;
  team: string;
  status: ServiceStatus;
  p95: number;
  errRate: number;
  rps: number;
  ts: number;
  seq: number;
}

type ServicesResponse = Omit<Fleets, 'p95' | 'errRate' | 'rps' | 'ts' | 'seq'>;

@Injectable({ providedIn: 'root' })
export class FleetService {
  private readonly http = inject(HttpClient);
  private readonly settings = inject(APP_SETTINGS);
  private readonly connection = inject(ConnectionManager);
  private initialized = false;

  private readonly _services = signal<readonly Fleets[]>([]);
  readonly services = this._services.asReadonly();
  private readonly metricSubject = new Subject<readonly MetricEvent[]>();
  readonly metrics$ = this.metricSubject.asObservable();
  readonly serviceById = computed(
    () => new Map(this._services().map((service) => [service.id, service])),
  );
  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();
  private readonly _error = signal<string | null>(null);
  readonly error = this._error.asReadonly();
  private readonly _flashing = signal<ReadonlySet<string>>(new Set());
  readonly flashing = this._flashing.asReadonly();

  initialize(): void {
    if (this.initialized) {
      this._error.set(null);
      this.connection.start();
      return;
    }
    if (this._loading()) return;
    this._loading.set(true);
    this._error.set(null);
    forkJoin({
      services: this.http.get<ServicesResponse[]>(`${this.settings.api.baseUrl}/services`),
      snapshot: this.http.get<SnapshotResponse>(`${this.settings.api.baseUrl}/metrics/snapshot`),
    }).subscribe({
      next: ({ services, snapshot }) => {
        const metrics = new Map(snapshot.metrics.map((metric) => [metric.serviceId, metric]));
        this._services.set(
          services.map((service) => this.combine(service, metrics.get(service.id))),
        );
        this.initialized = true;
        this._loading.set(false);
        this.connection.messages$
          .pipe(bufferTime(this.settings.ui.batchIntervalMs))
          .subscribe((events) => {
            const metricsInBatch = events.filter(
              (event): event is MetricEvent => event.type === 'metric',
            );
            if (metricsInBatch.length) this.applyMetrics(metricsInBatch);
          });
        this.connection.start();
      },
      error: () => {
        this._loading.set(false);
        this._error.set('Could not load fleet data. Please retry.');
      },
    });
  }

  retry(): void {
    this.initialized = false;
    this.initialize();
  }

  private combine(service: ServicesResponse, metric: MetricEvent | undefined): Fleets {
    return {
      ...service,
      status: metric?.status ?? service.status,
      p95: metric?.p95 ?? 0,
      errRate: metric?.errRate ?? 0,
      rps: metric?.rps ?? 0,
      ts: metric?.ts ?? Date.now(),
      seq: metric?.seq ?? 0,
    };
  }

  private applyMetrics(metrics: readonly MetricEvent[]): void {
    const latestById = new Map<string, MetricEvent>();
    for (const metric of metrics) {
      const current = latestById.get(metric.serviceId);
      if (!current || metric.seq > current.seq) latestById.set(metric.serviceId, metric);
    }

    const current = this._services();
    const updates = new Map(current.map((service) => [service.id, service]));
    const flashing = new Set(this._flashing());
    const acceptedMetrics: MetricEvent[] = [];
    for (const [id, metric] of latestById) {
      const service = updates.get(id);
      if (!service || metric.seq <= service.seq) continue;
      if (service.status !== metric.status) flashing.add(id);
      updates.set(id, this.combine(service, metric));
      acceptedMetrics.push(metric);
    }

    this._services.set(current.map((service) => updates.get(service.id) ?? service));
    if (acceptedMetrics.length) this.metricSubject.next(acceptedMetrics);
    this._flashing.set(flashing);
    if (flashing.size) {
      setTimeout(() => {
        this._flashing.update((active) => {
          const next = new Set(active);
          for (const id of flashing) next.delete(id);
          return next;
        });
      }, 900);
    }
  }
}
