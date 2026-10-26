// Fact sheet for the AI region summary (P4-TASK-002, docs/phase4/P4-TASK-001_DESIGN.md 4절).
// Every number the summary may mention is computed here, from Phase 3 region statistics read in one
// read-only snapshot. The model only phrases these facts; it never sees a number it may type itself
// (sentences reference facts by placeholder and the server fills in `display`).
//   window: the last 12 contract months vs the 12 before (Phase 3's 1-year change), confirmed apartments' valid sales
import type pg from "pg";
import { MIN_SAMPLE, periodWindow, withSnapshot } from "../phase2/analysis.js";
import { REGION_DEALS_SQL } from "../phase3/mapping.js";
import { activeSetId } from "../phase3/regionSet.js";
import { loadRegionStats, type DataStatus, type RegionStat } from "../phase3/statistics.js";

export type Scope = "JEJU" | "50110" | "50130";
export const SCOPES: Scope[] = ["JEJU", "50110", "50130"];
export const CITY_NAMES: Record<string, string> = { "50110": "제주시", "50130": "서귀포시" };

// Selection thresholds (design 4절). Regions below MOVER_MIN deals on either side never rank as movers.
export const MOVER_MIN = 10;
export const TOP_N = 3;
export const SMALL_SAMPLE_PCT = 20;
export const VOLUME_SHIFT_PCT = 30;
export const SAME_COMPLEX_MIN_APARTMENTS = 5;

export type FactValue = { value: number; display: string };
export type FactKind = "CITY_COUNT" | "CITY_PRICE" | "TOP_UP" | "TOP_DOWN" | "TOP_VOLUME" | "VOLUME_SHIFT" | "SMALL_SAMPLE" | "UNMAPPED" | "SAME_COMPLEX";
export type Fact = { id: string; kind: FactKind; region: { code: string; name: string }; fields: Record<string, FactValue> };
export type SameComplex = { apartments: number; ratio: number };
export type FactSheet = {
  scope: Scope;
  snapshotId: string;
  dataAsOf: string | null;
  recentFrom: string;
  previousFrom: string;
  to: string;
  facts: Fact[];
  notes: string[]; // fixed caveats written by code, shown under the AI sentences
};
export type FactResult = { ok: true; sheet: FactSheet } | { ok: false; reason: "NO_ACTIVE_SET" | "INCOMPLETE_DATA" | "STALE_DATA"; snapshotId?: string };

const count = (n: number): FactValue => ({ value: n, display: `${n.toLocaleString("ko-KR")}건` });
const pct = (p: number): FactValue => ({ value: p, display: `${p > 0 ? "+" : ""}${p.toFixed(1)}%` });
const perM2 = (won: number): FactValue => ({ value: won, display: `${Math.round(won / 10_000).toLocaleString("ko-KR")}만원/㎡` });
const changePct = (recent: number, previous: number) => Math.round(((recent - previous) / previous) * 1000) / 10;
const ym = (d: string) => `${d.slice(0, 4)}.${d.slice(5, 7)}`;

export const NOTE_BASIS = (recentFrom: string, previousFrom: string) =>
  `확정된 단지의 유효 매매 기준, 최근 12개월(${ym(recentFrom)}~)과 직전 12개월(${ym(previousFrom)}~)을 비교했습니다.`;
export const NOTE_REPORTING_LAG = "최근 1~2개월 거래는 신고 기한(계약 후 30일)이 지나지 않아 덜 집계되어 있을 수 있습니다.";
export const NOTE_SMALL_SAMPLE = "거래가 적은 지역의 변화율은 어떤 단지가 거래됐는지에 따라 크게 달라질 수 있습니다.";
export const NOTE_SAME_COMPLEX = "'같은 단지 기준'은 두 기간에 각각 3건 이상 거래된 단지만 비교한 값입니다.";

export type FactInput = {
  scope: Scope;
  snapshotId: string;
  cities: RegionStat[]; // level CITY, already limited to the scope
  regions: RegionStat[]; // level UMD of the scope's cities
  unmapped: Record<string, { mapped: number; total: number }>;
  dataStatus: DataStatus;
  sameComplex: Map<string, SameComplex>; // region or city code (10 digits) → same-apartment comparison
  recentFrom: string;
  previousFrom: string;
  to: string;
};

const ref = (r: RegionStat) => ({ code: r.regionCode, name: r.name });
const byCode = (a: RegionStat, b: RegionStat) => a.regionCode.localeCompare(b.regionCode);

