export type RuleMetric = 'p95' | 'errRate' | 'rps';
export type RuleOperator = '>' | '>=' | '<' | '<=';

export interface RuleCondition {
  metric: RuleMetric;
  operator: RuleOperator;
  threshold: number;
  durationSec: number;
}

export interface AlertRule {
  id: string;
  name: string;
  conditions: RuleCondition[];
  enabled?: boolean;
  createdAt: number;
  updatedAt: number;
}
