// P3-TASK-003: region set build/verify/save/activate and deal-to-region mapping (fictional fixtures).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../../server/db";
import { migrate } from "../../scripts/migrate";
import { activateRegionSet, activeSetId, buildRegionSet, checkApartments, parseCodeCsv, saveRegionSet } from "../../server/phase3/regionSet";
import { summarizeMapping } from "../../server/phase3/mapping";
import { CODES, FEATURES, META, PRJ, center, files, sq } from "./fixture";

describe("region set build and verification (no DB)", () => {
  it("builds 2 cities + 4 eup/myeon/dong with WGS84 MultiPolygons and no errors", () => {
    const b = buildRegionSet(parseCodeCsv(CODES), files(), 20);
    expect(b.errors).toEqual([]);
    expect(b.regions.map((r) => `${r.level}:${r.code}`)).toEqual([
      "CITY:5011000000", "CITY:5013000000", "UMD:5011010100", "UMD:5011010200", "UMD:5011025000", "UMD:5013010100",
    ]);
    const g = b.boundaries[0]!;
    expect(g.geometry.type).toBe("MultiPolygon");
    const [lng, lat] = g.geometry.coordinates[0]![0]![0]!;
    expect(lng).toBeGreaterThan(126.4);
    expect(lat).toBeGreaterThan(33.4);
    expect(g.areaM2).toBe(1_000_000);
    expect(b.verification).toMatchObject({ codeTable: { umd: 4, ri: 1, cities: 2 }, match: { missing: [], extra: [], duplicated: [] } });
  });

  it("rejects missing, extra, duplicated or misnamed regions and a foreign CRS (P3-FR-021, TC-008)", () => {
    const codes = parseCodeCsv(CODES);
    expect(buildRegionSet(codes, files(FEATURES.slice(0, 3)), 20).errors.join()).toMatch(/missing regions 5013010100/);
    const extra = [...FEATURES, { attrs: { EMD_CD: "50110999", COL_ADM_SE: "50110", EMD_NM: "가상동" }, rings: [sq(5)] }];
    expect(buildRegionSet(codes, files(extra), 20).errors.join()).toMatch(/not in the code file 5011099900/);
    expect(buildRegionSet(codes, files([...FEATURES, FEATURES[0]!]), 20).errors.join()).toMatch(/duplicated regions 5011010100/);
    const renamed = FEATURES.map((f, i) => (i === 1 ? { ...f, attrs: { ...f.attrs, EMD_NM: "다른동" } } : f));
    expect(buildRegionSet(codes, files(renamed), 20).errors.join()).toMatch(/name mismatch/);
    expect(buildRegionSet(codes, files(FEATURES, PRJ.replace("5186", "5179")), 20).errors.join()).toMatch(/not EPSG:5186/);
    const empty = FEATURES.map((f, i) => (i === 0 ? { ...f, rings: [] } : f));
    expect(buildRegionSet(codes, files(empty), 20).errors.join()).toMatch(/5011010100: empty geometry/); // TC-008: missing polygon isolated
  });

  it("checks that verified apartment coordinates fall inside their own region", () => {
    const b = buildRegionSet(parseCodeCsv(CODES), files(), 20);
    const res = checkApartments(b, [
      { apartmentId: "1", legalDongCode: "5011010100", ...center(0) },
      { apartmentId: "2", legalDongCode: "5011025021", ...center(2) }, // ri code → 한림읍
      { apartmentId: "3", legalDongCode: "5011010100", ...center(1) }, // sits in 일도이동
      { apartmentId: "4", legalDongCode: "5011099900", ...center(0) },
    ]);
    expect(res).toMatchObject({ checked: 3, inside: 2, codeNotInSet: ["4"] });
    expect(res.outside).toEqual([{ apartmentId: "3", expected: "5011010100", foundIn: "5011010200" }]);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("region sets and mapping (DB)", () => {
  let pool: pg.Pool;
  let seq = 0;
  const apt = async (legal: string, city = legal.slice(0, 5)) =>
    String((await pool.query(
      "INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, location_status) VALUES ('단지',$1,$2,'x','NONE') RETURNING apartment_id",
      [city, legal],
    )).rows[0].apartment_id);
  const sale = (aptId: string | null, sgg: string, umd: string | null, o: { status?: string; date?: string } = {}) =>
    pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_code, umd_name, apt_name_raw, contract_date, area_m2, sale_price, record_status, cancelled_on)
       VALUES ('sale',$1,1,$2,$3,$4,'동','단지',$5,84.5,500000000,$6,$7)`,
      [`p3-${++seq}`, aptId, sgg, umd, o.date ?? "2026-09-10", o.status ?? "ACTIVE", o.status === "CANCELLED" ? "2026-09-20" : null],
    );

  beforeAll(async () => {
    pool = createPool(url!, "disable");
  });
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("protects the new tables with row level security", async () => {
    const { rows } = await pool.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'p3\\_%' AND relkind = 'r' ORDER BY 1");
    expect(rows).toEqual([
      { relname: "p3_region_boundaries", relrowsecurity: true },
      { relname: "p3_region_sets", relrowsecurity: true },
      { relname: "p3_regions", relrowsecurity: true },
    ]);
  });

  it("saves verified sets with rows, rejected sets without rows, and activates atomically", async () => {
    const good = buildRegionSet(parseCodeCsv(CODES), files(), 20);
    const a = await saveRegionSet(pool, META, good);
    expect(a.status).toBe("VERIFIED");
    expect((await pool.query("SELECT count(*)::int n FROM p3_regions WHERE set_id = $1", [a.setId])).rows[0].n).toBe(6);
    expect((await pool.query("SELECT count(*)::int n FROM p3_region_boundaries WHERE set_id = $1", [a.setId])).rows[0].n).toBe(4);
    expect(await activeSetId(pool)).toBeNull();

    await activateRegionSet(pool, a.setId);
    expect(await activeSetId(pool)).toBe(a.setId);

    const bad = buildRegionSet(parseCodeCsv(CODES), files(FEATURES.slice(0, 2)), 20);
    const r = await saveRegionSet(pool, META, bad);
    expect(r.status).toBe("REJECTED");
    expect((await pool.query("SELECT count(*)::int n FROM p3_regions WHERE set_id = $1", [r.setId])).rows[0].n).toBe(0);
    const v = (await pool.query("SELECT verification FROM p3_region_sets WHERE set_id = $1", [r.setId])).rows[0].verification;
    expect(v.errors.join()).toMatch(/missing regions/);
    // A rejected set can never become active; the previous active set stays (TC-034 analogue).
    await expect(activateRegionSet(pool, r.setId)).rejects.toThrow(/REJECTED/);
    expect(await activeSetId(pool)).toBe(a.setId);

    const b2 = await saveRegionSet(pool, { ...META, boundaryAsOf: "2026-11-01" }, good);
    await activateRegionSet(pool, b2.setId);
    expect(await activeSetId(pool)).toBe(b2.setId);
    const statuses = (await pool.query("SELECT set_id, status FROM p3_region_sets ORDER BY set_id")).rows.map((x) => x.status);
    expect(statuses).toEqual(["RETIRED", "REJECTED", "ACTIVE"]);
    // The database itself refuses a second ACTIVE set.
    await expect(pool.query("UPDATE p3_region_sets SET status = 'ACTIVE', activated_at = now(), verified_at = now() WHERE set_id = $1", [a.setId])).rejects.toThrow(/p3_region_sets_one_active/);
  });

  it("maps valid sales to eup/myeon/dong and isolates what cannot be trusted (TC-004/007/017/024/025)", async () => {
    const set = await saveRegionSet(pool, META, buildRegionSet(parseCodeCsv(CODES), files(), 20));
    const dong = await apt("5011010100");
    const ri = await apt("5011025021"); // 한림리 → 한림읍
    const seogwi = await apt("5013010100");
    const unknown = await apt("5011012900"); // valid Jeju code but not in this fixture set
    await sale(dong, "50110", "10100");
    await sale(dong, "50110", null); // deal code missing → trust the apartment
    await sale(ri, "50110", "25021");
    await sale(seogwi, "50130", "10100");
    await sale(dong, "50110", "10200"); // conflict: deal says 일도이동
    await sale(unknown, "50110", "12900");
    await sale(null, "50110", "10100"); // unmatched
    await sale(null, "50130", null); // unmatched
    await sale(dong, "50110", "10100", { status: "CANCELLED" }); // never counted
    await sale(dong, "50110", "10100", { date: "2025-01-10" }); // outside the window

    const m = await summarizeMapping(pool, set.setId, "2026-01-01", "2026-11-01");
    expect(Object.fromEntries(m.byRegion)).toEqual({ "5011010100": 2, "5011025000": 1, "5013010100": 1 });
    expect(m.byCity.get("50110")).toEqual({ MAPPED: 3, UNMATCHED: 1, CODE_NOT_IN_SET: 1, CODE_CONFLICT: 1 });
    expect(m.byCity.get("50130")).toEqual({ MAPPED: 1, UNMATCHED: 1, CODE_NOT_IN_SET: 0, CODE_CONFLICT: 0 });
    // City total = mapped regions + everything isolated, each sale exactly once.
    const valid = (await pool.query(
      "SELECT sgg_code, count(*)::int n FROM transactions WHERE record_status = 'ACTIVE' AND contract_date >= '2026-01-01' GROUP BY 1 ORDER BY 1",
    )).rows;
    for (const { sgg_code, n } of valid) {
      const c = m.byCity.get(sgg_code)!;
      expect(c.MAPPED + c.UNMATCHED + c.CODE_NOT_IN_SET + c.CODE_CONFLICT).toBe(n);
      const regionSum = [...m.byRegion].filter(([code]) => code.startsWith(sgg_code)).reduce((s, [, k]) => s + k, 0);
      expect(regionSum).toBe(c.MAPPED);
    }
  });
});
