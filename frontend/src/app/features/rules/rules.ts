import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  AsyncValidatorFn,
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { catchError, map, of } from 'rxjs';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/service';
import { RuleApi, RuleMonitor } from '../../core/rules/rule-api';
import { AlertRule, RuleCondition, RuleMetric, RuleOperator } from '../../core/rules/rule-model';

type ConditionGroup = FormGroup<{
  metric: FormControl<RuleMetric>;
  operator: FormControl<RuleOperator>;
  threshold: FormControl<number>;
  durationSec: FormControl<number>;
}>;

@Component({
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  selector: 'app-rules',
  styleUrl: './rules.scss',
  templateUrl: './rules.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Rules {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(RuleApi);
  protected readonly monitor = inject(RuleMonitor);
  protected readonly auth = inject(AuthService);
  protected readonly editingId = signal<string | null>(null);
  protected readonly pending = signal(false);
  protected readonly savingRuleId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly conditions = this.fb.array([this.newCondition()], {
    validators: [this.uniqueMetrics],
  });
  protected readonly form = this.fb.group({
    name: this.fb.control('', {
      validators: [Validators.required, Validators.maxLength(80)],
      asyncValidators: [this.nameAvailable()],
      updateOn: 'blur',
    }),
    conditions: this.conditions,
  });

  constructor() {
    this.monitor.load();
  }

  protected addCondition(): void {
    this.conditions.push(this.newCondition());
  }

  protected removeCondition(index: number): void {
    if (this.conditions.length > 1) this.conditions.removeAt(index);
  }

  protected startEdit(rule: AlertRule): void {
    this.editingId.set(rule.id);
    this.form.controls.name.setValue(rule.name);
    this.conditions.clear();
    for (const condition of rule.conditions) {
      this.conditions.push(this.newCondition(condition));
    }
    this.form.markAsPristine();
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.resetForm();
  }

  canDeactivate(): boolean {
    return !this.form.dirty || window.confirm('Discard unsaved alert rule changes?');
  }

  protected save(): void {
    if (this.pending()) return;
    if (this.form.invalid || this.form.pending) {
      this.form.markAllAsTouched();
      return;
    }

    const id = this.editingId();
    const before = this.monitor.rules();
    const timestamp = Date.now();
    const formValue = this.form.getRawValue();
    const optimistic: AlertRule = {
      id: id ?? `pending-${timestamp}`,
      name: formValue.name.trim(),
      conditions: formValue.conditions as RuleCondition[],
      enabled: before.find((rule) => rule.id === id)?.enabled ?? true,
      createdAt: before.find((rule) => rule.id === id)?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.error.set(null);
    this.pending.set(true);
    this.monitor.replaceRules(
      id ? before.map((rule) => (rule.id === id ? optimistic : rule)) : [optimistic, ...before],
    );
    this.api.save(optimistic, id ?? undefined).subscribe({
      next: (saved) => {
        this.monitor.replaceRules(
          id
            ? this.monitor.rules().map((rule) => (rule.id === id ? saved : rule))
            : this.monitor.rules().map((rule) => (rule.id === optimistic.id ? saved : rule)),
        );
        this.pending.set(false);
        this.editingId.set(null);
        this.resetForm();
      },
      error: () => {
        this.monitor.replaceRules(before);
        this.pending.set(false);
        this.error.set('Could not save the rule. Your changes were rolled back.');
      },
    });
  }

  protected toggle(rule: AlertRule): void {
    if (this.savingRuleId()) return;
    const before = this.monitor.rules();
    const updated = { ...rule, enabled: rule.enabled === false };
    this.monitor.replaceRules(before.map((item) => (item.id === rule.id ? updated : item)));
    this.savingRuleId.set(rule.id);
    this.api.save(updated, rule.id).subscribe({
      next: (saved) => {
        this.monitor.replaceRules(
          this.monitor.rules().map((item) => (item.id === rule.id ? saved : item)),
        );
        this.savingRuleId.set(null);
      },
      error: () => {
        this.monitor.replaceRules(before);
        this.savingRuleId.set(null);
        this.error.set(`Could not update “${rule.name}”. The previous state was restored.`);
      },
    });
  }

  protected delete(rule: AlertRule): void {
    if (this.savingRuleId()) return;
    const before = this.monitor.rules();
    this.monitor.replaceRules(before.filter((item) => item.id !== rule.id));
    this.savingRuleId.set(rule.id);
    this.api.delete(rule.id).subscribe({
      next: () => this.savingRuleId.set(null),
      error: () => {
        this.monitor.replaceRules(before);
        this.savingRuleId.set(null);
        this.error.set(`Could not delete “${rule.name}”. The rule was restored.`);
      },
    });
  }

  protected formatConditions(conditions: readonly RuleCondition[]): string {
    return conditions
      .map((condition) => `${condition.metric} ${condition.operator} ${condition.threshold}`)
      .join(' AND ');
  }

  private resetForm(): void {
    this.form.controls.name.setValue('');
    this.conditions.clear();
    this.conditions.push(this.newCondition());
    this.form.markAsPristine();
  }

  private newCondition(value?: RuleCondition): ConditionGroup {
    return this.fb.group(
      {
        metric: this.fb.control<RuleMetric>(value?.metric ?? 'p95'),
        operator: this.fb.control<RuleOperator>(value?.operator ?? '>'),
        threshold: this.fb.control(value?.threshold ?? 500, [
          Validators.required,
          Validators.min(0),
          Validators.max(1000000),
        ]),
        durationSec: this.fb.control(value?.durationSec ?? 0, [
          Validators.required,
          Validators.min(0),
          Validators.max(86400),
        ]),
      },
      { validators: [this.thresholdRange] },
    ) as ConditionGroup;
  }

  private nameAvailable(): AsyncValidatorFn {
    return (control: AbstractControl) => {
      const name = String(control.value ?? '').trim();
      if (!name) return of(null);
      return this.api.checkName(name, this.editingId() ?? undefined).pipe(
        map((result) => (result.available ? null : { nameTaken: true })),
        catchError(() => of({ nameCheckFailed: true })),
      );
    };
  }

  private uniqueMetrics(control: AbstractControl): ValidationErrors | null {
    const array = control as FormArray;
    const metrics = array.controls.map((item) => item.get('metric')?.value);
    return new Set(metrics).size === metrics.length ? null : { duplicateMetric: true };
  }

  private thresholdRange(control: AbstractControl): ValidationErrors | null {
    const metric = control.get('metric')?.value;
    const threshold = Number(control.get('threshold')?.value);
    return metric === 'errRate' && threshold > 100 ? { thresholdOutOfRange: true } : null;
  }
}
