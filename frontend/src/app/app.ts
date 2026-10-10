import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

@Component({
  imports: [RouterOutlet, MatButtonModule, MatToolbarModule, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
