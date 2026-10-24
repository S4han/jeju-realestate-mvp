// Loads REB apartment reference data and cadastral coordinates into the database (TASK-003).
// Usage:
//   npm run import:reference -- --reb <page1.json> [--reb <page2.json> ...] --cadastral <path/without/.shp> \
//     --reb-as-of 2026-09-01 [--dry-run]
// Inputs are local files (REB API responses, V-World cadastral SHP); this script makes no network calls.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { getPool } from "../server/db";
import { readParcels } from "../server/reference/cadastral";
import { importReference } from "../server/reference/importReference";
import { assessLocation } from "../server/reference/location";
import { parseRebApartments, type RebRow } from "../server/reference/reb";

const { values } = parseArgs({
  options: {
    reb: { type: "string", multiple: true },
    cadastral: { type: "string" },
    "reb-as-of": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!values.reb?.length || !values.cadastral || !/^\d{4}-\d{2}-\d{2}$/.test(values["reb-as-of"] ?? "")) {
  console.error("usage: --reb <file>... --cadastral <shp base path> --reb-as-of YYYY-MM-DD [--dry-run]");
  process.exit(2);
}

const rows: RebRow[] = [];
for (const file of values.reb) rows.push(...(JSON.parse(await readFile(file, "utf8")) as { data: RebRow[] }).data);
const { apartments, skipped } = parseRebApartments(rows);
console.log(`REB rows ${rows.length} → Jeju apartments ${apartments.length}, skipped ${skipped.length}`);
for (const s of skipped) console.log(`  skipped ${s.complexPk}: ${s.reason}`);

const cadastralVersion = path.basename(values.cadastral);
const { parcels, scanned } = await readParcels(values.cadastral, new Set(apartments.map((a) => a.pnu)));
console.log(`cadastral ${cadastralVersion}: scanned ${scanned} parcels, matched ${parcels.size}`);

if (values["dry-run"]) {
  const counts: Record<string, number> = {};
  for (const a of apartments) {
    const s = assessLocation(parcels.get(a.pnu), a.unitCount).status;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  console.log("dry run, location status:", counts);
} else {
  const pool = getPool();
  try {
    const summary = await importReference(pool, apartments, parcels, { rebAsOf: values["reb-as-of"]!, cadastralVersion });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}
