// Phase 3 region analysis API, one function for every view (P3-TASK-005, P3-D4). Flag off → 404 before any DB access.
import { sendJson, type ApiRequest, type ApiResponse } from "../../../server/http.js";
import { isPhase2Enabled } from "../../../server/phase2/flag.js";
import { isPhase3Enabled } from "../../../server/phase3/flag.js";
import { handleRegions } from "../../../server/phase3/handlers.js";
import { respondWithPool } from "../../../server/withPool.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!isPhase3Enabled()) {
    sendJson(res, { status: 404, body: { error: { code: "NOT_FOUND" } } });
    return;
  }
  const { view, ...query } = req.query ?? {};
  await respondWithPool(res, (pool) =>
    handleRegions(pool, Array.isArray(view) ? view[0] : view, query, { cursorSecret: process.env.P3_CURSOR_SECRET, phase2Enabled: isPhase2Enabled() }),
  );
}
