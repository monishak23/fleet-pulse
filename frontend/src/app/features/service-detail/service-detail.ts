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
import { Color, NgxChartsModule, ScaleType } from '@swimlane/ngx-charts';
import { APP_SETTINGS } from '../../core/config/app-settings';
import { FleetService } from '../../core/fleet/fleet-service';
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

interface ChartPanel {
  key: ChartMetric;
  title: string;
  unit: string;
  scheme: Color;
}

const scheme = (color: string): Color => ({
  name: color,
  selectable: false,
  group: ScaleType.Ordinal,
  domain: [color],
});

@Component({
  imports: [CommonModule, RouterLink, NgxChartsModule],
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
  protected readonly fleet = inject(FleetService);
  protected readonly preferences = inject(UiPreferencesService);
  private readonly ruleMonitor = inject(RuleMonitor);
  private readonly historyRequests = new Subject<string>();

  // The template cannot read the private `settings`, so expose just these two values.
  protected readonly historyMinutes = this.settings.charts.historyMinutes;
  protected readonly maxPoints = this.settings.charts.maxPointsPerSeries;

  protected readonly serviceId = signal('');
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

  /** The three charts the brief asks for. */
  protected readonly panels: readonly ChartPanel[] = [
    { key: 'p95', title: 'P95 latency', unit: 'ms', scheme: scheme('#575d7b') },
    { key: 'errRate', title: 'Error rate', unit: '%', scheme: scheme('#9b241c') },
    { key: 'rps', title: 'Requests per second', unit: 'req/s', scheme: scheme('#176b35') },
  ];

  /** One series per chart. A Date as the point name makes ngx-charts use a time axis. */
  protected readonly charts = computed(() => {
    const points = this.history();
    const last = points.at(-1);
    return this.panels.map((panel) => ({
      panel,
      results: [
        {
          name: panel.title,
          series: points.map((point) => ({ name: new Date(point.ts), value: point[panel.key] })),
        },
      ],
      label: last
        ? `${panel.title} over time. Latest value ${last[panel.key]} ${panel.unit}.`
        : `${panel.title} over time. No data yet.`,
    }));
  });

  protected readonly formatTime = (value: Date): string =>
    value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

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
          { ts: latest.ts, p95: latest.p95, errRate: latest.errRate, rps: latest.rps },
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
          merged.push({ ts: current.ts, p95: current.p95, errRate: current.errRate, rps: current.rps });
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

  private fetchHistory(id: string) {
    this.loading.set(true);
    this.error.set(null);
    return this.http
      .get<{ serviceId: string; points: HistoryPoint[] }>(
        `${this.settings.api.baseUrl}/metrics/history`,
        { params: { serviceId: id, minutes: this.historyMinutes } },
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
    const max = this.maxPoints;
    if (points.length <= max) return points;
    const reduced: HistoryPoint[] = [];
    for (let i = 0; i < max; i++) {
      reduced.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
    }
    return reduced;
  }
}