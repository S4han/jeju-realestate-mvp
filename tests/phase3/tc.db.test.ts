// P3-TASK-007: the 40 required cases of docs/phase3/TEST_PLAN.md, one test per P3-TC id, at API/DB level.
// UI aspects of TC-001~003, 009, 010, 038, 039 are also covered by tests/e2e/phase3.e2e.mjs (see report).
// Fixture: tests/phase3/fixture.ts — A 일도일동, B 일도이동, C 한림읍 (제주시), D 서귀동 (서귀포시).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../../server/db";
import { migrate } from "../../scripts/migrate";
import { periodWindow, withSnapshot } from "../../server/phase2/analysis";
import { handleAnalysis } from "../../server/phase2/handlers";
import { listTransactions } from "../../server/handlers/transactions";
import { handleRegions } from "../../server/phase3/handlers";
import { quantileClasses } from "../../server/phase3/quantiles";
import { activateRegionSet, buildRegionSet, parseCodeCsv, saveRegionSet } from "../../server/phase3/regionSet";
import { summarizeMapping } from "../../server/phase3/mapping";
import { CODES, FEATURES, META, files } from "./fixture";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-25T03:00:00Z");
const SECRET = "p3-tc-cursor-secret-0123456789abcdefgh";
const A = "5011010100", B = "5011010200", C = "5011025000", D = "5013010100";
const JEJU = "5011000000", SEOGWIPO = "5013000000";

