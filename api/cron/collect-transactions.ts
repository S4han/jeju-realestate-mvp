// Daily incremental collection, triggered by Vercel Cron (Hobby: once per day).
// Vercel sends "Authorization: Bearer $CRON_SECRET"; anything else is rejected.
import type pg from "pg";
import { ConfigError, loadCollectorConfig, type CollectorConfig } from "../../server/config.js";
import { getPool } from "../../server/db.js";
import { createBudget } from "../../server/collect/budget.js";
import { collectDaily } from "../../server/collect/daily.js";
import { recentMonths } from "../../server/collect/months.js";
import { runMatching } from "../../server/match/run.js";
import { sendJson, serviceUnavailable, type ApiRequest, type ApiResponse } from "../../server/http.js";

const MAX_CALLS_PER_RUN = 30;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    sendJson(res, { status: 401, body: { error: { code: "UNAUTHORIZED" } } });
    return;
  }
  let config: CollectorConfig;
  let pool: pg.Pool;
  try {
    config = loadCollectorConfig();
    pool = getPool();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // Variable names only; no external call is made with a broken configuration.
    console.error(err.message);
    sendJson(res, serviceUnavailable("COLLECTOR_MISCONFIGURED"));
    return;
  }
  const budget = createBudget(pool, { dailyLimit: config.API_DAILY_CALL_LIMIT, runLimit: MAX_CALLS_PER_RUN });
  // Transient failures get one more attempt at the end of the run (CRON-001 D1).
  const { jobs, retried, stoppedBy } = await collectDaily(pool, { months: recentMonths(4), serviceKey: config.DATA_GO_KR_SERVICE_KEY, budget });
  // Matching is local (no external calls) and re-derives links for new or changed rows.
  const matching = await runMatching(pool);
  const brief = ({ source, city, period, status, errorCode }: (typeof jobs)[number]) => ({ source, city, period, status, errorCode });
  const body = { calls: budget.callsThisRun(), stoppedBy: stoppedBy ?? null, matching: { confirmed: matching.confirmed, pending: matching.pending }, jobs: jobs.map(brief), retried: retried.map(brief) };
  // Run summary for the runtime log (counts and codes only; no keys or URLs).
  console.log(`cron collect ${JSON.stringify(body)}`);
  sendJson(res, { status: 200, body });
}
