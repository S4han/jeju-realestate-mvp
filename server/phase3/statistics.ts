// Region statistics (P3-TASK-004, REGION_ANALYSIS.md 3·4절). Computed on request from Phase 1 tables inside
// one read-only snapshot (P3-D1 B):
//   * trade count  = valid MAPPED sales per region, counted per contract month and summed over the period
//   * price        = median of each deal's sale_price / area_m2 (exact numeric, original area) over the period's
//                    raw deals — never an average or median of monthly medians; shown only with >= 3 deals
//   * change       = median of the last 12 contract months vs the 12 before, each >= 3 deals, both complete
//   * city         = computed from the city's own mapped deals (not from its regions' medians);
//                    deals that cannot be placed in a region are reported per city as isolated counts
import type pg from "pg";
import { MIN_SAMPLE, STALE_AFTER_MS, periodWindow, type Period } from "../phase2/analysis.js";
import { REGION_DEALS_SQL } from "./mapping.js";

export type CountStatus = "COMPLETE" | "INCOMPLETE";
export type PriceStatus = "AVAILABLE" | "INSUFFICIENT_SAMPLE" | "NO_TRADES" | "NO_APARTMENTS" | "INCOMPLETE_DATA";
export type ChangeStatus = "AVAILABLE" | "INSUFFICIENT_SAMPLE" | "INCOMPLETE_DATA" | "NO_APARTMENTS";
export type CollectionStatus = "COMPLETE" | "PARTIAL" | "MISSING";

export type RegionStat = {
  regionCode: string;
  name: string;
  level: "CITY" | "UMD";
  cityCode: string;
  hasApartments: boolean;
  tradeCount: number;
  countStatus: CountStatus;
  medianPricePerM2Won: number | null;
  priceStatus: PriceStatus;
  change: { pct: number | null; status: ChangeStatus; recentMedianWon: number | null; previousMedianWon: number | null; recentCount: number; previousCount: number };
};

export type CityReconciliation = { mapped: number; unmatched: number; codeConflict: number; codeNotInSet: number; total: number };

export type DataStatus = {
  completeness: CountStatus;
  freshness: "FRESH" | "STALE";
  lastSuccessfulSyncAt: string | null;
  missingMonths: string[];
  partialMonths: string[];
  provisionalCurrentMonth: true;
  currentMonth: string;
};

export type RegionStatsInput = { setId: string; level: "CITY" | "UMD"; cityCode?: string; period: Period; now: Date };

const firstDay = (m: string) => `${m.slice(0, 4)}-${m.slice(4)}-01`;
const won = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

/** Latest MOLIT_SALE job per city and contract month (same rule as Phase 2): SUCCESS / PARTIAL / anything else. */
export async function collectionStatus(c: pg.PoolClient, months: string[]): Promise<Map<string, CollectionStatus>> {
  const { rows } = await c.query<{ city_code: string; period: string; status: string }>(
    `SELECT DISTINCT ON (city_code, period) city_code, period, status FROM sync_jobs
      WHERE source_id = 'MOLIT_SALE' AND period = ANY($1)
      ORDER BY city_code, period, started_at DESC, job_id DESC`,
    [months],
  );
  const by = new Map(rows.map((r) => [`${r.city_code}:${r.period}`, r.status]));
  const out = new Map<string, CollectionStatus>();
  for (const city of ["50110", "50130"]) {
    for (const m of months) {
      const s = by.get(`${city}:${m}`);
      out.set(`${city}:${m}`, s === "SUCCESS" ? "COMPLETE" : s === "PARTIAL" ? "PARTIAL" : "MISSING");
    }
  }
  return out;
}

async function freshness(c: pg.PoolClient, cityCodes: string[], now: Date) {
  const { rows } = await c.query<{ at: Date | null }>(
    "SELECT min(last) AS at FROM (SELECT max(completed_at) AS last FROM sync_jobs WHERE source_id = 'MOLIT_SALE' AND city_code = ANY($1) AND status IN ('SUCCESS','PARTIAL') GROUP BY city_code) x",
    [cityCodes],
  );
  const at = rows[0]?.at ?? null;
  return { lastSuccessfulSyncAt: at?.toISOString() ?? null, freshness: !at || now.getTime() - at.getTime() > STALE_AFTER_MS ? ("STALE" as const) : ("FRESH" as const) };
}

/**
 * Fingerprint of everything one response is computed from: region set, every valid sale in the comparison
 * window with its mapping status, and the collection status of those months. Any change → new id.
 */
