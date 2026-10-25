// Phase 2 price analysis (P2-TASK-003, PRD v1.5): computed on request from Phase 1 tables, read-only.
// Every value in one response comes from one REPEATABLE READ READ ONLY snapshot, so a response can never
// mix data versions; dataVersion fingerprints the valid deal set and collection status it was computed from.
import type pg from "pg";
import { recentMonths } from "../collect/months.js";

export const PERIODS = [12, 24, 36] as const;
export type Period = (typeof PERIODS)[number];
export type AreaSel = number | "all";
export type PriceStatus = "AVAILABLE" | "INSUFFICIENT_SAMPLE" | "NO_TRADES" | "INCOMPLETE_DATA" | "UNAVAILABLE";
export type CollectionStatus = "COMPLETE" | "PARTIAL" | "MISSING";

export const MIN_SAMPLE = 3;
export const STALE_AFTER_MS = 48 * 3_600_000;
export const POINTS_LIMIT = 500;
const STATEMENT_TIMEOUT = "2s";

// The single definition of a valid deal (PRD v1.3/v1.5). apartment_id is set only for CONFIRMED matches.
const VALID = `t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.apartment_id = $1
  AND t.sale_price > 0 AND t.area_m2 > 0 AND t.contract_date >= $2 AND t.contract_date < $3`;
const AREA = `($4::int IS NULL OR floor(t.area_m2) = $4)`;

type Window = { months: string[]; from: string; to: string; currentMonth: string };

const firstDay = (ym: string) => `${ym.slice(0, 4)}-${ym.slice(4)}-01`;
const nextMonth = (ym: string) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4));
  return m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, "0")}`;
};

// N contract months including the current KST month, oldest first; [from, to) half-open dates.
export function periodWindow(period: number, now: Date): Window {
  const months = recentMonths(period, now); // oldest first
  const currentMonth = months.at(-1)!;
  return { months, from: firstDay(months[0]!), to: firstDay(nextMonth(currentMonth)), currentMonth };
}

// Runs fn inside a read-only snapshot with a statement timeout that protects the shared database.
export async function withSnapshot<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const areaParam = (area: AreaSel) => (area === "all" ? null : area);
const median = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function getApartment(c: pg.PoolClient, id: string) {
  const { rows } = await c.query<{ apartment_id: string; name: string; city_code: string }>(
    "SELECT apartment_id, name, city_code FROM apartments WHERE apartment_id = $1",
    [id],
  );
  return rows[0] ? { id: String(rows[0].apartment_id), name: rows[0].name, cityCode: rows[0].city_code } : null;
}

// Latest MOLIT_SALE job per contract month for the city: SUCCESS → COMPLETE, PARTIAL → PARTIAL, else MISSING.
async function coverage(c: pg.PoolClient, cityCode: string, months: string[]) {
  const { rows } = await c.query<{ period: string; status: string; completed_at: Date | null }>(
    `SELECT DISTINCT ON (period) period, status, completed_at FROM sync_jobs
      WHERE source_id = 'MOLIT_SALE' AND city_code = $1 AND period = ANY($2)
      ORDER BY period, started_at DESC, job_id DESC`,
    [cityCode, months],
  );
  const by = new Map(rows.map((r) => [r.period, r]));
  return new Map<string, CollectionStatus>(
    months.map((m) => {
      const s = by.get(m)?.status;
      return [m, s === "SUCCESS" ? "COMPLETE" : s === "PARTIAL" ? "PARTIAL" : "MISSING"];
    }),
  );
}

// Fingerprint of everything a response is computed from: valid deals (all area types) and collection status.
export async function dataVersion(c: pg.PoolClient, apartmentId: string, cityCode: string, from: string, to: string, months: string[]) {
  const { rows } = await c.query<{ v: string }>(
    `SELECT left(md5(
        coalesce((SELECT string_agg(t.transaction_id || ':' || t.sale_price || ':' || t.area_m2 || ':' || t.contract_date, ',' ORDER BY t.transaction_id)
                    FROM transactions t WHERE ${VALID}), '')
        || '|' ||
        coalesce((SELECT string_agg(j.period || ':' || j.status || ':' || coalesce(j.completed_at::text, ''), ',' ORDER BY j.period)
                    FROM (SELECT DISTINCT ON (period) period, status, completed_at FROM sync_jobs
                           WHERE source_id = 'MOLIT_SALE' AND city_code = $4 AND period = ANY($5)
                           ORDER BY period, started_at DESC, job_id DESC) j), '')), 16) AS v`,
    [apartmentId, from, to, cityCode, months],
  );
  return rows[0]!.v;
}

async function stats(c: pg.PoolClient, apartmentId: string, from: string, to: string, area: number) {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY t.sale_price) AS median_price,
            min(t.sale_price) AS min_price, max(t.sale_price) AS max_price,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY t.sale_price / t.area_m2) AS median_per_m2
       FROM transactions t WHERE ${VALID} AND ${AREA}`,
    [apartmentId, from, to, area],
  );
  return rows[0]!;
}

