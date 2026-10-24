// Daily incremental collection, triggered by Vercel Cron (Hobby: once per day).
// Vercel sends "Authorization: Bearer $CRON_SECRET"; anything else is rejected.
import { loadCollectorConfig } from "../../server/config.js";
import { getPool } from "../../server/db.js";
import { createBudget } from "../../server/collect/budget.js";
import { collect } from "../../server/collect/collector.js";
import { recentMonths } from "../../server/collect/months.js";
import { runMatching } from "../../server/match/run.js";
import { sendJson, type ApiRequest, type ApiResponse } from "../../server/http.js";

const MAX_CALLS_PER_RUN = 30;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    sendJson(res, { status: 401, body: { error: { code: "UNAUTHORIZED" } } });
    return;
  }
  const config = loadCollectorConfig();
  const pool = getPool();
  const budget = createBudget(pool, { dailyLimit: config.API_DAILY_CALL_LIMIT, runLimit: MAX_CALLS_PER_RUN });
  const { jobs, stoppedBy } = await collect(pool, { months: recentMonths(4), serviceKey: config.DATA_GO_KR_SERVICE_KEY, budget });
  // Matching is local (no external calls) and re-derives links for new or changed rows.
  const matching = await runMatching(pool);
  sendJson(res, {
    status: 200,
    body: { calls: budget.callsThisRun(), stoppedBy: stoppedBy ?? null, matching: { confirmed: matching.confirmed, pending: matching.pending }, jobs: jobs.map(({ source, city, period, status, errorCode }) => ({ source, city, period, status, errorCode })) },
  });
}
