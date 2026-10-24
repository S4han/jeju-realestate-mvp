import type pg from "pg";
import { serviceUnavailable, type HandlerResult } from "../http";

type SourceStatus = {
  source_id: string;
  city_code: string | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_status: string | null;
  delayed: boolean;
};

const STALE_AFTER_HOURS = 36; // daily batch + margin

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
      delayed: !r.last_success_at || now.getTime() - r.last_success_at.getTime() > STALE_AFTER_HOURS * 3_600_000,
    }));
    const status = sources.length === 0 ? "NO_DATA" : sources.some((s) => s.delayed) ? "DELAYED" : "OK";
    return { status: 200, body: { status, sources, generated_at: now.toISOString() }, cacheSeconds: 60 };
  } catch {
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}