export type AnalysisInput = { apartmentId: string; area: AreaSel; period: Period; now: Date };

// Everything except points/evidence for one (apartment, area, period). Returns null for unknown apartments.
export async function loadAnalysis(c: pg.PoolClient, input: AnalysisInput) {
  const apt = await getApartment(c, input.apartmentId);
  if (!apt) return null;
  const win = periodWindow(input.period, input.now);
  // The year-over-year comparison always needs 24 months, whatever period is shown (PRD).
  const comp = periodWindow(24, input.now);
  const allMonths = win.months.length >= comp.months.length ? win.months : comp.months;
  const versionFrom = win.from < comp.from ? win.from : comp.from;
  const cov = await coverage(c, apt.cityCode, allMonths);
  const version = await dataVersion(c, apt.id, apt.cityCode, versionFrom, win.to, allMonths);
  const area = areaParam(input.area);

  const areas = (
    await c.query<{ area_type: number; n: number }>(
      `SELECT floor(t.area_m2)::int AS area_type, count(*)::int AS n FROM transactions t WHERE ${VALID}
        GROUP BY 1 ORDER BY 2 DESC, 1`,
      [apt.id, win.from, win.to],
    )
  ).rows.map((r) => ({ areaTypeM2: r.area_type, tradeCount: r.n }));

  const monthCounts = new Map(
    (
      await c.query<{ ym: string; n: number }>(
        `SELECT to_char(t.contract_date, 'YYYYMM') AS ym, count(*)::int AS n FROM transactions t WHERE ${VALID} AND ${AREA} GROUP BY 1`,
        [apt.id, win.from, win.to, area],
      )
    ).rows.map((r) => [r.ym, r.n]),
  );
  // A month whose collection is missing reports null, never 0 (AC-007).
  const monthly = win.months.map((m) => {
    const status = cov.get(m)!;
    return { contractMonth: m, tradeCount: status === "MISSING" ? null : monthCounts.get(m) ?? 0, collectionStatus: status, isCurrentMonth: m === win.currentMonth };
  });
  const missingMonths = win.months.filter((m) => cov.get(m) === "MISSING");
  const partialMonths = win.months.filter((m) => cov.get(m) === "PARTIAL");
  const windowComplete = missingMonths.length === 0 && partialMonths.length === 0;

  let quarterly: { quarter: string; tradeCount: number; medianPriceWon: number | null; priceStatus: PriceStatus; complete: boolean }[] = [];
  let summary;
  let comparison;
  if (area === null) {
    // "all" mixes area types: trade counts only (PRD).
    summary = { tradeCount: monthly.reduce((s, m) => s + (m.tradeCount ?? 0), 0), medianPriceWon: null, minPriceWon: null, maxPriceWon: null, medianPricePerM2Won: null, priceStatus: "UNAVAILABLE" as PriceStatus };
    comparison = { status: "UNAVAILABLE" as PriceStatus, changePct: null, recentMedianWon: null, previousMedianWon: null };
  } else {
    const q = await c.query<{ quarter: string; n: number; median_price: number | null }>(
      `SELECT to_char(t.contract_date, 'YYYY"Q"Q') AS quarter, count(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY t.sale_price) AS median_price
         FROM transactions t WHERE ${VALID} AND ${AREA} GROUP BY 1`,
      [apt.id, win.from, win.to, area],
    );
    const qByKey = new Map(q.rows.map((r) => [r.quarter, r]));
    const quarterOf = (ym: string) => `${ym.slice(0, 4)}Q${Math.ceil(Number(ym.slice(4)) / 3)}`;
    const quarterKeys = [...new Set(win.months.map(quarterOf))];
    quarterly = quarterKeys.map((key) => {
      const r = qByKey.get(key);
      const n = r?.n ?? 0;
      const complete = win.months.filter((m) => quarterOf(m) === key).every((m) => cov.get(m) === "COMPLETE");
      const priceStatus: PriceStatus = !complete ? "INCOMPLETE_DATA" : n === 0 ? "NO_TRADES" : n < MIN_SAMPLE ? "INSUFFICIENT_SAMPLE" : "AVAILABLE";
      return { quarter: key, tradeCount: n, medianPriceWon: priceStatus === "AVAILABLE" ? median(r!.median_price) : null, priceStatus, complete };
    });

    const s = await stats(c, apt.id, win.from, win.to, area);
    const n: number = s.n;
    const priceStatus: PriceStatus = !windowComplete ? "INCOMPLETE_DATA" : n === 0 ? "NO_TRADES" : n < MIN_SAMPLE ? "INSUFFICIENT_SAMPLE" : "AVAILABLE";
    summary = {
      tradeCount: n,
      medianPriceWon: priceStatus === "AVAILABLE" ? median(s.median_price) : null,
      // Min/max are shown with the sample size and status even below 3 deals (MET-002/003).
      minPriceWon: n > 0 && windowComplete ? Number(s.min_price) : null,
      maxPriceWon: n > 0 && windowComplete ? Number(s.max_price) : null,
      medianPricePerM2Won: priceStatus === "AVAILABLE" ? median(s.median_per_m2) : null,
      priceStatus,
    };

    const recent = comp.months.slice(12);
    const previous = comp.months.slice(0, 12);
    const [r12, p12] = await Promise.all([
      stats(c, apt.id, firstDay(recent[0]!), comp.to, area),
      stats(c, apt.id, comp.from, firstDay(recent[0]!), area),
    ]);
    const compComplete = comp.months.every((m) => cov.get(m) === "COMPLETE");
    const status: PriceStatus = !compComplete ? "INCOMPLETE_DATA" : r12.n < MIN_SAMPLE || p12.n < MIN_SAMPLE ? "INSUFFICIENT_SAMPLE" : "AVAILABLE";
    const rm = median(r12.median_price);
    const pm = median(p12.median_price);
    comparison = {
      status,
      changePct: status === "AVAILABLE" && pm ? Math.round(((rm! - pm) / pm) * 1000) / 10 : null,
      recentMedianWon: status === "AVAILABLE" ? rm : null,
      previousMedianWon: status === "AVAILABLE" ? pm : null,
      recentTradeCount: r12.n,
      previousTradeCount: p12.n,
      months: { recent: [recent[0], recent.at(-1)], previous: [previous[0], previous.at(-1)] },
    };
  }

  const fresh = await c.query<{ at: Date | null }>(
    "SELECT max(completed_at) AS at FROM sync_jobs WHERE source_id = 'MOLIT_SALE' AND city_code = $1 AND status IN ('SUCCESS','PARTIAL')",
    [apt.cityCode],
  );
  const lastAt = fresh.rows[0]?.at ?? null;
  return {
    apartment: apt,
    periodMonths: input.period,
    areaTypeM2: input.area,
    areas,
    summary,
    comparison,
    quarterly,
    monthly,
    dataStatus: {
      completeness: windowComplete ? "COMPLETE" : "INCOMPLETE",
      freshness: !lastAt || input.now.getTime() - lastAt.getTime() > STALE_AFTER_MS ? "STALE" : "FRESH",
      aggregation: "READY",
      lastSuccessfulSyncAt: lastAt?.toISOString() ?? null,
      missingMonths,
      partialMonths,
      provisionalCurrentMonth: true,
      dataVersion: version,
    },
  };
}

