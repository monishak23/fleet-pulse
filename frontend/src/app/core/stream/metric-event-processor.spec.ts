
import { TestBed } from '@angular/core/testing';
import { MetricEventProcessor } from './metric-event-processor';
import { MetricEvent } from './model';

describe('MetricEventProcessor', () => {
  let processor: MetricEventProcessor;
  let received: MetricEvent[];

  const makeEvent = (
    offset: number,
    seq: number,
  ): MetricEvent => ({
    type: 'metric',
    offset,
    serviceId: 'service-a',
    seq,
    ts: 1000 + offset,
    p95: 120,
    errRate: 1,
    rps: 50,
    status: 'healthy',
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MetricEventProcessor],
    });

    processor = TestBed.inject(MetricEventProcessor);
    received = [];
    processor.ordered$.subscribe(event => received.push(event));
  });

  it('processes events in global offset order', () => {
    processor.setBaseline(10);

    processor.push(makeEvent(12, 3));
    processor.push(makeEvent(11, 2));

    expect(received.map(event => event.offset)).toEqual([11, 12]);
  });

  it('ignores duplicate global offsets', () => {
    processor.setBaseline(10);

    processor.push(makeEvent(11, 1));
    processor.push(makeEvent(11, 1));

    expect(received.map(event => event.offset)).toEqual([11]);
  });

  it('ignores duplicate or older sequence numbers for a service', () => {
    processor.setBaseline(10);

    processor.push(makeEvent(11, 1));
    processor.push(makeEvent(12, 1));
    processor.push(makeEvent(13, 2));

    expect(received.map(event => event.offset)).toEqual([11, 13]);
  });
});
