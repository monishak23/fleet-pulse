// usage: node scripts/check-stream.mjs "<query string>" [seconds]
const query = process.argv[2] ?? '';
const seconds = Number(process.argv[3] ?? 10);
const base = 'http://localhost:4000';
const REQUIRED = ['offset', 'serviceId', 'seq', 'ts', 'p95', 'errRate', 'rps', 'status'];

const login = await (
  await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'operator@pulse.dev', password: 'pulse123' }),
  })
).json();

const stats = { metrics: 0, pings: 0, malformed: 0, duplicates: 0, outOfOrder: 0, missing: 0 };
const seen = new Set();
let min = Infinity;
let max = 0;
const started = Date.now();

try {
  const res = await fetch(`${base}/stream/sse?access_token=${login.accessToken}&${query}`, {
    signal: AbortSignal.timeout(seconds * 1000),
  });
  if (!res.ok) {
    console.log('HTTP', res.status, await res.text());
    process.exit(0);
  }
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line.slice(6));
      } catch {
        stats.malformed++;
        continue;
      }
      if (e.type === 'ping') {
        stats.pings++;
        continue;
      }
      if (!REQUIRED.every((k) => k in e)) {
        stats.malformed++;
        continue;
      }
      stats.metrics++;
      if (seen.has(e.offset)) {
        stats.duplicates++;
        continue;
      }
      seen.add(e.offset);
      if (e.offset < max) stats.outOfOrder++;
      max = Math.max(max, e.offset);
      min = Math.min(min, e.offset);
    }
  }
} catch {
  // abort after `seconds`, or the server closed the stream
}

stats.missing = seen.size ? max - min + 1 - seen.size : 0;
console.log(`ran ${((Date.now() - started) / 1000).toFixed(1)}s`, stats);