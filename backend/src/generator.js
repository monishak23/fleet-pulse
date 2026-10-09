import { EventEmitter } from 'node:events';
import { getChaos } from './chaos.js';
import { SERVICE_COUNT, store, makeEvent } from './data.js';

const TICK_MS = 50;
const RETENTION_MS = 6 * 60 * 1000; // contract minimum is 5 min; keep a little extra
const MIN_RATE = 1;
const MAX_RATE = 5000;

// Replay buffer: events in offset order. `start` avoids slow Array.shift() calls.
let buffer = [];
let start = 0;

// Per-service sequence counters. initStore() already produced seq 1 for each service.
const seqs = new Array(SERVICE_COUNT).fill(1);
let cursor = 0; // round-robin service pointer
let carry = 0; // fractional events carried between ticks

// Emits 'batch' with an array of MetricEvent. Slice 5 subscribes to this.
export const generatorEvents = new EventEmitter();

export function currentRate() {
  const n = Number(getChaos().rate);
  if (!Number.isFinite(n)) return 500;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, n));
}

function tick() {
  const now = Date.now();
  carry += (currentRate() * TICK_MS) / 1000;
  const count = Math.floor(carry);
  carry -= count;
  if (count === 0) return;

  const batch = new Array(count);
  for (let k = 0; k < count; k++) {
    const i = cursor;
    cursor = (cursor + 1) % SERVICE_COUNT;
    const event = makeEvent(i, ++store.offset, ++seqs[i], now);
    store.latest[i] = event; // snapshot stays consistent even if delivery drops it
    buffer.push(event);
    batch[k] = event;
  }

  // Trim anything older than the retention window
  const cutoff = now - RETENTION_MS;
  while (start < buffer.length && buffer[start].ts < cutoff) start++;
  if (start > 100_000) {
    buffer = buffer.slice(start);
    start = 0;
  }

  generatorEvents.emit('batch', batch);
}

setInterval(tick, TICK_MS);

// Events with offset > since, in offset order, or null if `since` is too old.
export function replaySince(since) {
  // The oldest offset we can still serve is (first buffered offset - 1)
  const first = start < buffer.length ? buffer[start] : null;
  if (first && since < first.offset - 1) return null;
  if (!first) return since < store.offset ? null : [];

  // Offsets are contiguous, so the target position is computable directly
  const from = Math.max(start, start + (since - (first.offset - 1)));
  return buffer.slice(from);
}