describe.skipIf(!url)("Phase 3 required test cases (DB)", () => {
  let pool: pg.Pool;
  let setId: string;
  let seq = 0;
  const apt = async (legal: string, name = "단지") =>
    String((await pool.query(
      "INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, location_status) VALUES ($1,$2,$3,'x','NONE') RETURNING apartment_id",
      [name, legal.slice(0, 5), legal],
    )).rows[0].apartment_id);
  const sale = async (aptId: string | null, date: string, price: number, o: { area?: number; sgg?: string; umd?: string | null; status?: string } = {}) =>
    String((await pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_code, umd_name, apt_name_raw, contract_date, area_m2, sale_price, record_status, cancelled_on)
       VALUES ('sale',$1,1,$2,$3,$4,'동','단지',$5,$6,$7,$8,$9) RETURNING transaction_id`,
      [`tc3-${++seq}`, aptId, o.sgg ?? "50110", o.umd ?? null, date, o.area ?? 100, price, o.status ?? "ACTIVE", o.status === "CANCELLED" ? date : null],
    )).rows[0].transaction_id);
  const api = async (view: string, q: Record<string, string> = {}) => {
    const r = await handleRegions(pool, view, q, { cursorSecret: SECRET, phase2Enabled: true, now: NOW });
    return { status: r.status, body: r.body as any };
  };
  const ok = async (view: string, q: Record<string, string> = {}) => {
    const r = await api(view, q);
    expect(r.status, `${view} ${JSON.stringify(q)} ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
    return r.body;
  };
  const umdStats = async (parent: string, extra: Record<string, string> = {}) => ok("statistics", { level: "legal_dong", parentRegionId: parent, period: "12", ...extra });
  const region = (body: any, id: string) => body.regions.find((r: any) => r.regionId === id);
  const setJob = (city: string, period: string, status: string, ms: number) =>
    pool.query("INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at) VALUES ('MOLIT_SALE',$1,$2,$3,$4,$4)", [city, period, status, new Date(NOW.getTime() - ms)]);

  let aptA = "", aptC = "", aptD = "";
  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    setId = (await saveRegionSet(pool, META, buildRegionSet(parseCodeCsv(CODES), files(), 20))).setId;
    await activateRegionSet(pool, setId);
    for (const city of ["50110", "50130"]) for (const m of periodWindow(36, NOW).months) await setJob(city, m, "SUCCESS", 3_600_000);
    aptA = await apt(A, "한라");
    aptC = await apt("5011025021", "한라"); // same complex name in another region (TC-006)
    aptD = await apt(D, "서귀");
    // A: 3 recent deals with different precise areas; 3 previous-year deals at 5,000,000/㎡
    await sale(aptA, "2026-01-10", 500_000_000, { area: 84.99 });
    await sale(aptA, "2026-03-10", 600_000_000, { area: 84.01 });
    await sale(aptA, "2026-05-10", 550_000_000, { area: 84.5 });
    for (const d of ["2025-01-10", "2025-02-10", "2025-03-10"]) await sale(aptA, d, 500_000_000);
    // C: 2 recent deals (count only), 3 previous
    await sale(aptC, "2026-02-01", 300_000_000);
    await sale(aptC, "2026-03-01", 310_000_000);
    for (const d of ["2025-04-10", "2025-05-10", "2025-06-10"]) await sale(aptC, d, 280_000_000);
    // D: unbalanced months, even count: Mar 8M; Apr 4,5,6M per ㎡
    await sale(aptD, "2026-03-05", 800_000_000, { sgg: "50130" });
    for (const p of [400_000_000, 500_000_000, 600_000_000]) await sale(aptD, "2026-04-05", p, { sgg: "50130" });
  });
  afterAll(async () => {
    await pool?.end();
  });

  // ---- 지도·지역 (001~010) ----
  it("P3-TC-001 the first map shows 제주시·서귀포시 with boundaries for every eup/myeon/dong", async () => {
    const s = await ok("statistics", { level: "city" });
    expect(s.regions.map((r: any) => [r.regionId, r.name])).toEqual([[JEJU, "제주시"], [SEOGWIPO, "서귀포시"]]);
    const b = await ok("boundaries", { level: "city" });
    expect(new Set(b.features.map((f: any) => f.properties.cityRegionId))).toEqual(new Set([JEJU, SEOGWIPO]));
  });

  it("P3-TC-002 choosing 제주시 lists its legal eup/myeon/dong only", async () => {
    expect((await umdStats(JEJU)).regions.map((r: any) => r.regionId)).toEqual([A, B, C]);
    expect((await ok("boundaries", { level: "legal_dong", parentRegionId: JEJU })).features.map((f: any) => f.id)).toEqual([A, B, C]);
  });

  it("P3-TC-003 choosing 서귀포시 lists its legal eup/myeon/dong only", async () => {
    expect((await umdStats(SEOGWIPO)).regions.map((r: any) => r.regionId)).toEqual([D]);
  });

  it("P3-TC-004 apartments map to the official legal eup/myeon/dong (ri codes roll up)", async () => {
    const m = await withSnapshot(pool, (c) => summarizeMapping(c, setId, "2024-11-01", "2026-11-01"));
    expect(m.byRegion.get(C)).toBe(5); // all of 한림리 apartment's deals counted in 한림읍
    expect(region(await umdStats(JEJU), C)).toMatchObject({ tradeCount: 2, hasApartments: true });
  });

  it("P3-TC-005 a code missing from the current official code table is isolated, never auto-linked", async () => {
    const gone = await apt("5011099900", "폐지동단지");
    await sale(gone, "2026-02-02", 400_000_000);
    const s = await ok("statistics", { level: "city", period: "12" });
    expect(s.unmapped["50110"]).toMatchObject({ codeNotInSet: 1 });
    expect(region(s, JEJU).tradeCount).toBe(5); // A 3 + C 2, the unknown code is not added
    // A boundary file with a code the table does not have is rejected as a whole.
    const extra = [...FEATURES, { attrs: { EMD_CD: "50110999", COL_ADM_SE: "50110", EMD_NM: "폐지동" }, rings: FEATURES[0]!.rings }];
    expect(buildRegionSet(parseCodeCsv(CODES), files(extra), 20).errors.join()).toMatch(/not in the code file/);
    await pool.query("UPDATE transactions SET record_status = 'CANCELLED', cancelled_on = contract_date WHERE apartment_id = $1", [gone]);
  });

  it("P3-TC-006 regions and complexes with the same name stay separate (by code / id, never by name)", async () => {
    const s = await umdStats(JEJU);
    expect(region(s, A).tradeCount).toBe(3); // 한라 in 일도일동
    expect(region(s, C).tradeCount).toBe(2); // 한라 in 한림읍
    const list = await ok("apartments", { regionId: A, period: "12" });
    expect(list.items.map((x: any) => x.apartmentId)).toEqual([aptA]);
  });

  it("P3-TC-007 a deal whose own code conflicts with its apartment is isolated", async () => {
    const tx = await sale(aptA, "2026-06-01", 900_000_000, { umd: "10200" });
    const s = await ok("statistics", { level: "city", period: "12" });
    expect(s.unmapped["50110"].codeConflict).toBe(1);
    expect(region(await umdStats(JEJU), A).tradeCount).toBe(3);
    expect(region(await umdStats(JEJU), B).tradeCount).toBe(0);
    await pool.query("UPDATE transactions SET record_status = 'CANCELLED', cancelled_on = contract_date WHERE transaction_id = $1", [tx]);
  });

  it("P3-TC-008 a missing polygon rejects the whole set; the active set keeps serving", async () => {
    const bad = await saveRegionSet(pool, META, buildRegionSet(parseCodeCsv(CODES), files(FEATURES.filter((_, i) => i !== 2)), 20));
    expect(bad.status).toBe("REJECTED");
    await expect(activateRegionSet(pool, bad.setId)).rejects.toThrow();
    expect((await ok("boundaries", { level: "city" })).features).toHaveLength(4);
  });

  it("P3-TC-009 switching price ↔ trade count keeps the snapshot and reclassifies on the new metric", async () => {
    const p = await umdStats(JEJU);
    const t = await umdStats(JEJU, { metric: "trade_count" });
    expect(t.snapshotId).toBe(p.snapshotId);
    expect(p.legend).toMatchObject({ unit: "KRW_PER_M2", eligibleRegionCount: 1 }); // only A has >= 3 deals
    expect(t.legend).toMatchObject({ unit: "TRADES", eligibleRegionCount: 2 }); // A and C have apartments, B has none
    expect(region(t, C).class).not.toBeNull();
    expect(region(p, C).class).toBeNull();
  });

  it("P3-TC-010 12/24/36-month windows are the same across statistics, detail, compare and complexes", async () => {
    for (const period of ["12", "24", "36"]) {
      const w = periodWindow(Number(period), NOW);
      const expected = { startInclusive: w.from, endExclusive: w.to };
      expect((await ok("statistics", { level: "legal_dong", parentRegionId: JEJU, period })).contractPeriod).toEqual(expected);
      expect((await ok("detail", { regionId: A, period })).contractPeriod).toEqual(expected);
      expect((await ok("compare", { regionIds: `${A},${D}`, period })).contractPeriod).toEqual(expected);
      expect((await ok("apartments", { regionId: A, period })).contractPeriod).toEqual(expected);
    }
  });

  // ---- 통계 (011~020) ----
  it("P3-TC-011 3 valid deals give a median price per ㎡", async () => {
    const ppm = [500_000_000 / 84.99, 600_000_000 / 84.01, 550_000_000 / 84.5].sort((x, y) => x - y);
    expect(region(await umdStats(JEJU), A)).toMatchObject({ priceStatus: "AVAILABLE", medianPricePerM2Won: Math.round(ppm[1]!) });
  });

  it("P3-TC-012 2 valid deals show the count but no price", async () => {
    expect(region(await umdStats(JEJU), C)).toMatchObject({ tradeCount: 2, medianPricePerM2Won: null, priceStatus: "INSUFFICIENT_SAMPLE" });
  });

  it("P3-TC-013 0 deals read 'no trades' only when collection is complete (and 'no apartments' differs)", async () => {
    expect(region(await umdStats(JEJU), B).priceStatus).toBe("NO_APARTMENTS");
    const empty = await apt(B, "빈단지");
    expect(region(await umdStats(JEJU), B)).toMatchObject({ priceStatus: "NO_TRADES", tradeCount: 0 });
    await setJob("50110", "202606", "FAILED", 1_000_000);
    expect(region(await umdStats(JEJU), B).priceStatus).toBe("INCOMPLETE_DATA");
    await setJob("50110", "202606", "SUCCESS", 900_000);
    await pool.query("DELETE FROM apartments WHERE apartment_id = $1", [empty]);
  });

  it("P3-TC-014 an even count averages the two middle values", async () => {
    expect(region(await umdStats(SEOGWIPO), D).medianPricePerM2Won).toBe(5_500_000);
  });

  it("P3-TC-015 the denominator is the precise area, not the integer area type", async () => {
    expect(region(await umdStats(JEJU), A).medianPricePerM2Won).not.toBe(Math.round(550_000_000 / 84));
  });

  it("P3-TC-016 period prices never re-aggregate monthly medians", async () => {
    // Monthly medians 8M (Mar) and 5M (Apr) would average to 6.5M; raw median is 5.5M.
    expect(region(await umdStats(SEOGWIPO), D).medianPricePerM2Won).toBe(5_500_000);
  });

  it("P3-TC-017 city count = its eup/myeon/dong + isolated deals", async () => {
    await sale(null, "2026-02-10", 400_000_000); // unmatched
    const city = await ok("statistics", { level: "city", period: "12" });
    const umd = await umdStats(JEJU);
    const u = city.unmapped["50110"];
    expect(umd.regions.reduce((n: number, r: any) => n + r.tradeCount, 0)).toBe(u.mapped);
    expect(u.mapped + u.unmatched + u.codeConflict + u.codeNotInSet).toBe(u.total);
    expect(u.unmatched).toBe(1);
    expect(region(city, JEJU).tradeCount).toBe(u.mapped);
  });

  it("P3-TC-018 the 12-month change needs >= 3 deals on each side", async () => {
    expect(region(await umdStats(JEJU), A).change).toMatchObject({ status: "AVAILABLE", previousMedianWon: 5_000_000, recentCount: 3, previousCount: 3 });
  });

  it("P3-TC-019 2 deals on one side hide the change", async () => {
    expect(region(await umdStats(JEJU), C).change).toMatchObject({ status: "INSUFFICIENT_SAMPLE", pct: null, recentCount: 2 });
  });

  it("P3-TC-020 a missing collection month makes that city's statistics unconfirmed", async () => {
    await setJob("50130", "202604", "FAILED", 800_000);
    const s = await umdStats(SEOGWIPO);
    expect(region(s, D)).toMatchObject({ priceStatus: "INCOMPLETE_DATA", medianPricePerM2Won: null, countStatus: "INCOMPLETE" });
    expect(s.dataStatus.missingMonths).toEqual(["202604"]);
    expect(region(await umdStats(JEJU), A).priceStatus).toBe("AVAILABLE");
    await setJob("50130", "202604", "SUCCESS", 700_000);
  });

  // ---- 데이터 품질 (021~025) ----
  it("P3-TC-021 cancelled deals are excluded", async () => {
    const tx = await sale(aptA, "2026-07-01", 990_000_000);
    expect(region(await umdStats(JEJU), A).tradeCount).toBe(4);
    await pool.query("UPDATE transactions SET record_status = 'CANCELLED', cancelled_on = contract_date WHERE transaction_id = $1", [tx]);
    expect(region(await umdStats(JEJU), A).tradeCount).toBe(3);
  });

  it("P3-TC-022 a corrected deal counts once at its latest value", async () => {
    const old = await sale(aptD, "2026-06-01", 100_000_000, { sgg: "50130" });
    await pool.query("UPDATE transactions SET record_status = 'MISSING_FROM_SOURCE' WHERE transaction_id = $1", [old]); // superseded
    const fixed = await sale(aptD, "2026-06-01", 700_000_000, { sgg: "50130" });
    const d = region(await umdStats(SEOGWIPO), D);
    expect(d.tradeCount).toBe(5);
    expect(d.medianPricePerM2Won).toBe(6_000_000); // 4,5,6,7,8 → 6
    await pool.query("UPDATE transactions SET record_status = 'CANCELLED', cancelled_on = contract_date WHERE transaction_id = $1", [fixed]);
  });

  it("P3-TC-023 re-collected rows are never stored twice", async () => {
    await expect(pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, sale_price)
       SELECT trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, sale_price FROM transactions WHERE natural_key = 'tc3-1'`,
    )).rejects.toThrow(/duplicate key/);
    expect(region(await umdStats(JEJU), A).tradeCount).toBe(3);
  });

  it("P3-TC-024 deals of unconfirmed complexes are excluded from region statistics", async () => {
    const before = region(await umdStats(JEJU), A).tradeCount;
    await sale(null, "2026-08-01", 400_000_000, { umd: "10100" });
    expect(region(await umdStats(JEJU), A).tradeCount).toBe(before);
  });

  it("P3-TC-025 deals whose region mapping is on hold are excluded", async () => {
    const s = await ok("statistics", { level: "city", period: "12" });
    const u = s.unmapped["50110"];
    expect(region(s, JEJU).tradeCount).toBe(u.total - u.unmatched - u.codeConflict - u.codeNotInSet);
  });

  // ---- 지도 분위 (026~030) ----
  it("P3-TC-026 eligible regions split into quantile classes", () => {
    const { legend } = quantileClasses(new Map([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => [`r${v}`, v])));
    expect(legend.classes.map((c) => c.count)).toEqual([2, 2, 2, 2, 2]);
  });

  it("P3-TC-027 tied regions always share a class", () => {
    const vals = [3, 3, 3, 3, 3, 3, 7, 8, 9, 10];
    const { classOf } = quantileClasses(new Map(vals.map((v, i) => [`r${i}`, v])));
    expect(new Set(vals.map((v, i) => (v === 3 ? classOf.get(`r${i}`) : -1)).filter((c) => c !== -1)).size).toBe(1);
  });

  it("P3-TC-028 fewer than 5 eligible regions give fewer classes", async () => {
    expect((await umdStats(JEJU)).legend).toMatchObject({ eligibleRegionCount: 1, effectiveClassCount: 1 });
    expect(quantileClasses(new Map([["a", 1], ["b", 2]])).legend.effectiveClassCount).toBe(2);
  });

  it("P3-TC-029 changing the period or scope recomputes the legend", async () => {
    const p12 = await umdStats(JEJU, { metric: "trade_count" });
    const p36 = await umdStats(JEJU, { metric: "trade_count", period: "36" });
    expect(p36.legend.classes.map((c: any) => c.max)).not.toEqual(p12.legend.classes.map((c: any) => c.max));
    const seog = await umdStats(SEOGWIPO, { metric: "trade_count" });
    expect(seog.legend.eligibleRegionCount).toBe(1);
  });

  it("P3-TC-030 regions with too few deals get no price colour", async () => {
    expect(region(await umdStats(JEJU), C).class).toBeNull();
    expect(region(await umdStats(JEJU), B).class).toBeNull();
  });

  // ---- 버전·캐시 (031~035) ----
  it("P3-TC-031 the same snapshot returns identical results", async () => {
    expect(await umdStats(JEJU)).toEqual(await umdStats(JEJU));
  });

  it("P3-TC-032 a new deal changes the snapshot and only the affected region", async () => {
    const before = await umdStats(JEJU);
    const seogBefore = await umdStats(SEOGWIPO);
    await sale(aptC, "2026-09-01", 320_000_000);
    const after = await umdStats(JEJU);
    expect(after.snapshotId).not.toBe(before.snapshotId);
    expect(region(after, C)).toMatchObject({ tradeCount: 3, priceStatus: "AVAILABLE" });
    // A's numbers are untouched; only its class may move because C joined the eligible regions.
    const { class: _a, ...aAfter } = region(after, A);
    const { class: _b, ...aBefore } = region(before, A);
    expect(aAfter).toEqual(aBefore);
    expect(region(await umdStats(SEOGWIPO), D)).toEqual(region(seogBefore, D));
  });

  it("P3-TC-033 a past correction or cancellation invalidates the old snapshot (409)", async () => {
    const before = await umdStats(JEJU);
    await pool.query("UPDATE transactions SET record_status = 'CANCELLED', cancelled_on = contract_date WHERE natural_key = 'tc3-4'"); // 2025-01 A deal
    expect((await api("detail", { regionId: A, period: "12", snapshotId: before.snapshotId })).status).toBe(409);
    expect(region(await umdStats(JEJU), A).change.previousCount).toBe(2);
  });

  it("P3-TC-034 a failed reload keeps serving the previous verified set", async () => {
    const statusBefore = await ok("status");
    const failed = await saveRegionSet(pool, META, buildRegionSet(parseCodeCsv(CODES), files(FEATURES.slice(0, 1)), 20));
    expect(failed.status).toBe("REJECTED");
    await expect(activateRegionSet(pool, failed.setId)).rejects.toThrow();
    const statusAfter = await ok("status");
    expect(statusAfter.regionSet.setId).toBe(statusBefore.regionSet.setId);
    expect((await ok("boundaries", { level: "city" })).features).toHaveLength(4);
  });

  it("P3-TC-035 statistics and legend of different versions are never mixed", async () => {
    const s = await umdStats(JEJU);
    await sale(aptA, "2026-09-15", 610_000_000);
    expect((await api("compare", { regionIds: `${A},${C}`, period: "12", snapshotId: s.snapshotId })).status).toBe(409);
    const fresh = await umdStats(JEJU);
    expect(fresh.legend.classes.reduce((n: number, c: any) => n + c.count, 0)).toBe(fresh.legend.eligibleRegionCount);
  });

  // ---- API·장애·회귀 (036~040) ----
  it("P3-TC-036 two regions are compared over the same period and snapshot", async () => {
    const s = await umdStats(JEJU);
    const cmp = await ok("compare", { regionIds: `${A},${D}`, period: "12", snapshotId: s.snapshotId });
    expect(cmp.snapshotId).toBe(s.snapshotId);
    expect(cmp.regions.map((r: any) => r.regionId)).toEqual([A, D]);
    expect(cmp.regions.every((r: any) => r.dataStatus && r.change)).toBe(true);
  });

  it("P3-TC-037 invalid arguments answer 400", async () => {
    for (const [view, q] of [["statistics", { period: "6" }], ["statistics", { metric: "avg" }], ["statistics", { level: "legal_dong" }], ["compare", { regionIds: A }], ["detail", { regionId: "abc" }], ["apartments", { regionId: A, pageSize: "500" }], ["apartments", { regionId: A, cursor: "x.y" }]] as const) {
      expect((await api(view, q as Record<string, string>)).status, `${view} ${JSON.stringify(q)}`).toBe(400);
    }
  });

  it("P3-TC-038 without the map, the region list and statistics still answer (table fallback)", async () => {
    expect((await ok("list")).regions).toHaveLength(2);
    expect((await umdStats(JEJU)).regions).toHaveLength(3);
    // The UI fallback itself (no map key → notice + table) is covered by tests/e2e/phase3.e2e.mjs.
  });

  it("P3-TC-039 with the flag off every view answers 404 before touching the database", async () => {
    // Covered in tests/phase3/api.test.ts (8 views, DATABASE_URL emptied) and the OFF part of the E2E.
    const { isPhase3Enabled } = await import("../../server/phase3/flag");
    expect(isPhase3Enabled({ PHASE3_REGION_ANALYSIS_ENABLED: "false" })).toBe(false);
    expect(isPhase3Enabled({})).toBe(false);
  });

  it("P3-TC-040 Phase 1 and Phase 2 keep working on the same database", async () => {
    const p1 = await listTransactions(pool, aptA, { type: "sale" }, NOW);
    expect(p1.status).toBe(200);
    const p2 = await handleAnalysis(pool, aptA, "summary", { areaType: "84" }, { now: NOW });
    expect(p2.status).toBe(200);
    // Phase 3 reads only: no Phase 1 row was written by any v3 call above.
    const v3Writes = await pool.query("SELECT count(*)::int n FROM transactions WHERE natural_key NOT LIKE 'tc3-%'");
    expect(v3Writes.rows[0].n).toBe(0);
  });
});
