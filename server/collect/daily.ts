import type pg from "pg";
import type { Budget } from "./budget.js";
import { collect, type CollectOptions, type JobResult } from "./collector.js";
import type { Fetcher, SourceId } from "./molit.js";

// Failures that may pass by themselves (connection, 5xx, truncated or unreadable responses, DB hiccups).
// Result codes, gateway (key/quota) errors and other 4xx would fail the same way again.
export function isTransient(errorCode: string | undefined): boolean {
  return errorCode === "NETWORK" || errorCode === "COUNT_MISMATCH" || errorCode === "BAD_RESPONSE" || errorCode === "INTERNAL" || /^HTTP_5/.test(errorCode ?? "");
}

export type DailyOptions = {
  months: string[];
  serviceKey: string;
  budget: Budget;
  fetcher?: Fetcher;
  retryDelaysMs?: number[];
  // Wait before the second attempt so a short outage can pass.
  pauseMs?: number;
};

// One daily run: every (source, city, month) once, then each transient failure once more at the end, so a
// single bad night does not leave a month's latest job FAILED. Both attempts share the run's call budget.
export async function collectDaily(pool: pg.Pool, o: DailyOptions): Promise<{ jobs: JobResult[]; retried: JobResult[]; stoppedBy?: string }> {
  const base: Omit<CollectOptions, "months"> = { serviceKey: o.serviceKey, budget: o.budget, fetcher: o.fetcher, retryDelaysMs: o.retryDelaysMs };
  const first = await collect(pool, { ...base, months: o.months });
  if (first.stoppedBy) return { jobs: first.jobs, retried: [], stoppedBy: first.stoppedBy };
  const failed = first.jobs.filter((j) => j.status === "FAILED" && isTransient(j.errorCode));
  if (!failed.length) return { jobs: first.jobs, retried: [] };
  await new Promise((r) => setTimeout(r, o.pauseMs ?? 10_000));
  const retried: JobResult[] = [];
  for (const j of failed) {
    const again = await collect(pool, { ...base, months: [j.period], sources: [j.source as SourceId], cities: [j.city] });
    retried.push(...again.jobs);
    if (again.stoppedBy) return { jobs: first.jobs, retried, stoppedBy: again.stoppedBy };
  }
  return { jobs: first.jobs, retried };
}
