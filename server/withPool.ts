import type pg from "pg";
import { ConfigError } from "./config.js";
import { getPool } from "./db.js";
import { sendJson, serviceUnavailable, type ApiResponse, type HandlerResult } from "./http.js";

// Runs a DB-backed API handler. A misconfigured deployment (invalid env) answers 503 like an unreachable
// database instead of crashing the function; the log names the variables, never their values.
export async function respondWithPool(res: ApiResponse, run: (pool: pg.Pool) => Promise<HandlerResult>): Promise<void> {
  let pool: pg.Pool;
  try {
    pool = getPool();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(err.message);
    sendJson(res, serviceUnavailable("DB_UNAVAILABLE"));
    return;
  }
  sendJson(res, await run(pool));
}
