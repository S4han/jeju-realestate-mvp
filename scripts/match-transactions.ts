// Recomputes apartment ↔ transaction matches from data already in the database (no network).
import { getPool } from "../server/db";
import { runMatching } from "../server/match/run";

const pool = getPool();
try {
  console.log(JSON.stringify(await runMatching(pool), null, 2));
} finally {
  await pool.end();
}
