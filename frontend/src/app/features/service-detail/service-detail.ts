import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { APP_SETTINGS } from '../../core/config/app-settings';
import { FleetStore } from '../../core/fleet/fleet-store';
import { UiPreferencesService } from '../../core/preferences/ui-preferences';
import { RuleMonitor } from '../../core/rules/rule-api';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, EMPTY, map, Subject, switchMap, tap } from 'rxjs';

interface HistoryPoint {
  ts: number;
  p95: number;
  errRate: number;
  rps: number;
}

type ChartMetric = 'p95' | 'errRate' | 'rps';

@Component({
  imports: [CommonModule, RouterLink],
  selector: 'app-service-detail',
  styleUrl: './service-detail.scss',
  templateUrl: './service-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiceDetail {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly settings = inject(APP_SETTINGS);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly fleet = inject(FleetStore);
  protected readonly preferences = inject(UiPreferencesService);
  private readonly ruleMonitor = inject(RuleMonitor);
  private readonly historyRequests = new Subject<string>();
  protected readonly serviceId = signal('');
  protected readonly metric = signal<ChartMetric>('p95');
  protected readonly history = signal<readonly HistoryPoint[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private readonly now = signal(Date.now());
  protected readonly service = computed(
    () => this.fleet.serviceById().get(this.serviceId()) ?? null,
  );
  protected readonly stale = computed(() => {
    const current = this.service();
    return !!current && this.now() - current.ts > this.preferences.value().staleAfterSeconds * 1000;
  });
  protected readonly chartPath = computed(() => this.makePath(this.metric()));

  constructor() {
    const clock = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(clock));
    this.fleet.initialize();
    this.ruleMonitor.load();
    this.fleet.metrics$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((metrics) => {
      const id = this.serviceId();
      const latest = metrics.find((metric) => metric.serviceId === id);
      if (!latest) return;
      this.history.update((points) =>
        this.reducePoints([
          ...points,
          {
            ts: latest.ts,
            p95: latest.p95,
            errRate: latest.errRate,
            rps: latest.rps,
          },
        ]),
      );
    });
    this.historyRequests
      .pipe(
        switchMap((id) => this.fetchHistory(id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((points) => {
        const merged = [...points];
        const current = this.service();
        if (current && current.ts > (merged.at(-1)?.ts ?? 0)) {
          merged.push({
            ts: current.ts,
            p95: current.p95,
            errRate: current.errRate,
            rps: current.rps,
          });
        }
        this.history.set(this.reducePoints(merged));
      });
    this.route.paramMap
      .pipe(
        map((params) => params.get('id') ?? ''),
        distinctUntilChanged(),
        tap((id) => {
          this.serviceId.set(id);
          this.history.set([]);
          this.historyRequests.next(id);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  protected retry(): void {
    const id = this.serviceId();
    if (id) this.historyRequests.next(id);
  }

  protected selectMetric(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    this.metric.set(select.value as ChartMetric);
  }

  private fetchHistory(id: string) {
    this.loading.set(true);
    this.error.set(null);
    return this.http
      .get<{ serviceId: string; points: HistoryPoint[] }>(
        `${this.settings.api.baseUrl}/metrics/history`,
        {
          params: {
            serviceId: id,
            minutes: this.settings.charts.historyMinutes,
          },
        },
      )
      .pipe(
        map((response) => response.points),
        tap(() => this.loading.set(false)),
        catchError(() => {
          this.loading.set(false);
          this.error.set('Could not load metric history.');
          return EMPTY;
        }),
      );
  }

  private reducePoints(points: readonly HistoryPoint[]): readonly HistoryPoint[] {
    const max = this.settings.charts.maxPointsPerSeries;
    if (points.length <= max) return points;
    const reduced: HistoryPoint[] = [];
    for (let i = 0; i < max; i++) {
      reduced.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
    }
    return reduced;
  }

  private makePath(metric: ChartMetric): string {
    const points = this.history();
    if (points.length < 2) return '';
    const values = points.map((point) => point[metric]);
    const min = Math.min(...values);
    const range = Math.max(1, Math.max(...values) - min);
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 1000;
        const y = 190 - ((value - min) / range) * 170;
        return `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }
}