/** Pure: the fact sheet for one scope, or why none may be written. Deterministic for the same input. */
export function buildFacts(x: FactInput): FactResult {
  const changeIncomplete = [...x.cities, ...x.regions].some((r) => r.change.status === "INCOMPLETE_DATA");
  if (x.dataStatus.completeness !== "COMPLETE" || changeIncomplete) return { ok: false, reason: "INCOMPLETE_DATA", snapshotId: x.snapshotId };
  if (x.dataStatus.freshness !== "FRESH") return { ok: false, reason: "STALE_DATA", snapshotId: x.snapshotId };

  const facts: Fact[] = [];
  const add = (kind: FactKind, id: string, r: RegionStat, fields: Record<string, FactValue>) => facts.push({ id, kind, region: ref(r), fields });
  const featured = new Set<string>();

  for (const c of [...x.cities].sort(byCode)) {
    const k = c.cityCode;
    const { recentCount: rc, previousCount: pc } = c.change;
    add("CITY_COUNT", `C${k}.count`, c, { recent: count(rc), previous: count(pc), ...(pc > 0 ? { change: pct(changePct(rc, pc)) } : {}) });
    if (c.change.status === "AVAILABLE") {
      add("CITY_PRICE", `C${k}.price`, c, { recent: perM2(c.change.recentMedianWon!), previous: perM2(c.change.previousMedianWon!), change: pct(c.change.pct!) });
      featured.add(c.regionCode);
    }
    const u = x.unmapped[k];
    if (u && u.total > u.mapped) add("UNMAPPED", `C${k}.unmapped`, c, { count: count(u.total - u.mapped), total: count(u.total) });
  }

  const movers = x.regions.filter((r) => r.change.status === "AVAILABLE" && r.change.recentCount >= MOVER_MIN && r.change.previousCount >= MOVER_MIN);
  const moverFields = (r: RegionStat) => ({
    change: pct(r.change.pct!), recent: perM2(r.change.recentMedianWon!), previous: perM2(r.change.previousMedianWon!),
    recentCount: count(r.change.recentCount), previousCount: count(r.change.previousCount),
  });
  const up = movers.filter((r) => r.change.pct! > 0).sort((a, b) => b.change.pct! - a.change.pct! || byCode(a, b)).slice(0, TOP_N);
  const down = movers.filter((r) => r.change.pct! < 0).sort((a, b) => a.change.pct! - b.change.pct! || byCode(a, b)).slice(0, TOP_N);
  up.forEach((r, i) => (add("TOP_UP", `UP${i + 1}`, r, moverFields(r)), featured.add(r.regionCode)));
  down.forEach((r, i) => (add("TOP_DOWN", `DOWN${i + 1}`, r, moverFields(r)), featured.add(r.regionCode)));

  const busiest = x.regions.filter((r) => r.change.recentCount > 0)
    .sort((a, b) => b.change.recentCount - a.change.recentCount || byCode(a, b)).slice(0, TOP_N);
  busiest.forEach((r, i) => add("TOP_VOLUME", `VOL${i + 1}`, r, { recentCount: count(r.change.recentCount) }));

  const shifts = x.regions.filter((r) => r.change.previousCount >= MOVER_MIN)
    .map((r) => ({ r, p: changePct(r.change.recentCount, r.change.previousCount) }))
    .filter(({ p }) => Math.abs(p) >= VOLUME_SHIFT_PCT)
    .sort((a, b) => Math.abs(b.p) - Math.abs(a.p) || byCode(a.r, b.r)).slice(0, TOP_N);
  shifts.forEach(({ r, p }, i) => add("VOLUME_SHIFT", `SHIFT${i + 1}`, r, { change: pct(p), recentCount: count(r.change.recentCount), previousCount: count(r.change.previousCount) }));

  const small = x.regions.filter((r) => r.change.status === "AVAILABLE" && Math.abs(r.change.pct!) >= SMALL_SAMPLE_PCT
    && Math.min(r.change.recentCount, r.change.previousCount) < MOVER_MIN)
    .sort((a, b) => Math.abs(b.change.pct!) - Math.abs(a.change.pct!) || byCode(a, b)).slice(0, TOP_N);
  small.forEach((r, i) => (add("SMALL_SAMPLE", `SMALL${i + 1}`, r, moverFields(r)), featured.add(r.regionCode)));

  const all = [...x.cities, ...x.regions];
  for (const code of [...featured].sort()) {
    const s = x.sameComplex.get(code);
    if (!s || s.apartments < SAME_COMPLEX_MIN_APARTMENTS) continue;
    const r = all.find((z) => z.regionCode === code)!;
    add("SAME_COMPLEX", `SAME.${code}`, r, { change: pct(Math.round((s.ratio - 1) * 1000) / 10), apartments: { value: s.apartments, display: `${s.apartments}곳` } });
  }

  const notes = [NOTE_BASIS(x.recentFrom, x.previousFrom), NOTE_REPORTING_LAG];
  if (small.length) notes.push(NOTE_SMALL_SAMPLE);
  if (facts.some((f) => f.kind === "SAME_COMPLEX")) notes.push(NOTE_SAME_COMPLEX);
  return { ok: true, sheet: { scope: x.scope, snapshotId: x.snapshotId, dataAsOf: x.dataStatus.lastSuccessfulSyncAt, recentFrom: x.recentFrom, previousFrom: x.previousFrom, to: x.to, facts, notes } };
}

