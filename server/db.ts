import pg from "pg";
import { loadServerConfig } from "./config.js";

let pool: pg.Pool | undefined;

export function createPool(connectionString: string, ssl: "require" | "disable"): pg.Pool {
  return new pg.Pool({
    connectionString,
    ssl: ssl === "require" ? { rejectUnauthorized: false } : false,
    max: 3,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
}

// One small pool per server process / serverless instance.
export function getPool(): pg.Pool {
  if (!pool) {
    const config = loadServerConfig();
    pool = createPool(config.DATABASE_URL, config.DATABASE_SSL);
  }
  return pool;
}