// Default area type: most valid deals in the period, smaller type on ties (API_SPEC).
export const defaultArea = (areas: { areaTypeM2: number; tradeCount: number }[]) => areas[0]?.areaTypeM2 ?? null;

const DEAL_COLUMNS = `t.transaction_id, to_char(t.contract_date, 'YYYY-MM-DD') AS contract_date, t.sale_price, t.area_m2, t.floor`;
const toDeal = (r: Record<string, any>) => ({
  transactionId: String(r.transaction_id),
  contractDate: r.contract_date as string,
  priceWon: Number(r.sale_price),
  areaM2: Number(r.area_m2),
  floor: r.floor as number | null,
  sameConditionCount: Number(r.same_condition_count),
});

// Graph points: every valid deal of one area type (a point = one evidence deal), capped at POINTS_LIMIT.
export async function loadPoints(c: pg.PoolClient, apartmentId: string, area: number, period: Period, now: Date) {
  const win = periodWindow(period, now);
  const { rows } = await c.query(
    `SELECT ${DEAL_COLUMNS},
            count(*) OVER (PARTITION BY t.contract_date, t.area_m2, t.floor, t.sale_price) AS same_condition_count
       FROM transactions t WHERE ${VALID} AND ${AREA}
      ORDER BY t.contract_date DESC, t.transaction_id DESC LIMIT ${POINTS_LIMIT + 1}`,
    [apartmentId, win.from, win.to, area],
  );
  return { points: rows.slice(0, POINTS_LIMIT).map(toDeal), truncated: rows.length > POINTS_LIMIT };
}

