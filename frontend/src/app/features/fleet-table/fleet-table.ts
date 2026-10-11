import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Fleets, FleetService } from '../../core/fleet/fleet-service';
import { UiPreferencesService } from '../../core/preferences/ui-preferences';
import { RuleMonitor } from '../../core/rules/rule-api';

type SortKey = 'name' | 'team' | 'status' | 'p95' | 'errRate' | 'rps';
type StatusFilter = 'all' | Fleets['status'];

@Component({
  imports: [CommonModule, ScrollingModule, RouterLink],
  selector: 'app-fleet-table',
  styleUrl: './fleet-table.scss',
  templateUrl: './fleet-table.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FleetTable {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly fleet = inject(FleetService);
  protected readonly preferences = inject(UiPreferencesService);
  private readonly ruleMonitor = inject(RuleMonitor);
  protected readonly search = signal('');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly sortKey = signal<SortKey>('name');
  protected readonly sortDirection = signal<'asc' | 'desc'>('asc');
  protected readonly trackService = (_index: number, service: Fleets): string => service.id;
  protected readonly filteredServices = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    const status = this.statusFilter();
    const key = this.sortKey();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    return this.fleet
      .services()
      .filter((service) => {
        const matchesSearch =
          !query ||
          service.name.toLocaleLowerCase().includes(query) ||
          service.team.toLocaleLowerCase().includes(query) ||
          service.id.toLocaleLowerCase().includes(query);
        return matchesSearch && (status === 'all' || service.status === status);
      })
      .sort((left, right) => {
        const a = left[key];
        const b = right[key];
        const result =
          typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a).localeCompare(String(b));
        return result * direction;
      });
  });

  constructor() {
    this.fleet.initialize();
    this.ruleMonitor.load();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.search.set(params.get('search') ?? '');
      const status = params.get('status') ?? 'all';
      this.statusFilter.set(
        ['all', 'healthy', 'degraded', 'down'].includes(status) ? (status as StatusFilter) : 'all',
      );
      const sort = params.get('sort') ?? 'name';
      if (['name', 'team', 'status', 'p95', 'errRate', 'rps'].includes(sort)) {
        this.sortKey.set(sort as SortKey);
      }
      this.sortDirection.set(params.get('direction') === 'desc' ? 'desc' : 'asc');
    });
  }

  protected get rowHeight(): number {
    return this.preferences.value().denseRows ? 34 : 46;
  }

  protected updateSearch(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.search.set(input.value);
    this.updateUrl();
  }

  protected updateStatus(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    this.statusFilter.set(select.value as StatusFilter);
    this.updateUrl();
  }

  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDirection.set('asc');
    }
    this.updateUrl();
  }

  protected retry(): void {
    this.fleet.retry();
  }

  private updateUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        search: this.search() || null,
        status: this.statusFilter() === 'all' ? null : this.statusFilter(),
        sort: this.sortKey() === 'name' ? null : this.sortKey(),
        direction: this.sortDirection() === 'asc' ? null : this.sortDirection(),
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
