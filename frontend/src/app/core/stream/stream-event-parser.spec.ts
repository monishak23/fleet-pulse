
import { TestBed } from '@angular/core/testing';
import { MetricEvent } from './model';
import { StreamEventParser } from './stream-event-parser';

describe('StreamEventParser', () => {
  let parser: StreamEventParser;

  const metric: MetricEvent = {
    type: 'metric',
    offset: 1,
    serviceId: 'svc-1',
    seq: 1,
    ts: 123,
    p95: 50,
    errRate: 0.5,
    rps: 10,
    status: 'healthy',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    parser = TestBed.inject(StreamEventParser);
  });

  it('parses a metric from JSON text', () => {
    expect(parser.parse(JSON.stringify(metric))).toEqual(metric);
  });

  it('accepts an already-decoded polling metric', () => {
    expect(parser.parse(metric)).toEqual(metric);
  });

  it('parses a valid ping', () => {
    expect(
      parser.parse(JSON.stringify({ type: 'ping', ts: 124 })),
    ).toEqual({
      type: 'ping',
      ts: 124,
    });
  });

  it('rejects invalid JSON and increments the malformed count', () => {
    expect(parser.parse('{broken')).toBeNull();
    expect(parser.malformedCount()).toBe(1);
  });

  it('rejects metrics missing required fields or containing invalid values', () => {
    expect(parser.parse({ ...metric, seq: undefined })).toBeNull();
    expect(parser.parse({ ...metric, errRate: 101 })).toBeNull();
    expect(parser.parse({ ...metric, status: 'unknown' })).toBeNull();
    expect(parser.malformedCount()).toBe(3);
  });
});
