// Local stand-in for Vercel's API routing: maps /api/<path> to api/<path>.ts.
import { createServer } from "node:http";
import { loadServerConfig } from "./config.js";
import { sendJson, type ApiRequest, type ApiResponse } from "./http.js";

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>;
type Route = { pattern: RegExp; load: () => Promise<{ default: Handler }> };
// Order matters: static paths before the dynamic [id] route (same precedence as Vercel).
const routes: Route[] = [
  { pattern: /^\/api\/system\/data-status$/, load: () => import("../api/system/data-status.js") },
  { pattern: /^\/api\/dashboard\/top-apartments$/, load: () => import("../api/dashboard/top-apartments.js") },
  { pattern: /^\/api\/apartments\/search$/, load: () => import("../api/apartments/search.js") },
  { pattern: /^\/api\/apartments\/map$/, load: () => import("../api/apartments/map.js") },
  { pattern: /^\/api\/apartments\/(?<id>[^/]+)$/, load: () => import("../api/apartments/[id]/index.js") },
  { pattern: /^\/api\/apartments\/(?<id>[^/]+)\/transactions$/, load: () => import("../api/apartments/[id]/transactions.js") },
  { pattern: /^\/api\/transactions\/(?<id>[^/]+)$/, load: () => import("../api/transactions/[id].js") },
  // Phase 2 (D4): price analysis, flag-guarded inside the handler.
  { pattern: /^\/api\/v2\/analysis\/apartments\/(?<id>[^/]+)\/(?<view>[^/]+)$/, load: () => import("../api/v2/analysis/apartments/[id]/[view].js") },
];

const config = loadServerConfig();
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = routes.find((r) => r.pattern.test(url.pathname));
  if (!route || req.method !== "GET") {
    sendJson(res, { status: 404, body: { error: { code: "NOT_FOUND" } } });
    return;
  }
  const params = route.pattern.exec(url.pathname)?.groups ?? {};
  (req as ApiRequest).query = { ...Object.fromEntries(url.searchParams), ...params };
  const { default: handler } = await route.load();
  await handler(req as ApiRequest, res);
}).listen(config.API_PORT, () => {
  console.log(`API dev server on http://localhost:${config.API_PORT}`);
});
