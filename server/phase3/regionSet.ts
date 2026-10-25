// Region reference sets (P3-TASK-003): official legal codes + legal eup/myeon/dong boundaries, verified
// before they are stored and activated as one unit. Pure building/verification first, then DB writes.
import type pg from "pg";
import { fromTm, isEpsg5186, toTm } from "./geo/tm5186.js";
import { containsPoint, readDbf, readPolygons, ringArea, type Ring } from "./geo/shapefile.js";
import { simplifyShared } from "./geo/simplify.js";
import { JEJU_CITIES } from "./regionCode.js";

export type CodeRow = { code: string; sido: string; sgg: string; umd: string; ri: string; createdOn: string };

/** Rows of the official legal-dong code CSV (법정동코드,시도명,시군구명,읍면동명,리명,순번,생성일자). */
export function parseCodeCsv(text: string): CodeRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0]!.split(",").map((h) => h.trim());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`code file: missing column ${name}`);
    return i;
  };
  const [c, sd, sg, um, ri, cr] = ["법정동코드", "시도명", "시군구명", "읍면동명", "리명", "생성일자"].map(col) as number[];
  return lines.slice(1).map((l) => {
    const v = l.split(",");
    return { code: v[c!]!.trim(), sido: v[sd!]!.trim(), sgg: v[sg!]!.trim(), umd: v[um!]!.trim(), ri: v[ri!]!.trim(), createdOn: v[cr!]!.trim() };
  });
}

export type Region = { code: string; level: "CITY" | "UMD"; name: string; cityCode: string };
export type Boundary = { code: string; geometry: { type: "MultiPolygon"; coordinates: number[][][][] }; bbox: [number, number, number, number]; vertexCount: number; areaM2: number };
export type BoundaryFiles = { shp: Buffer; dbf: Buffer; prj: string; encoding: string };

