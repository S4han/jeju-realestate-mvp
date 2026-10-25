// Phase 2 (P2-TASK-001 D1): one-off backfill of past MOLIT *sale* months, run from the user's PC.
// Reuses the Phase 1 collector unchanged (same normalization, reconcile, sync_jobs, budget); rent is not fetched.
// Usage:
//   node --import tsx scripts/phase2/backfill-sales.ts --from 202311 --to 202510 --max-calls 60 --dry-run
//   node --import tsx scripts/phase2/backfill-sales.ts --from 202311 --to 202510 --max-calls 60
// Afterwards run matching (scripts/match-transactions.ts); transactions stay unmatched until then.
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const MAX_MONTHS = 36;

// Inclusive YYYYMM range, oldest first.
export function monthRange(from: string, to: string): string[] {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(from) || !/^\d{4}(0[1-9]|1[0-2])$/.test(to)) throw new Error("months must be YYYYMM");
  if (from > to) throw new Error("--from must not be after --to");
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(4));
  for (;;) {
    const ym = `${y}${String(m).padStart(2, "0")}`;
    out.push(ym);
    if (ym === to) return out;
    if (out.length >= MAX_MONTHS) throw new Error(`range exceeds ${MAX_MONTHS} months`);
    if (++m === 13) {
      m = 1;
      y++;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { from: { type: "string" }, to: { type: "string" }, "max-calls": { type: "string" }, "dry-run": { type: "boolean" } },
  });
  const maxCalls = Number(values["max-calls"]);
  if (!values.from || !values.to || !Number.isInteger(maxCalls) || maxCalls <= 0) {
    console.error("usage: --from YYYYMM --to YYYYMM --max-calls N [--dry-run]");
    process.exit(2);
  }
  const months = monthRange(values.from, values.to);
  const cities = 2;
  console.log(`MOLIT_SALE only | months ${months[0]}..${months.at(-1)} (${months.length}) | expected calls ~${months.length * cities} | max calls ${maxCalls}`);
  if (months.length * cities > maxCalls) console.warn("warning: max calls is below the expected count; the run will stop early (resume later with --from).");
  if (values["dry-run"]) {
    console.log("dry run: no API call, no database access");
    process.exit(0);
  }

  const { loadCollectorConfig } = await import("../../server/config.js");
  const { getPool } = await import("../../server/db.js");
  const { createBudget } = await import("../../server/collect/budget.js");
  const { collect } = await import("../../server/collect/collector.js");
  const config = loadCollectorConfig();
  const pool = getPool();
  try {
    const budget = createBudget(pool, { dailyLimit: config.API_DAILY_CALL_LIMIT, runLimit: maxCalls });
    const { jobs, stoppedBy } = await collect(pool, { months, serviceKey: config.DATA_GO_KR_SERVICE_KEY, budget, sources: ["MOLIT_SALE"], log: console.log });
    const by = (s: string) => jobs.filter((j) => j.status === s).length;
    console.log(`calls ${budget.callsThisRun()} | jobs SUCCESS ${by("SUCCESS")} PARTIAL ${by("PARTIAL")} FAILED ${by("FAILED")}${stoppedBy ? ` | stopped: ${stoppedBy}` : ""}`);
    for (const w of budget.warnings) console.warn(`warning: ${w}`);
    if (by("FAILED") || stoppedBy) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
