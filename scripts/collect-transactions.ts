// Collects MOLIT sale/rent transactions into the database (TASK-004).
// Usage:
//   npm run collect -- --mode initial --max-calls 60      # current month + previous 11 (KST)
//   npm run collect -- --mode incremental --max-calls 20  # current month + previous 3
//   npm run collect -- --months 202608,202609 --max-calls 10
// --max-calls is required: it caps external calls for this run (approved budget).
import { parseArgs } from "node:util";
import { loadCollectorConfig } from "../server/config";
import { getPool } from "../server/db";
import { createBudget } from "../server/collect/budget";
import { collect } from "../server/collect/collector";
import { recentMonths } from "../server/collect/months";

const { values } = parseArgs({
  options: { mode: { type: "string" }, months: { type: "string" }, "max-calls": { type: "string" } },
});
const maxCalls = Number(values["max-calls"]);
const months = values.months
  ? values.months.split(",").map((m) => m.trim())
  : values.mode === "initial" ? recentMonths(12) : values.mode === "incremental" ? recentMonths(4) : [];
if (!Number.isInteger(maxCalls) || maxCalls <= 0 || !months.length || months.some((m) => !/^\d{6}$/.test(m))) {
  console.error("usage: --mode initial|incremental | --months YYYYMM,... and --max-calls N");
  process.exit(2);
}

const config = loadCollectorConfig();
const pool = getPool();
try {
  const budget = createBudget(pool, { dailyLimit: config.API_DAILY_CALL_LIMIT, runLimit: maxCalls });
  console.log(`months ${months[0]}..${months.at(-1)} (${months.length}), max calls ${maxCalls}`);
  const { jobs, stoppedBy } = await collect(pool, { months, serviceKey: config.DATA_GO_KR_SERVICE_KEY, budget, log: console.log });
  const by = (s: string) => jobs.filter((j) => j.status === s).length;
  console.log(`calls ${budget.callsThisRun()} | jobs SUCCESS ${by("SUCCESS")} PARTIAL ${by("PARTIAL")} FAILED ${by("FAILED")}${stoppedBy ? ` | stopped: ${stoppedBy}` : ""}`);
  for (const w of budget.warnings) console.warn(`warning: ${w}`);
  if (by("FAILED")) process.exitCode = 1;
} finally {
  await pool.end();
}