/**
 * Same-apartment comparison per region and per city: for each apartment with >= 3 valid sales in both the
 * recent and the previous 12 months, the ratio of its two median prices per ㎡; the region value is the median
 * of those ratios. Removes the effect of which complexes happened to trade (mix within a complex remains).
 */
export async function loadSameComplex(c: pg.PoolClient, setId: string, previousFrom: string, recentFrom: string, to: string): Promise<Map<string, SameComplex>> {
  const { rows } = await c.query<{ code: string; apartments: number; ratio: string }>(
    `WITH a AS (
       SELECT d.region_code, d.apartment_id,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY d.sale_price / d.area_m2) FILTER (WHERE d.contract_date >= $4) AS rm,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY d.sale_price / d.area_m2) FILTER (WHERE d.contract_date < $4) AS pm,
              count(*) FILTER (WHERE d.contract_date >= $4) AS rn,
              count(*) FILTER (WHERE d.contract_date < $4) AS pn
         FROM (${REGION_DEALS_SQL}) d WHERE d.mapping_status = 'MAPPED' GROUP BY 1, 2)
     SELECT coalesce(region_code, left(min(region_code), 5) || '00000') AS code, count(*)::int AS apartments,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY rm / pm) AS ratio
       FROM a WHERE rn >= $5 AND pn >= $5
      GROUP BY GROUPING SETS ((region_code), (left(region_code, 5)))`,
    [setId, previousFrom, to, recentFrom, MIN_SAMPLE],
  );
  return new Map(rows.map((r) => [r.code, { apartments: r.apartments, ratio: Number(r.ratio) }]));
}

/** Loads one scope's facts from the active region set inside a single read-only snapshot. */
export async function loadFacts(pool: pg.Pool, scope: Scope, now: Date): Promise<FactResult> {
  return withSnapshot(pool, async (c) => {
    const setId = await activeSetId(c);
    if (!setId) return { ok: false, reason: "NO_ACTIVE_SET" } as const;
    const cityCodes = scope === "JEJU" ? ["50110", "50130"] : [scope];
    // Period 12 reads the same 24-month span as the 1-year change, so its snapshot id is the one the
    // 12- and 24-month screens show.
    const cityView = await loadRegionStats(c, { setId, level: "CITY", period: 12, now });
    const umdViews = [];
    for (const cityCode of cityCodes) umdViews.push(await loadRegionStats(c, { setId, level: "UMD", cityCode, period: 12, now }));
    const comp = periodWindow(24, now);
    const recentFrom = `${comp.months[12]!.slice(0, 4)}-${comp.months[12]!.slice(4)}-01`;
    return buildFacts({
      scope,
      snapshotId: cityView.snapshotId,
      cities: cityView.regions.filter((r) => cityCodes.includes(r.cityCode)),
      regions: umdViews.flatMap((v) => v.regions),
      unmapped: cityView.unmapped,
      dataStatus: { ...cityView.dataStatus, completeness: umdViews.every((v) => v.dataStatus.completeness === "COMPLETE") ? "COMPLETE" : "INCOMPLETE" },
      sameComplex: await loadSameComplex(c, setId, comp.from, recentFrom, comp.to),
      recentFrom,
      previousFrom: comp.from,
      to: comp.to,
    });
  });
}
