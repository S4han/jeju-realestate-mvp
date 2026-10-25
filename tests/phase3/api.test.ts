// P3-TASK-005: tie-preserving quantiles and the v3 regions API (fictional fixture, tests/phase3/fixture.ts).
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createPool } from "../../server/db";
import { migrate } from "../../scripts/migrate";
import { periodWindow } from "../../server/phase2/analysis";
import { quantileClasses } from "../../server/phase3/quantiles";
import { isPhase3Enabled } from "../../server/phase3/flag";
import { handleRegions } from "../../server/phase3/handlers";
import { activateRegionSet, buildRegionSet, parseCodeCsv, saveRegionSet } from "../../server/phase3/regionSet";
import { CODES, META, files } from "./fixture";

const SECRET = "p3-test-cursor-secret-0123456789abcdef";
const NOW = new Date("2026-10-25T03:00:00Z");
const A = "5011010100", B = "5011010200", C = "5011025000", D = "5013010100";

describe("quantile classes (TC-026/027/028/030)", () => {
  const m = (vals: number[]) => new Map(vals.map((v, i) => [`r${i}`, v]));
  it("splits 10 distinct values into 5 classes of 2", () => {
    const { classOf, legend } = quantileClasses(m([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(legend.effectiveClassCount).toBe(5);
    expect(legend.classes.map((c) => [c.min, c.max, c.count])).toEqual([[1, 2, 2], [3, 4, 2], [5, 6, 2], [7, 8, 2], [9, 10, 2]]);
    expect(classOf.get("r0")).toBe(0);
    expect(classOf.get("r9")).toBe(4);
  });
  it("never splits equal values across classes", () => {
    const vals = [1, 1, 1, 1, 2, 3, 4, 5, 5, 5];
    const { classOf, legend } = quantileClasses(m(vals));
    const byValue = new Map<number, Set<number>>();
    vals.forEach((v, i) => byValue.set(v, (byValue.get(v) ?? new Set()).add(classOf.get(`r${i}`)!)));
    for (const s of byValue.values()) expect(s.size).toBe(1);
    expect(legend.classes.reduce((n, c) => n + c.count, 0)).toBe(10);
    expect(legend.effectiveClassCount).toBeLessThanOrEqual(5);
  });
  it("uses fewer classes with fewer regions or distinct values, none when nothing is eligible", () => {
    expect(quantileClasses(m([10, 20, 30])).legend.effectiveClassCount).toBe(3);
    expect(quantileClasses(m([7, 7, 7])).legend).toMatchObject({ effectiveClassCount: 1, eligibleRegionCount: 3 });
    expect(quantileClasses(m([])).legend).toMatchObject({ effectiveClassCount: 0, eligibleRegionCount: 0, classes: [] });
  });
});

describe("phase3 feature flag", () => {
  it("is off unless exactly 'true', and the API answers 404 without touching the database (TC-039)", async () => {
    expect(isPhase3Enabled({})).toBe(false);
    expect(isPhase3Enabled({ PHASE3_REGION_ANALYSIS_ENABLED: "TRUE" })).toBe(false);
    expect(isPhase3Enabled({ PHASE3_REGION_ANALYSIS_ENABLED: "true" })).toBe(true);
    vi.stubEnv("PHASE3_REGION_ANALYSIS_ENABLED", "");
    vi.stubEnv("DATABASE_URL", "");
    try {
      const { default: handler } = await import("../../api/v3/regions/[view]");
      for (const view of ["status", "list", "boundaries", "statistics", "detail", "apartments", "compare", "trend"]) {
        const req = new IncomingMessage(new Socket()) as IncomingMessage & { query: Record<string, string> };
        req.query = { view };
        const res = new ServerResponse(req);
        let body = "";
        res.end = ((chunk?: unknown) => ((body += chunk ? String(chunk) : ""), res)) as typeof res.end;
        await handler(req, res);
        expect(res.statusCode, view).toBe(404);
        expect(JSON.parse(body)).toEqual({ error: { code: "NOT_FOUND" } });
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("v3 regions API (DB)", () => {
  let pool: pg.Pool;
  let seq = 0;
  const call = (view: string, query: Record<string, string> = {}, env: { cursorSecret?: string } = { cursorSecret: SECRET }) =>
    handleRegions(pool, view, query, { ...env, phase2Enabled: true, now: NOW }).then((r) => ({ ...r, body: r.body as any }));
  const apt = async (legal: string, name = "단지") =>
    String((await pool.query(
      "INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, location_status) VALUES ($1,$2,$3,'x','NONE') RETURNING apartment_id",
      [name, legal.slice(0, 5), legal],
    )).rows[0].apartment_id);
  const sale = (aptId: string, date: string, price: number, sgg = "50110") =>
    pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, sale_price)
       VALUES ('sale',$1,1,$2,$3,'동','단지',$4,100,$5)`,
      [`api3-${++seq}`, aptId, sgg, date, price],
    );

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("answers 503 NO_VERIFIED_SNAPSHOT until a region set is active", async () => {
    const r = await call("status");
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("NO_VERIFIED_SNAPSHOT");
    const set = await saveRegionSet(pool, META, buildRegionSet(parseCodeCsv(CODES), files(), 20));
    await activateRegionSet(pool, set.setId);
    await pool.query(
      `INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at)
       SELECT 'MOLIT_SALE', c, p, 'SUCCESS', $1, $1 FROM unnest($2::text[]) p CROSS JOIN unnest(ARRAY['50110','50130']) c`,
      [new Date(NOW.getTime() - 3_600_000), periodWindow(36, NOW).months],
    );
    // A: 4 complexes with deals (paging), C: 1 complex with 3 deals, D: 1 complex with 2 deals, B: none.
    for (let i = 0; i < 4; i++) {
      const id = await apt(A, `A단지${i}`);
      for (let k = 0; k < 3; k++) await sale(id, `2026-0${3 + i}-1${k}`, (50 + i) * 10_000_000);
    }
    const c = await apt("5011025021", "C단지");
    for (const d of ["2026-01-05", "2026-02-05", "2026-03-05"]) await sale(c, d, 30 * 10_000_000);
    const d = await apt(D, "D단지");
    for (const day of ["2026-05-05", "2026-06-05"]) await sale(d, day, 40 * 10_000_000, "50130");
  });

  it("rejects invalid arguments with 400 (TC-037)", async () => {
    const bad: [string, Record<string, string>][] = [
      ["statistics", { level: "legal_dong" }],
      ["statistics", { level: "city", parentRegionId: "5011000000" }],
      ["statistics", { level: "region" }],
      ["statistics", { period: "18" }],
      ["statistics", { metric: "mean" }],
      ["statistics", { level: "legal_dong", parentRegionId: "5011010100" }],
      ["detail", {}],
      ["detail", { regionId: "1111010100" }],
      ["detail", { regionId: "50110101" }],
      ["compare", { regionIds: A }],
      ["compare", { regionIds: `${A},${A}` }],
      ["compare", { regionIds: `${A},x` }],
      ["apartments", { regionId: A, pageSize: "0" }],
      ["apartments", { regionId: A, pageSize: "101" }],
    ];
    for (const [view, q] of bad) expect((await call(view, q)).status, `${view} ${JSON.stringify(q)}`).toBe(400);
    expect((await call("nope")).status).toBe(404);
    expect((await call("detail", { regionId: "5011099900" })).status).toBe(404); // valid shape, not in the set
    expect((await call("apartments", { regionId: A }, {})).status).toBe(503); // cursor secret missing
  });

  it("serves status, the region list and boundaries of the active set", async () => {
    const s = await call("status");
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ enabled: true, regionSet: { codeAsOf: "2026-06-30", boundaryAsOf: "2026-10-01" }, staleAfterHours: 48 });
    expect(s.cacheSeconds).toBe(300);
    const list = (await call("list")).body;
    expect(list.regions.map((r: any) => [r.regionId, r.children.length])).toEqual([["5011000000", 3], ["5013000000", 1]]);
    expect(list.regions[0].children.find((x: any) => x.regionId === B).hasApartments).toBe(false);
    const all = (await call("boundaries", { level: "city" })).body;
    expect(all.features).toHaveLength(4);
    expect(all.features[0].geometry.type).toBe("MultiPolygon");
    const jeju = (await call("boundaries", { level: "legal_dong", parentRegionId: "5011000000" })).body;
    expect(jeju.features.map((f: any) => f.id)).toEqual([A, B, C]);
  });

  it("classes the map per metric from the same snapshot; ineligible regions get no class (TC-009/029/030)", async () => {
    const price = (await call("statistics", { level: "legal_dong", parentRegionId: "5011000000", period: "12" })).body;
    const byId = (b: any) => Object.fromEntries(b.regions.map((r: any) => [r.regionId, r]));
    expect(byId(price)[A]).toMatchObject({ tradeCount: 12, priceStatus: "AVAILABLE" });
    expect(byId(price)[C]).toMatchObject({ tradeCount: 3, priceStatus: "AVAILABLE" });
    expect(byId(price)[B]).toMatchObject({ priceStatus: "NO_APARTMENTS", class: null });
    expect(price.legend).toMatchObject({ method: "QUANTILE_TIES_KEPT", eligibleRegionCount: 2, effectiveClassCount: 2, unit: "KRW_PER_M2" });
    const count = (await call("statistics", { level: "legal_dong", parentRegionId: "5011000000", period: "12", metric: "trade_count" })).body;
    expect(count.legend).toMatchObject({ eligibleRegionCount: 2, unit: "TRADES" });
    expect(count.snapshotId).toBe(price.snapshotId);
    expect(byId(count)[A].class).toBeGreaterThan(byId(count)[C].class); // 12 trades vs 3
    const seogwipo = (await call("statistics", { level: "legal_dong", parentRegionId: "5013000000", period: "12" })).body;
    expect(byId(seogwipo)[D]).toMatchObject({ tradeCount: 2, priceStatus: "INSUFFICIENT_SAMPLE", class: null }); // TC-030
    const cities = (await call("statistics", { level: "city", period: "12" })).body;
    expect(cities.regions.map((r: any) => [r.regionId, r.tradeCount])).toEqual([["5011000000", 15], ["5013000000", 2]]);
    // Period change → new window, new legend (TC-010/029)
    const p24 = (await call("statistics", { level: "legal_dong", parentRegionId: "5011000000", period: "24" })).body;
    expect(p24.contractPeriod.startInclusive).toBe("2024-11-01");
  });

  it("returns identical results for the same snapshot and 409 for a stale one (TC-031/035)", async () => {
    const q = { level: "legal_dong", parentRegionId: "5011000000", period: "12" };
    const a = await call("statistics", q);
    expect((await call("statistics", q)).body).toEqual(a.body);
    expect((await call("detail", { regionId: A, period: "12", snapshotId: a.body.snapshotId })).status).toBe(200);
    expect((await call("detail", { regionId: A, period: "12", snapshotId: "1-0000000000000000" })).status).toBe(409);
  });

  it("compares two regions from one snapshot and period (TC-036) and serves detail and trend", async () => {
    const cmp = (await call("compare", { regionIds: `${A},${D}`, period: "12" })).body;
    expect(cmp.regions.map((r: any) => [r.regionId, r.tradeCount, r.priceStatus])).toEqual([[A, 12, "AVAILABLE"], [D, 2, "INSUFFICIENT_SAMPLE"]]);
    const stat = (await call("statistics", { level: "legal_dong", parentRegionId: "5011000000", period: "12" })).body;
    expect(cmp.snapshotId).toBe(stat.snapshotId);
    const detail = (await call("detail", { regionId: "5011000000", period: "12" })).body;
    expect(detail.region).toMatchObject({ level: "CITY", tradeCount: 15 });
    expect(detail.unmapped).toMatchObject({ mapped: 15, total: 15 });
    expect(detail.monthly).toHaveLength(12);
    const trend = (await call("trend", { regionId: A })).body;
    expect(trend.monthly).toHaveLength(24);
    expect(trend.change).toMatchObject({ status: "INSUFFICIENT_SAMPLE", recentCount: 12, previousCount: 0 });
  });

  it("lists traded complexes latest first with signed cursors (no gaps, tamper 400, change 409)", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    const first = (await call("apartments", { regionId: A, period: "12", pageSize: "3" })).body;
    expect(first.items[0]).toMatchObject({ name: "A단지3", tradeCount: 3, lastContractDate: "2026-06-12", links: { detail: expect.stringMatching(/^#\/apartments\/\d+$/) } });
    do {
      const r: any = (await call("apartments", { regionId: A, period: "12", pageSize: "3", ...(cursor ? { cursor } : {}) })).body;
      seen.push(...r.items.map((x: any) => x.name));
      cursor = r.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["A단지3", "A단지2", "A단지1", "A단지0"]);
    expect((await call("apartments", { regionId: A, period: "12", pageSize: "3", cursor: first.nextCursor + "x" })).status).toBe(400);
    expect((await call("apartments", { regionId: C, period: "12", pageSize: "3", cursor: first.nextCursor })).status).toBe(400);
    const cityList = (await call("apartments", { regionId: "5011000000", period: "12" })).body;
    expect(cityList.items).toHaveLength(5);
    await sale((await pool.query("SELECT apartment_id FROM apartments WHERE name = 'A단지0'")).rows[0].apartment_id, "2026-09-01", 60 * 10_000_000);
    const stale = await call("apartments", { regionId: A, period: "12", pageSize: "3", cursor: first.nextCursor });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("SNAPSHOT_MISMATCH");
  });

  it("answers 503 with a generic body when the database is unreachable", async () => {
    const down = createPool("postgres://nobody:PASSWORD@127.0.0.1:1/none", "disable");
    const r = await handleRegions(down, "status", {}, { now: NOW });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|PASSWORD/);
    await down.end();
  });
});
