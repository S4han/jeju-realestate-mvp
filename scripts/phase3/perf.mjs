// Latency of the Phase 3 region API (P3-NFR-006: statistics/compare p95 ≤ 1000ms, detail ≤ 800ms, boundaries ≤ 2000ms).
// Requires an API server with PHASE3_REGION_ANALYSIS_ENABLED=true and P3_CURSOR_SECRET on API_BASE.
// Usage: API_BASE=http://localhost:3001 node scripts/phase3/perf.mjs [requestsPerView=100] [concurrency=4]
const base = (process.env.API_BASE ?? "http://localhost:3001") + "/api/v3/regions";
const N = Number(process.argv[2] ?? 100);
const C = Number(process.argv[3] ?? 4);
const periods = [12, 24, 36];
const metrics = ["price_per_m2", "trade_count"];
const cities = ["5011000000", "5013000000"];
const list = await (await fetch(`${base}/list`)).json();
const regions = list.regions.flatMap((c) => c.children.filter((r) => r.hasApartments).map((r) => r.regionId));
const pick = (a, i) => a[i % a.length];
const views = {
  statistics_city: [(i) => `statistics?level=city&period=${pick(periods, i)}&metric=${pick(metrics, i)}`, 1000],
  statistics_umd: [(i) => `statistics?level=legal_dong&parentRegionId=${pick(cities, i)}&period=${pick(periods, i)}&metric=${pick(metrics, i >> 1)}`, 1000],
  detail: [(i) => `detail?regionId=${pick(regions, i * 7)}&period=${pick(periods, i)}`, 800],
  compare: [(i) => `compare?regionIds=${pick(regions, i)},${pick(regions, i + 5)}&period=${pick(periods, i)}`, 1000],
  apartments: [(i) => `apartments?regionId=${pick(regions, i * 3)}&period=${pick(periods, i)}`, 1000],
  boundaries: [(i) => `boundaries?level=${i % 2 ? "city" : `legal_dong&parentRegionId=${pick(cities, i)}`}`, 2000],
};
const pct = (s, p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
const results = {};
for (const [name, [mk, target]] of Object.entries(views)) {
  await fetch(`${base}/${mk(0)}`);
  const times = [];
  let next = 0, errors = 0;
  await Promise.all(Array.from({ length: C }, async () => {
    while (next < N) {
      const i = next++;
      const t0 = performance.now();
      const res = await fetch(`${base}/${mk(i)}`);
      await res.arrayBuffer();
      times.push(performance.now() - t0);
      if (res.status !== 200) errors++;
    }
  }));
  times.sort((a, b) => a - b);
  results[name] = { n: times.length, errors, p50: +pct(times, 50).toFixed(1), p95: +pct(times, 95).toFixed(1), target_p95: target, pass: pct(times, 95) <= target };
}
console.table(results);
console.log(JSON.stringify({ base, regions: regions.length, requestsPerView: N, concurrency: C, results }));
process.exit(Object.values(results).every((r) => r.pass && r.errors === 0) ? 0 : 1);
