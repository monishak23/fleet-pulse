import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from './core/auth/service';
import { ConnectionManager } from './core/stream/connection-manager';
import { FleetService } from './core/fleet/fleet-service';
import { RuleMonitor } from './core/rules/rule-api';

@Component({
  imports: [RouterOutlet, MatButtonModule, MatToolbarModule, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly connection = inject(ConnectionManager);
  private readonly fleet = inject(FleetService);
  private readonly ruleMonitor = inject(RuleMonitor);

  constructor() {
    this.auth.sessionEnded$.subscribe(() => this.connection.stop());
    this.auth.sessionStarted$.subscribe(() => {
      this.fleet.initialize();
      this.ruleMonitor.load();
    });
  }

  protected logout(): void {
    this.auth.logout();
  }
}
