import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiPreferencesService } from '../../core/preferences/ui-preferences';

@Component({
  imports: [FormsModule],
  selector: 'app-settings',
  styleUrl: './settings.scss',
  templateUrl: './settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  protected readonly preferences = inject(UiPreferencesService);
  protected draft = { ...this.preferences.value() };
  protected saved = false;

  protected save(): void {
    this.preferences.save({ ...this.draft });
    this.saved = true;
  }
}