export type EvidenceKey = { contractDate: string; transactionId: string };

// Evidence deals, newest first, keyset-paginated on (contract_date, transaction_id).
export async function loadEvidencePage(
  c: pg.PoolClient,
  q: { apartmentId: string; area: AreaSel; period: Period; now: Date; pageSize: number; after?: EvidenceKey },
) {
  const win = periodWindow(q.period, q.now);
  const params: unknown[] = [q.apartmentId, win.from, win.to, areaParam(q.area), q.pageSize + 1];
  let keyset = "";
  if (q.after) {
    params.push(q.after.contractDate, q.after.transactionId);
    keyset = "WHERE (x.cdate, x.transaction_id) < ($6::date, $7::bigint)";
  }
  // Same-condition counts are taken over the whole valid set before the cursor filter,
  // so a group split across pages still reports its full size.
  const { rows } = await c.query(
    `SELECT x.* FROM (
       SELECT t.contract_date AS cdate, ${DEAL_COLUMNS},
              count(*) OVER (PARTITION BY t.contract_date, t.area_m2, t.floor, t.sale_price) AS same_condition_count
         FROM transactions t WHERE ${VALID} AND ${AREA}) x
     ${keyset}
     ORDER BY x.cdate DESC, x.transaction_id DESC LIMIT $5`,
    params,
  );
  const items = rows.slice(0, q.pageSize).map(toDeal);
  const last = items.at(-1);
  return { items, next: rows.length > q.pageSize && last ? { contractDate: last.contractDate, transactionId: last.transactionId } : null };
}
