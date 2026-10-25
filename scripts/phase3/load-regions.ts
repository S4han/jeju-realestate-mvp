// Loads a Phase 3 region set (official legal codes + legal eup/myeon/dong boundaries) — P3-TASK-003.
//   verify only (no DB):  tsx scripts/phase3/load-regions.ts --codes <csv> --boundary <path/LSMD_..._50_YYYYMM>
//   + apartment check:    add DATABASE_URL (read-only query of verified apartment coordinates)
//   save as VERIFIED:     add --save            (writes p3_* tables only; REJECTED if any check fails)
//   activate:             --activate <setId>    (one transaction; previous ACTIVE becomes RETIRED)
// Source files stay outside the repository (P3-TASK-002 decision B).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPool } from "../../server/db.js";
import { activateRegionSet, buildRegionSet, checkApartments, parseCodeCsv, saveRegionSet, type ApartmentPoint } from "../../server/phase3/regionSet.js";

const { values: o } = parseArgs({
  options: {
    codes: { type: "string" },
    boundary: { type: "string" },
    tolerance: { type: "string", default: "20" },
    encoding: { type: "string", default: "euc-kr" },
    "code-as-of": { type: "string", default: "2026-06-30" },
    "boundary-as-of": { type: "string" },
    save: { type: "boolean", default: false },
    activate: { type: "string" },
  },
});
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const url = process.env.DATABASE_URL;
const pool = url ? createPool(url, process.env.DATABASE_SSL === "require" ? "require" : "disable") : null;

try {
  if (o.activate) {
    if (!pool) throw new Error("DATABASE_URL is required to activate");
    await activateRegionSet(pool, o.activate);
    console.log(`region set ${o.activate} is now ACTIVE`);
  } else {
    if (!o.codes || !o.boundary) throw new Error("--codes and --boundary are required");
    const codesBuf = readFileSync(o.codes);
    const shp = readFileSync(`${o.boundary}.shp`);
    const files = { shp, dbf: readFileSync(`${o.boundary}.dbf`), prj: readFileSync(`${o.boundary}.prj`, "utf8"), encoding: o.encoding! };
    const tol = Number(o.tolerance);
    const build = buildRegionSet(parseCodeCsv(codesBuf.toString("utf8")), files, tol);
    // e.g. LSMD_ADM_SECT_UMD_50_202610 → 2026-10-01 unless given explicitly
    const ym = /_(\d{4})(\d{2})$/.exec(o.boundary)?.slice(1);
    const boundaryAsOf = o["boundary-as-of"] ?? (ym ? `${ym[0]}-${ym[1]}-01` : undefined);
    if (!boundaryAsOf) throw new Error("--boundary-as-of is required");

    let apartments;
    if (pool) {
      const { rows } = await pool.query<{ apartment_id: string; legal_dong_code: string; lng: string; lat: string }>(
        "SELECT apartment_id, legal_dong_code, longitude AS lng, latitude AS lat FROM apartments WHERE location_status = 'VERIFIED_PARCEL'",
      );
      const points: ApartmentPoint[] = rows.map((r) => ({ apartmentId: String(r.apartment_id), legalDongCode: r.legal_dong_code, lng: Number(r.lng), lat: Number(r.lat) }));
      apartments = checkApartments(build, points);
      // Apartments are mapped by their official code, not by coordinates, so outliers are reported, not fatal.
      console.log(`apartments: checked ${apartments.checked}, inside own region ${apartments.inside}, outside ${apartments.outside.length}, code not in set ${apartments.codeNotInSet.length}`);
      for (const a of apartments.outside.slice(0, 20)) console.log(`  outside: apartment ${a.apartmentId} expected ${a.expected} found ${a.foundIn ?? "none"}`);
    }
    console.log(JSON.stringify({ errors: build.errors, ...build.verification }, null, 2));

    if (o.save) {
      if (!pool) throw new Error("DATABASE_URL is required to save");
      const meta = {
        codeSource: "국토교통부_전국 법정동(공공데이터포털 15063424)", codeAsOf: o["code-as-of"]!, codeChecksum: sha(codesBuf),
        boundarySource: "국토교통부 법정구역정보 LSMD_ADM_SECT_UMD(브이월드)", boundaryAsOf, boundaryChecksum: sha(shp),
        sourceCrs: "EPSG:5186", toleranceM: tol,
      };
      const saved = await saveRegionSet(pool, meta, build, apartments ? { apartments: { ...apartments, outside: apartments.outside.slice(0, 100) } } : {});
      console.log(`saved region set ${saved.setId} as ${saved.status}`);
      if (saved.status !== "VERIFIED") process.exitCode = 2;
    } else if (build.errors.length) process.exitCode = 2;
  }
} finally {
  await pool?.end();
}
