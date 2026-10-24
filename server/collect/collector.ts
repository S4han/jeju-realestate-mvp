import type pg from "pg";
import { redact } from "../config.js";
import { BudgetExceededError, type Budget } from "./budget.js";
import { fetchMonth, SourceError, type Fetcher, type SourceId } from "./molit.js";
import { normalizeItem, type NormalizedTx } from "./normalize.js";
import { applyMonth, type ApplySummary } from "./store.js";

export const CITY_CODES = ["50110", "50130"] as const;

export type CollectOptions = {
  months: string[];
  sources?: SourceId[];
  cities?: readonly string[];
  serviceKey: string;
  budget: Budget;
  fetcher?: Fetcher;
  retryDelaysMs?: number[];
  log?: (msg: string) => void;
};

export type JobResult = {
  source: SourceId;
  city: string;
  period: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  calls: number;
  received: number;
  rejected: Record<string, number>;
  applied?: ApplySummary;
  errorCode?: string;
};

// Collects each (source, city, month). A month is applied only when every page arrived; otherwise
// the previous data for that month is left untouched and the job is recorded as FAILED.
export async function collect(pool: pg.Pool, o: CollectOptions): Promise<{ jobs: JobResult[]; stoppedBy?: string }> {
  const log = o.log ?? (() => {});
  const jobs: JobResult[] = [];
  for (const source of o.sources ?? (["MOLIT_SALE", "MOLIT_RENT"] as SourceId[])) {
    for (const city of o.cities ?? CITY_CODES) {
      for (const period of o.months) {
        const { rows } = await pool.query<{ job_id: string }>(
          "INSERT INTO sync_jobs (source_id, city_code, period, status) VALUES ($1,$2,$3,'RUNNING') RETURNING job_id",
          [source, city, period],
        );
        const jobId = rows[0]!.job_id;
        const callsBefore = o.budget.callsThisRun();
        const result: JobResult = { source, city, period, status: "FAILED", calls: 0, received: 0, rejected: {} };
        try {
          const fetched = await fetchMonth({
            source, lawdCd: city, dealYmd: period, serviceKey: o.serviceKey, fetcher: o.fetcher,
            retryDelaysMs: o.retryDelaysMs, beforeCall: () => o.budget.reserve(source),
          });
          result.received = fetched.items.length;
          const txs: NormalizedTx[] = [];
          for (const item of fetched.items) {
            const n = normalizeItem(source, item, { sggCode: city, dealYmd: period });
            if (n.ok) txs.push(n.tx);
            else result.rejected[n.reason] = (result.rejected[n.reason] ?? 0) + 1;
          }
          const hasRejects = Object.keys(result.rejected).length > 0;
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            // Rows we could not read must not make stored rows look deleted.
            result.applied = await applyMonth(client, source === "MOLIT_SALE" ? "sale" : "rent", city, period, txs, !hasRejects);
            result.status = hasRejects ? "PARTIAL" : "SUCCESS";
            result.calls = o.budget.callsThisRun() - callsBefore;
            await client.query(
              `UPDATE sync_jobs SET status=$1, record_count=$2, api_calls=$3, completed_at=now(), error_code=$4, error_message=$5 WHERE job_id=$6`,
              [result.status, txs.length, result.calls, hasRejects ? "ROWS_REJECTED" : null, hasRejects ? JSON.stringify(result.rejected) : null, jobId],
            );
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          } finally {
            client.release();
          }
        } catch (err) {
          result.calls = o.budget.callsThisRun() - callsBefore;
          result.errorCode = err instanceof BudgetExceededError ? `BUDGET_${err.scope}` : err instanceof SourceError ? err.code : "INTERNAL";
          await pool.query(
            "UPDATE sync_jobs SET status='FAILED', api_calls=$1, completed_at=now(), error_code=$2, error_message=$3 WHERE job_id=$4",
            [result.calls, result.errorCode, redact((err as Error).message).slice(0, 500), jobId],
          );
          jobs.push(result);
          log(`${source} ${city} ${period}: FAILED ${result.errorCode}`);
          if (err instanceof BudgetExceededError) return { jobs, stoppedBy: result.errorCode };
          continue;
        }
        jobs.push(result);
        log(`${source} ${city} ${period}: ${result.status} calls=${result.calls} rows=${result.received} ${JSON.stringify(result.applied)}`);
      }
    }
  }
  return { jobs };
}
