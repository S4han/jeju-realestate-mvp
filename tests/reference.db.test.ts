// Integration: REB + cadastral import into TEST_DATABASE_URL (wiped at start).
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../server/db";
import { readParcels } from "../server/reference/cadastral";
import { importReference } from "../server/reference/importReference";
import type { Parcel } from "../server/reference/location";
import { parseRebApartments, type RebRow } from "../server/reference/reb";
import { migrate } from "../scripts/migrate";

const url = process.env.TEST_DATABASE_URL;

const row = (pk: string, pnu: string, name: string, units: number, extra: Partial<RebRow> = {}): RebRow => ({
  COMPLEX_PK: pk, PNU: pnu, ADRES: `제주특별자치도 제주시 연동 ${pk}`, ROAD_ADRES: "연동로 1",
  COMPLEX_NM1: name, COMPLEX_NM2: `${name}아파트`, COMPLEX_NM3: null, COMPLEX_GB_CD: "1",
  DONG_CNT: 2, UNIT_CNT: units, USEAPR_DT: "20150101", ...extra,
});

describe.skipIf(!url)("importReference", () => {
  let pool: pg.Pool;
  let parcels: Map<string, Parcel>;
  const rows = [
    row("P1", "5011013700100010000", "정상단지", 120),
    row("P2", "5011013700100020000", "U자단지", 10),
    row("P3", "5011013700199990000", "필지없음", 30),
  ];

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    ({ parcels } = await readParcels(path.resolve("tests/fixtures/cadastral/mini"), new Set(rows.map((r) => r.PNU!))));
  });
  afterAll(async () => {
    await pool?.end();
  });

  const opts = { rebAsOf: "2026-09-01", cadastralVersion: "mini" };

  it("inserts apartments with provenance, flags and REB id mapping", async () => {
    const s = await importReference(pool, parseRebApartments(rows).apartments, parcels, opts);
    expect(s).toMatchObject({ inserted: 3, updated: 0, byStatus: { VERIFIED_PARCEL: 1, REVIEW: 1, NONE: 1 } });

    const { rows: apts } = await pool.query(
      `SELECT a.name, a.location_status, a.location_source, a.location_flags, a.latitude, s.source_id
         FROM apartments a JOIN apartment_source_ids s USING (apartment_id) ORDER BY s.source_id`,
    );
    expect(apts.map((a) => [a.source_id, a.location_status])).toEqual([["P1", "VERIFIED_PARCEL"], ["P2", "REVIEW"], ["P3", "NONE"]]);
    expect(apts[0].location_source).toBe("CADASTRAL:mini:PARCEL_CENTROID");
    expect(apts[1].location_flags).toEqual(["NON_RESIDENTIAL_JIMOK", "REPRESENTATIVE_POINT"]);
    expect(apts[2].latitude).toBeNull();
    expect(apts[2].location_flags).toEqual(["PARCEL_NOT_FOUND"]);
  });

  it("marker query sees only VERIFIED_PARCEL apartments", async () => {
    const { rows: markers } = await pool.query("SELECT name FROM apartments WHERE location_status = 'VERIFIED_PARCEL'");
    expect(markers.map((m) => m.name)).toEqual(["정상단지"]);
  });

  it("is idempotent and replaces REB aliases on re-import", async () => {
    const renamed = [row("P1", "5011013700100010000", "정상단지2", 120), rows[1]!, rows[2]!];
    const s = await importReference(pool, parseRebApartments(renamed).apartments, parcels, opts);
    expect(s).toMatchObject({ inserted: 0, updated: 3 });
    expect((await pool.query("SELECT count(*)::int AS n FROM apartments")).rows[0].n).toBe(3);
    const { rows: aliases } = await pool.query(
      `SELECT alias_name FROM apartment_aliases JOIN apartment_source_ids s USING (apartment_id)
        WHERE s.source_id = 'P1' ORDER BY alias_name`,
    );
    expect(aliases.map((a) => a.alias_name)).toEqual(["정상단지2", "정상단지2아파트"]);
  });

  it("records sync jobs for data-status", async () => {
    const { rows: jobs } = await pool.query("SELECT source_id, status, record_count FROM sync_jobs ORDER BY job_id");
    expect(jobs.slice(0, 2)).toEqual([
      { source_id: "REB_COMPLEX", status: "SUCCESS", record_count: 3 },
      { source_id: "CADASTRAL", status: "SUCCESS", record_count: 2 },
    ]);
  });

  it("rolls back everything when one row fails", async () => {
    const before = (await pool.query("SELECT count(*)::int AS n FROM apartments")).rows[0].n;
    const good = parseRebApartments([row("P9", "5011013700100010000", "새단지", 50)]).apartments;
    const bad = { ...good[0]!, rebComplexPk: "P10", legalDongCode: "BAD" };
    await expect(importReference(pool, [...good, bad], parcels, opts)).rejects.toThrow();
    expect((await pool.query("SELECT count(*)::int AS n FROM apartments")).rows[0].n).toBe(before);
    expect((await pool.query("SELECT count(*)::int AS n FROM apartment_source_ids WHERE source_id = 'P9'")).rows[0].n).toBe(0);
  });
});
