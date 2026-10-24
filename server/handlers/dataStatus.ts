import type pg from "pg";
import { recentMonths } from "../collect/months";
import { serviceUnavailable, type HandlerResult } from "../http";

type SourceStatus = {
  source_id: string;
  city_code: string | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_status: string | null;
  delayed: boolean;
};

// Daily transaction batches go stale after a day plus margin; reference data is refreshed yearly.
const STALE_AFTER_HOURS: Record<string, number> = { REB_COMPLEX: 400 * 24, CADASTRAL: 400 * 24 };
const DEFAULT_STALE_AFTER_HOURS = 36;

// GET /api/system/data-status: freshness of each source (FR-019, FR-023).
export async function getDataStatus(pool: pg.Pool, now: Date = new Date()): Promise<HandlerResult> {
  try {
    const { rows } = await pool.query<{
      source_id: string;
      city_code: string | null;
      last_success_at: Date | null;
      last_attempt_at: Date | null;
      last_status: string | null;
    }>(`
      SELECT source_id, city_code,
             max(completed_at) FILTER (WHERE status = 'SUCCESS') AS last_success_at,
             max(started_at) AS last_attempt_at,
             (array_agg(status ORDER BY started_at DESC))[1] AS last_status
        FROM sync_jobs
       GROUP BY source_id, city_code
       ORDER BY source_id, city_code`);
    const sources: SourceStatus[] = rows.map((r) => ({
      source_id: r.source_id,
      city_code: r.city_code,
      last_success_at: r.last_success_at?.toISOString() ?? null,
      last_attempt_at: r.last_attempt_at?.toISOString() ?? null,
      last_status: r.last_status,
      delayed:
        !r.last_success_at ||
        now.getTime() - r.last_success_at.getTime() > (STALE_AFTER_HOURS[r.source_id] ?? DEFAULT_STALE_AFTER_HOURS) * 3_600_000,
    }));
    const missing_periods = await findMissingPeriods(pool, now);
    const status =
      sources.length === 0 ? "NO_DATA" : sources.some((s) => s.delayed) ? "DELAYED" : missing_periods.length ? "PARTIAL" : "OK";
    return { status: 200, body: { status, sources, missing_periods, generated_at: now.toISOString() }, cacheSeconds: 60 };
  } catch {
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}

const TRANSACTION_SOURCES = ["MOLIT_SALE", "MOLIT_RENT"];
const CITIES = ["50110", "50130"];

// Months in the 12-month window with no successful (or partial) collection yet (PRD: 누락 기간 표시).
async function findMissingPeriods(pool: pg.Pool, now: Date) {
  const months = recentMonths(12, now);
  const { rows } = await pool.query<{ source_id: string; city_code: string; period: string }>(
    `SELECT DISTINCT source_id, city_code, period FROM sync_jobs
      WHERE source_id = ANY($1) AND status IN ('SUCCESS', 'PARTIAL') AND period = ANY($2)`,
    [TRANSACTION_SOURCES, months],
  );
  const anyTransactionJob = await pool.query("SELECT 1 FROM sync_jobs WHERE source_id = ANY($1) LIMIT 1", [TRANSACTION_SOURCES]);
  if (!anyTransactionJob.rowCount) return [];
  const have = new Set(rows.map((r) => `${r.source_id}|${r.city_code}|${r.period}`));
  const missing: { source_id: string; city_code: string; period: string }[] = [];
  for (const source_id of TRANSACTION_SOURCES)
    for (const city_code of CITIES)
      for (const period of months) if (!have.has(`${source_id}|${city_code}|${period}`)) missing.push({ source_id, city_code, period });
  return missing;
}
