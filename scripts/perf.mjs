// Local latency measurement for the public APIs (SECURITY_COST.md 성능 잠정 목표).
// Requires the API server on API_BASE (default http://localhost:3001) backed by collected data.
// Usage: node scripts/perf.mjs [requestsPerEndpoint=200] [concurrency=4]
const base = process.env.API_BASE ?? "http://localhost:3001";
const N = Number(process.argv[2] ?? 200);
const C = Number(process.argv[3] ?? 4);
const TARGETS_MS = { search: 500, map: 800, detail: 800, transactions: 1000 };

const get = async (path) => (await fetch(base + path)).json();
const ids = (await get(`/api/apartments/map?bbox=126.1,33.1,127.0,33.6`)).items.filter((m) => m.recent_count > 0).map((m) => m.id);
const words = ["노", "노형", "부영", "아라", "연동", "e편한", "삼화", "중문", "서귀포", "주공", "한라", "뜨란채", "해모로", "아이파크", "lh"];
const boxes = ["126.1,33.1,127.0,33.6", "126.45,33.47,126.55,33.52", "126.48,33.48,126.50,33.50", "126.50,33.24,126.58,33.27"];
const pick = (a, i) => a[i % a.length];
const paths = {
  search: (i) => `/api/apartments/search?q=${encodeURIComponent(pick(words, i))}&limit=10`,
  map: (i) => `/api/apartments/map?bbox=${pick(boxes, i)}`,
  detail: (i) => `/api/apartments/${pick(ids, i * 7)}`,
  transactions: (i) => `/api/apartments/${pick(ids, i * 11)}/transactions?type=${i % 2 ? "rent" : "sale"}&sort=${i % 3 ? "date_desc" : "price_desc"}`,
};

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const results = {};
for (const [name, mk] of Object.entries(paths)) {
  await fetch(base + mk(0)); // warm-up
  const times = [];
  let next = 0, errors = 0;
  await Promise.all(Array.from({ length: C }, async () => {
    while (next < N) {
      const i = next++;
      const t0 = performance.now();
      const res = await fetch(base + mk(i));
      await res.arrayBuffer();
      times.push(performance.now() - t0);
      if (res.status !== 200) errors++;
    }
  }));
  times.sort((a, b) => a - b);
  results[name] = { n: times.length, errors, p50: +pct(times, 50).toFixed(1), p95: +pct(times, 95).toFixed(1), max: +times.at(-1).toFixed(1), target_p95: TARGETS_MS[name], pass: pct(times, 95) <= TARGETS_MS[name] };
}
console.table(results);
console.log(JSON.stringify({ base, requestsPerEndpoint: N, concurrency: C, results }));
process.exit(Object.values(results).every((r) => r.pass && r.errors === 0) ? 0 : 1);
