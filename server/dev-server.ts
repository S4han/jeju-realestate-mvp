// Local stand-in for Vercel's API routing: maps /api/<path> to api/<path>.ts.
import { createServer } from "node:http";
import { loadServerConfig } from "./config";
import { sendJson, type ApiRequest, type ApiResponse } from "./http";

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>;
const routes: Record<string, () => Promise<{ default: Handler }>> = {
  "/api/system/data-status": () => import("../api/system/data-status"),
};

const config = loadServerConfig();
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const load = routes[url.pathname];
  if (!load || req.method !== "GET") {
    sendJson(res, { status: 404, body: { error: { code: "NOT_FOUND" } } });
    return;
  }
  (req as ApiRequest).query = Object.fromEntries(url.searchParams);
  const { default: handler } = await load();
  await handler(req as ApiRequest, res);
}).listen(config.API_PORT, () => {
  console.log(`API dev server on http://localhost:${config.API_PORT}`);
});
