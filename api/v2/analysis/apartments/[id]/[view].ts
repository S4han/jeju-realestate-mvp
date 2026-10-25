// Phase 2 price analysis API, one function for every view (P2-TASK-004, D5). Flag off → 404 before any DB access.
import { sendJson, type ApiRequest, type ApiResponse } from "../../../../../server/http.js";
import { isPhase2Enabled } from "../../../../../server/phase2/flag.js";
import { handleAnalysis } from "../../../../../server/phase2/handlers.js";
import { respondWithPool } from "../../../../../server/withPool.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!isPhase2Enabled()) {
    sendJson(res, { status: 404, body: { error: { code: "NOT_FOUND" } } });
    return;
  }
  const { id, view, ...query } = req.query ?? {};
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  await respondWithPool(res, (pool) => handleAnalysis(pool, first(id), first(view), query, { cursorSecret: process.env.P2_CURSOR_SECRET }));
}
