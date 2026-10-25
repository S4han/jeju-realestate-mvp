// Latency measurement for the Phase 2 analysis API (P2-TASK-006, PRD: p95 0.5~1s).
// Requires an API server with PHASE2_PRICE_ANALYSIS_ENABLED=true and P2_CURSOR_SECRET on API_BASE.
// Usage: API_BASE=http://localhost:3001 P2_IDS=1,2,4 node scripts/phase2/perf.mjs [requestsPerView=200] [concurrency=4]
// Without P2_IDS the apartments with recent deals are taken from the Phase 1 map API.
const base = process.env.API_BASE ?? "http://localhost:3001";
const N = Number(process.argv[2] ?? 200);
const C = Number(process.argv[3] ?? 4);
const TARGET_P95_MS = 1000;
const GOAL_P95_MS = 500;

const ids = process.env.P2_IDS
  ? process.env.P2_IDS.split(",")
  : (await (await fetch(`${base}/api/apartments/map?bbox=126.1,33.1,127.0,33.6`)).json()).items.filter((m) => m.recent_count > 0).map((m) => m.id);
if (!ids.length) throw new Error("no apartments to measure");

const periods = [12, 24, 36];
const pick = (a, i) => a[i % a.length];
const q = (i) => `period=${pick(periods, i)}`;
const views = {
  status: (i) => `/status`,
  areas: (i) => `/areas?${q(i)}`,
  summary: (i) => `/summary?${q(i)}`,
  monthly: (i) => `/monthly?${q(i)}`,
  points: (i) => `/points?${q(i)}`, // default area resolved server-side; 400 for apartments without deals
  transactions: (i) => `/transactions?${q(i)}&pageSize=20`,
};

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const results = {};
for (const [name, mk] of Object.entries(views)) {
  const url = (i) => `${base}/api/v2/analysis/apartments/${pick(ids, i * 7)}${mk(i)}`;
  await fetch(url(0)); // warm-up
  const times = [];
  let next = 0, errors = 0, noArea = 0;
  await Promise.all(Array.from({ length: C }, async () => {
    while (next < N) {
      const i = next++;
      const t0 = performance.now();
      const res = await fetch(url(i));
      await res.arrayBuffer();
      times.push(performance.now() - t0);
      // 400 = no deals in the period, so no default area type for points/evidence (expected, not an error).
      if (res.status === 400) noArea++;
      else if (res.status !== 200) errors++;
    }
  }));
  times.sort((a, b) => a - b);
  const p95 = pct(times, 95);
  results[name] = { n: times.length, errors, noArea400: noArea, p50: +pct(times, 50).toFixed(1), p95: +p95.toFixed(1), max: +times.at(-1).toFixed(1), goal_500: p95 <= GOAL_P95_MS, pass_1000: p95 <= TARGET_P95_MS };
}
console.table(results);
console.log(JSON.stringify({ base, apartments: ids.length, requestsPerView: N, concurrency: C, results }));
process.exit(Object.values(results).every((r) => r.pass_1000 && r.errors === 0) ? 0 : 1);