export type RegionSetBuild = {
  regions: Region[];
  boundaries: Boundary[];
  /** Source-precision rings (EPSG:5186 metres) per region code, for containment checks. */
  sourceRings: Map<string, Ring[]>;
  verification: Record<string, unknown>;
  errors: string[];
};

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function buildRegionSet(codes: CodeRow[], files: BoundaryFiles, toleranceM: number): RegionSetBuild {
  const errors: string[] = [];
  const jeju = codes.filter((r) => /^50\d{8}$/.test(r.code));
  const cities = jeju.filter((r) => (JEJU_CITIES as readonly string[]).includes(r.code.slice(0, 5)) && r.code.slice(5) === "00000");
  const umds = jeju.filter((r) => r.code.slice(5, 8) !== "000" && r.code.slice(8) === "00");
  const ris = jeju.filter((r) => r.code.slice(8) !== "00");
  if (cities.length !== 2) errors.push(`code file: expected 2 Jeju cities, found ${cities.length}`);
  const umdByCode = new Map(umds.map((r) => [r.code, r]));
  const orphanRi = ris.filter((r) => !umdByCode.has(`${r.code.slice(0, 8)}00`)).map((r) => r.code);
  if (orphanRi.length) errors.push(`code file: ri codes without an eup/myeon: ${orphanRi.join(", ")}`);

  if (!isEpsg5186(files.prj)) errors.push("boundary: source CRS is not EPSG:5186");
  const attrs = readDbf(files.dbf, files.encoding);
  const shapes = readPolygons(files.shp);
  if (attrs.length !== shapes.length) errors.push(`boundary: ${attrs.length} attribute rows but ${shapes.length} shapes`);

  const seen = new Map<string, number>();
  const nameMismatch: string[] = [];
  const geometryErrors: string[] = [];
  const sourceRings = new Map<string, Ring[]>();
  let sourceVertices = 0;
  let holes = 0;
  attrs.forEach((a, i) => {
    const code = `${a.EMD_CD ?? ""}00`;
    seen.set(code, (seen.get(code) ?? 0) + 1);
    const official = umdByCode.get(code);
    if (official && official.umd !== a.EMD_NM) nameMismatch.push(`${code} ${a.EMD_NM}≠${official.umd}`);
    if (official && a.COL_ADM_SE && a.COL_ADM_SE !== code.slice(0, 5)) geometryErrors.push(`${code}: city column ${a.COL_ADM_SE}`);
    const rings = shapes[i] ?? [];
    if (!rings.length) geometryErrors.push(`${code}: empty geometry`);
    for (const r of rings) {
      sourceVertices += r.length;
      const [x0, y0] = r[0]!;
      const [xn, yn] = r[r.length - 1]!;
      if (r.length < 4 || x0 !== xn || y0 !== yn) geometryErrors.push(`${code}: open or degenerate ring`);
      if (ringArea(r) > 0) holes++; // shapefile holes are counter-clockwise
    }
    sourceRings.set(code, rings);
  });
  if (holes) errors.push(`boundary: ${holes} hole rings (not supported by this loader)`);
  const missing = [...umdByCode.keys()].filter((c) => !seen.has(c)).sort();
  const extra = [...seen.keys()].filter((c) => !umdByCode.has(c)).sort();
  const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c).sort();
  if (missing.length) errors.push(`boundary: missing regions ${missing.join(", ")}`);
  if (extra.length) errors.push(`boundary: regions not in the code file ${extra.join(", ")}`);
  if (duplicated.length) errors.push(`boundary: duplicated regions ${duplicated.join(", ")}`);
  if (nameMismatch.length) errors.push(`boundary: name mismatch ${nameMismatch.join("; ")}`);
  errors.push(...geometryErrors);

  const codesInOrder = attrs.map((a) => `${a.EMD_CD ?? ""}00`);
  const simplified = simplifyShared(codesInOrder.map((c) => sourceRings.get(c) ?? []), toleranceM);
  const boundaries: Boundary[] = [];
  let outVertices = 0;
  simplified.features.forEach((rings, i) => {
    const code = codesInOrder[i]!;
    if (!umdByCode.has(code) || !rings.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // GeoJSON outer rings are counter-clockwise: reverse the clockwise shapefile rings.
    const coordinates = rings.map((ring) => [
      ring.slice().reverse().map(([x, y]) => {
        const [lon, lat] = fromTm(x, y);
        minX = Math.min(minX, lon); maxX = Math.max(maxX, lon); minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
        return [round(lon, 5), round(lat, 5)];
      }),
    ]);
    const vertexCount = rings.reduce((n, r) => n + r.length, 0);
    outVertices += vertexCount;
    const areaM2 = Math.abs((sourceRings.get(code) ?? []).reduce((s, r) => s + ringArea(r), 0));
    boundaries.push({ code, geometry: { type: "MultiPolygon", coordinates }, bbox: [round(minX, 6), round(minY, 6), round(maxX, 6), round(maxY, 6)], vertexCount, areaM2: round(areaM2, 1) });
  });

  const regions: Region[] = [
    ...cities.map((r) => ({ code: r.code, level: "CITY" as const, name: r.sgg, cityCode: r.code.slice(0, 5) })),
    ...umds.map((r) => ({ code: r.code, level: "UMD" as const, name: r.umd, cityCode: r.code.slice(0, 5) })),
  ];
  const geojsonBytes = Buffer.byteLength(JSON.stringify(boundaries.map((b) => b.geometry)));
  const verification = {
    codeTable: { jejuRows: jeju.length, cities: cities.length, umd: umds.length, ri: ris.length, createdOn: [...new Set(jeju.map((r) => r.createdOn))].sort() },
    boundary: { records: attrs.length, sourceVertices, holes, areaKm2: round(boundaries.reduce((s, b) => s + b.areaM2, 0) / 1e6, 1) },
    match: { missing, extra, duplicated, nameMismatch: nameMismatch.length },
    simplify: { toleranceM, vertices: outVertices, droppedRings: simplified.droppedRings, sharedChainsReused: simplified.sharedChains, geojsonBytes },
  };
  return { regions, boundaries, sourceRings, verification, errors };
}

export type ApartmentPoint = { apartmentId: string; legalDongCode: string; lng: number; lat: number };
export type ApartmentCheck = { checked: number; inside: number; outside: { apartmentId: string; expected: string; foundIn: string | null }[]; codeNotInSet: string[] };

