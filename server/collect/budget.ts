import type pg from "pg";
import { todayKst } from "./months.js";

export class BudgetExceededError extends Error {
  constructor(public readonly scope: "DAILY" | "RUN", sourceId: string) {
    super(`${scope.toLowerCase()} call budget exhausted for ${sourceId}`);
  }
}

export type Budget = {
  reserve(sourceId: string): Promise<void>;
  callsThisRun(): number;
  warnings: string[];
};

// Reserves one external call before it is made (FR-020). The daily counter lives in api_usage so
// concurrent runs share it; the run limit caps a single batch to what the user approved.
export function createBudget(pool: pg.Pool, opts: { dailyLimit: number; runLimit: number; now?: () => Date }): Budget {
  let runCalls = 0;
  const warnings: string[] = [];
  const warned = new Set<string>();
  return {
    warnings,
    callsThisRun: () => runCalls,
    async reserve(sourceId) {
      if (runCalls >= opts.runLimit) throw new BudgetExceededError("RUN", sourceId);
      const day = todayKst(opts.now?.() ?? new Date());
      const { rows } = await pool.query<{ calls: number }>(
        `INSERT INTO api_usage (usage_date, source_id, calls) VALUES ($1, $2, 1)
         ON CONFLICT (usage_date, source_id) DO UPDATE SET calls = api_usage.calls + 1
           WHERE api_usage.calls < $3
         RETURNING calls`,
        [day, sourceId, opts.dailyLimit],
      );
      if (!rows[0]) throw new BudgetExceededError("DAILY", sourceId);
      runCalls++;
      if (rows[0].calls >= opts.dailyLimit * 0.8 && !warned.has(sourceId)) {
        warned.add(sourceId);
        warnings.push(`${sourceId}: ${rows[0].calls}/${opts.dailyLimit} daily calls used (80% warning)`);
      }
    },
  };
}
