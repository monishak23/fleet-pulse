import { describe, expect, it } from 'vitest';
import { MetricEvent } from '../stream/model';
import { RuleCondition } from './rule-model';
import { matchesCondition } from './rule-api';

const metric: MetricEvent = {
  type: 'metric',
  offset: 1,
  serviceId: 'svc-0001',
  seq: 1,
  ts: 1,
  p95: 500,
  errRate: 2.5,
  rps: 100,
  status: 'degraded',
};

describe('matchesCondition', () => {
  it('evaluates each supported comparison against a metric', () => {
    const conditions: RuleCondition[] = [
      { metric: 'p95', operator: '>', threshold: 499, durationSec: 0 },
      { metric: 'p95', operator: '>=', threshold: 500, durationSec: 0 },
      { metric: 'errRate', operator: '<', threshold: 3, durationSec: 0 },
      { metric: 'rps', operator: '<=', threshold: 100, durationSec: 0 },
    ];

    expect(conditions.every((condition) => matchesCondition(metric, condition))).toBe(true);
  });

  it('does not match values on the wrong side of the comparison', () => {
    expect(
      matchesCondition(metric, {
        metric: 'p95',
        operator: '<',
        threshold: 500,
        durationSec: 0,
      }),
    ).toBe(false);
  });
});