/** Every apartment with a verified coordinate should lie inside the polygon of its own eup/myeon/dong. */
export function checkApartments(build: RegionSetBuild, points: ApartmentPoint[]): ApartmentCheck {
  const result: ApartmentCheck = { checked: 0, inside: 0, outside: [], codeNotInSet: [] };
  for (const p of points) {
    const expected = `${p.legalDongCode.slice(0, 8)}00`;
    const rings = build.sourceRings.get(expected);
    if (!rings) {
      result.codeNotInSet.push(p.apartmentId);
      continue;
    }
    result.checked++;
    const xy = toTm(p.lng, p.lat);
    if (containsPoint(rings, xy)) result.inside++;
    else {
      const foundIn = [...build.sourceRings.entries()].find(([, r]) => containsPoint(r, xy))?.[0] ?? null;
      result.outside.push({ apartmentId: p.apartmentId, expected, foundIn });
    }
  }
  return result;
}

export type SetMeta = { codeSource: string; codeAsOf: string; codeChecksum: string; boundarySource: string; boundaryAsOf: string; boundaryChecksum: string; sourceCrs: string; toleranceM: number };

/** Stores a set in one transaction: VERIFIED with its rows when there are no errors, else REJECTED (no rows). */
export async function saveRegionSet(pool: pg.Pool, meta: SetMeta, build: RegionSetBuild, extra: Record<string, unknown> = {}): Promise<{ setId: string; status: "VERIFIED" | "REJECTED" }> {
  const status = build.errors.length ? "REJECTED" : "VERIFIED";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ set_id: string }>(
      `INSERT INTO p3_region_sets (code_source, code_as_of, code_checksum, boundary_source, boundary_as_of, boundary_checksum, source_crs,
         simplify_tolerance_m, status, verification, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $9 = 'VERIFIED' THEN now() END) RETURNING set_id`,
      [meta.codeSource, meta.codeAsOf, meta.codeChecksum, meta.boundarySource, meta.boundaryAsOf, meta.boundaryChecksum, meta.sourceCrs,
        meta.toleranceM, status, JSON.stringify({ ...build.verification, ...extra, errors: build.errors })],
    );
    const setId = String(rows[0]!.set_id);
    if (status === "VERIFIED") {
      for (const r of build.regions) {
        await client.query("INSERT INTO p3_regions (set_id, region_code, level, name, city_code) VALUES ($1,$2,$3,$4,$5)", [setId, r.code, r.level, r.name, r.cityCode]);
      }
      for (const b of build.boundaries) {
        await client.query(
          "INSERT INTO p3_region_boundaries (set_id, region_code, geometry, bbox, vertex_count, area_m2) VALUES ($1,$2,$3,$4,$5,$6)",
          [setId, b.code, JSON.stringify(b.geometry), b.bbox, b.vertexCount, b.areaM2],
        );
      }
    }
    await client.query("COMMIT");
    return { setId, status };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Makes a VERIFIED set the only ACTIVE one in a single transaction; the previous ACTIVE set becomes RETIRED. */
export async function activateRegionSet(pool: pg.Pool, setId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ status: string }>("SELECT status FROM p3_region_sets WHERE set_id = $1 FOR UPDATE", [setId]);
    if (rows[0]?.status !== "VERIFIED") throw new Error(`region set ${setId} is ${rows[0]?.status ?? "missing"}, not VERIFIED`);
    await client.query("UPDATE p3_region_sets SET status = 'RETIRED' WHERE status = 'ACTIVE'");
    await client.query("UPDATE p3_region_sets SET status = 'ACTIVE', activated_at = now() WHERE set_id = $1", [setId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The ACTIVE set id seen by the given client (inside a read snapshot), or null when none is active. */
export async function activeSetId(client: pg.PoolClient | pg.Pool): Promise<string | null> {
  const { rows } = await client.query<{ set_id: string }>("SELECT set_id FROM p3_region_sets WHERE status = 'ACTIVE'");
  return rows[0] ? String(rows[0].set_id) : null;
}