export async function snapshotId(c: pg.PoolClient, setId: string, from: string, to: string, months: string[]): Promise<string> {
  const { rows } = await c.query<{ v: string }>(
    `SELECT left(md5($1::text || '|' ||
        coalesce((SELECT string_agg(d.transaction_id || ':' || d.sale_price || ':' || d.area_m2 || ':' || d.contract_date || ':' || d.mapping_status || ':' || coalesce(d.region_code, d.deal_city), ',' ORDER BY d.transaction_id)
                    FROM (${REGION_DEALS_SQL}) d), '') || '|' ||
        coalesce((SELECT string_agg(j.city_code || j.period || ':' || j.status || ':' || coalesce(j.completed_at::text, ''), ',' ORDER BY j.city_code, j.period)
                    FROM (SELECT DISTINCT ON (city_code, period) city_code, period, status, completed_at FROM sync_jobs
                           WHERE source_id = 'MOLIT_SALE' AND period = ANY($4) ORDER BY city_code, period, started_at DESC, job_id DESC) j), '')), 16) AS v`,
    [setId, from, to, months],
  );
  return `${setId}-${rows[0]!.v}`;
}

/**
 * Statistics for every region of one map view: the two cities (level CITY) or the eup/myeon/dong of one city
 * (level UMD). Run inside withSnapshot so all numbers come from one consistent view.
 */
