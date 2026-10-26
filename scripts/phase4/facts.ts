// Prints the AI summary fact sheets (P4-TASK-002) for the database in DATABASE_URL. Read-only.
// Usage: npx tsx scripts/phase4/facts.ts [JEJU|50110|50130 ...] [--now 2026-10-26T00:00:00Z] [--json]
import { parseArgs } from "node:util";
import { getPool } from "../../server/db";
import { SCOPES, loadFacts, type Scope } from "../../server/phase4/facts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { now: { type: "string" }, json: { type: "boolean" } } });
const now = values.now ? new Date(values.now) : new Date();
const scopes = (positionals.length ? positionals : SCOPES) as Scope[];
const pool = getPool();
try {
  for (const scope of scopes) {
    const t = performance.now();
    const r = await loadFacts(pool, scope, now);
    const ms = Math.round(performance.now() - t);
    if (values.json) { console.log(JSON.stringify({ ms, ...r })); continue; }
    if (!r.ok) { console.log(`== ${scope}: no facts (${r.reason}) ${ms} ms`); continue; }
    console.log(`== ${scope} snapshot ${r.sheet.snapshotId} data ${r.sheet.dataAsOf} ${ms} ms`);
    for (const f of r.sheet.facts) console.log(`  ${f.id.padEnd(18)} ${f.region.name.padEnd(6)} ${Object.entries(f.fields).map(([k, v]) => `${k}=${v.display}`).join(" ")}`);
    for (const n of r.sheet.notes) console.log(`  * ${n}`);
  }
} finally {
  await pool.end();
}
