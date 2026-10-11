
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { MetricEvent } from './model';

@Injectable({ providedIn: 'root' })
export class MetricEventProcessor {
  private nextOffset: number | null = null;

  private readonly buffer = new Map<number, MetricEvent>();
  private readonly lastSeqByService = new Map<string, number>();

  private readonly orderedSubject = new Subject<MetricEvent>();
  readonly ordered$ = this.orderedSubject.asObservable();

  /**
   * Set the snapshot's latest global offset.
   * The next expected stream event is offset + 1.
   */
  setBaseline(offset: number): void {
    this.nextOffset = offset + 1;
    this.buffer.clear();
    this.lastSeqByService.clear();
  }

  /**
   * Add a parsed metric to the reorder buffer.
   * Events are emitted only in contiguous global offset order.
   */
  push(event: MetricEvent): void {
    if (this.nextOffset === null) {
      // Establish a baseline from the first event if no snapshot was loaded.
      this.nextOffset = event.offset;
    }

    // Already processed or older than the current expected offset.
    if (event.offset < this.nextOffset) {
      return;
    }

    // Ignore duplicate global offsets.
    if (this.buffer.has(event.offset)) {
      return;
    }

    this.buffer.set(event.offset, event);
    this.flushContiguous();
  }

  private flushContiguous(): void {
    while (
      this.nextOffset !== null &&
      this.buffer.has(this.nextOffset)
    ) {
      const event = this.buffer.get(this.nextOffset)!;
      this.buffer.delete(this.nextOffset);

      const lastSeq = this.lastSeqByService.get(event.serviceId);

      // Skip repeated or older sequence numbers for this service.
      if (lastSeq === undefined || event.seq > lastSeq) {
        this.lastSeqByService.set(event.serviceId, event.seq);
        this.orderedSubject.next(event);
      }

      // Advance the global offset even if this service event was a duplicate.
      this.nextOffset++;
    }
  }

  /** Clear processor state when starting a fresh stream/snapshot. */
  reset(): void {
    this.nextOffset = null;
    this.buffer.clear();
    this.lastSeqByService.clear();
  }
}