export async function loadRegionStats(c: pg.PoolClient, input: RegionStatsInput) {
  const win = periodWindow(input.period, input.now);
  const comp = periodWindow(24, input.now); // year-over-year always needs 24 months
  const span = input.period >= 24 ? win : comp; // widest window this response reads
  const recentFrom = firstDay(comp.months[12]!);
  const cityCodes = input.level === "UMD" ? [input.cityCode!] : ["50110", "50130"];

  const regions = (await c.query<{ region_code: string; name: string; level: "CITY" | "UMD"; city_code: string; has_apartments: boolean }>(
    `SELECT r.region_code, r.name, r.level, r.city_code,
            EXISTS (SELECT 1 FROM apartments a WHERE CASE WHEN r.level = 'CITY' THEN a.city_code = r.city_code
                                                         ELSE left(a.legal_dong_code, 8) = left(r.region_code, 8) END) AS has_apartments
       FROM p3_regions r WHERE r.set_id = $1 AND r.level = $2 AND r.city_code = ANY($3) ORDER BY r.region_code`,
    [input.setId, input.level, cityCodes],
  )).rows;

  // One pass over the mapped deals of the widest window: per region, the monthly counts and the three medians.
  const key = input.level === "CITY" ? "left(d.region_code, 5) || '00000'" : "d.region_code";
  const stats = (await c.query<{ region: string; month: string; n: number }>(
    `SELECT ${key} AS region, to_char(d.contract_date, 'YYYYMM') AS month, count(*)::int AS n
       FROM (${REGION_DEALS_SQL}) d WHERE d.mapping_status = 'MAPPED' GROUP BY 1, 2`,
    [input.setId, span.from, span.to],
  )).rows;
  const medians = new Map((await c.query<{ region: string; period_median: string | null; recent_median: string | null; previous_median: string | null; recent_n: number; previous_n: number }>(
    `SELECT ${key} AS region,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY d.sale_price / d.area_m2) FILTER (WHERE d.contract_date >= $4) AS period_median,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY d.sale_price / d.area_m2) FILTER (WHERE d.contract_date >= $5) AS recent_median,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY d.sale_price / d.area_m2) FILTER (WHERE d.contract_date >= $6 AND d.contract_date < $5) AS previous_median,
            count(*) FILTER (WHERE d.contract_date >= $5)::int AS recent_n,
            count(*) FILTER (WHERE d.contract_date >= $6 AND d.contract_date < $5)::int AS previous_n
       FROM (${REGION_DEALS_SQL}) d WHERE d.mapping_status = 'MAPPED' GROUP BY 1`,
    [input.setId, span.from, span.to, win.from, recentFrom, comp.from],
  )).rows.map((r) => [r.region, r]));

  const cov = await collectionStatus(c, span.months);
  const incompleteIn = (city: string, months: string[]) => months.some((m) => cov.get(`${city}:${m}`) !== "COMPLETE");
  const countsBy = new Map<string, number>();
  for (const s of stats) if (win.months.includes(s.month)) countsBy.set(s.region, (countsBy.get(s.region) ?? 0) + s.n);

  const out: RegionStat[] = regions.map((r) => {
    const tradeCount = countsBy.get(r.region_code) ?? 0;
    const m = medians.get(r.region_code);
    const periodIncomplete = incompleteIn(r.city_code, win.months);
    const compIncomplete = incompleteIn(r.city_code, comp.months);
    const priceStatus: PriceStatus = !r.has_apartments ? "NO_APARTMENTS"
      : periodIncomplete ? "INCOMPLETE_DATA"
      : tradeCount === 0 ? "NO_TRADES"
      : tradeCount < MIN_SAMPLE ? "INSUFFICIENT_SAMPLE" : "AVAILABLE";
    const recentN = m?.recent_n ?? 0;
    const previousN = m?.previous_n ?? 0;
    const changeStatus: ChangeStatus = !r.has_apartments ? "NO_APARTMENTS"
      : compIncomplete ? "INCOMPLETE_DATA"
      : recentN < MIN_SAMPLE || previousN < MIN_SAMPLE ? "INSUFFICIENT_SAMPLE" : "AVAILABLE";
    const rm = changeStatus === "AVAILABLE" ? Number(m!.recent_median) : null;
    const pm = changeStatus === "AVAILABLE" ? Number(m!.previous_median) : null;
    return {
      regionCode: r.region_code,
      name: r.name,
      level: r.level,
      cityCode: r.city_code,
      hasApartments: r.has_apartments,
      tradeCount,
      countStatus: periodIncomplete ? "INCOMPLETE" : "COMPLETE",
      medianPricePerM2Won: priceStatus === "AVAILABLE" ? won(m?.period_median) : null,
      priceStatus,
      change: {
        // Rounded to 0.1%p only for display; computed from the unrounded medians.
        pct: rm !== null && pm ? Math.round(((rm - pm) / pm) * 1000) / 10 : null,
        status: changeStatus,
        recentMedianWon: won(rm),
        previousMedianWon: won(pm),
        recentCount: recentN,
        previousCount: previousN,
      },
    };
  });

  // Deals of each city that are not in any region (city = regions + these), for the selected period.
  const recon = new Map<string, CityReconciliation>();
  for (const city of cityCodes) recon.set(city, { mapped: 0, unmatched: 0, codeConflict: 0, codeNotInSet: 0, total: 0 });
  for (const r of (await c.query<{ deal_city: string; mapping_status: string; n: number }>(
    `SELECT d.deal_city, d.mapping_status, count(*)::int AS n FROM (${REGION_DEALS_SQL}) d WHERE d.deal_city = ANY($4) GROUP BY 1, 2`,
    [input.setId, win.from, win.to, cityCodes],
  )).rows) {
    const x = recon.get(r.deal_city)!;
    const field = ({ MAPPED: "mapped", UNMATCHED: "unmatched", CODE_CONFLICT: "codeConflict", CODE_NOT_IN_SET: "codeNotInSet" } as const)[r.mapping_status as "MAPPED"];
    x[field] += r.n;
    x.total += r.n;
  }

  const fresh = await freshness(c, cityCodes, input.now);
  const missingMonths = win.months.filter((m) => cityCodes.some((city) => cov.get(`${city}:${m}`) === "MISSING"));
  const partialMonths = win.months.filter((m) => cityCodes.some((city) => cov.get(`${city}:${m}`) === "PARTIAL"));
  const dataStatus: DataStatus = {
    completeness: missingMonths.length || partialMonths.length ? "INCOMPLETE" : "COMPLETE",
    ...fresh,
    missingMonths,
    partialMonths,
    provisionalCurrentMonth: true,
    currentMonth: win.currentMonth,
  };
  return {
    snapshotId: await snapshotId(c, input.setId, span.from, span.to, span.months),
    periodMonths: input.period,
    contractPeriod: { startInclusive: win.from, endExclusive: win.to },
    regions: out,
    unmapped: Object.fromEntries(recon),
    dataStatus,
  };
}

/** Monthly trade counts of one region (or city) over the period; missing collection months are null, not 0. */
export async function loadRegionMonthly(c: pg.PoolClient, input: { setId: string; regionCode: string; period: Period; now: Date }) {
  const win = periodWindow(input.period, input.now);
  const city = input.regionCode.slice(0, 5);
  const isCity = input.regionCode.slice(5) === "00000";
  const { rows } = await c.query<{ month: string; n: number }>(
    `SELECT to_char(d.contract_date, 'YYYYMM') AS month, count(*)::int AS n FROM (${REGION_DEALS_SQL}) d
      WHERE d.mapping_status = 'MAPPED' AND ${isCity ? "left(d.region_code, 5) = $4" : "d.region_code = $4"} GROUP BY 1`,
    [input.setId, win.from, win.to, isCity ? city : input.regionCode],
  );
  const counts = new Map(rows.map((r) => [r.month, r.n]));
  const cov = await collectionStatus(c, win.months);
  return win.months.map((m) => {
    const status = cov.get(`${city}:${m}`)!;
    return { contractMonth: m, tradeCount: status === "MISSING" ? null : counts.get(m) ?? 0, collectionStatus: status, isCurrentMonth: m === win.currentMonth };
  });
}
