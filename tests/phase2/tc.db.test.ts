// P2-TASK-006: the 30 required test cases of docs/phase2/TEST_PLAN.md, one test per P2-TC id.
// Data-quality cases (011~016) run the real Phase 1 collector (fake data.go.kr) and matcher, then read
// the result through the Phase 2 API handler, so the analysis is checked against what Phase 1 stores.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../../server/db";
import { migrate } from "../../scripts/migrate";
import { createBudget } from "../../server/collect/budget";
import { collect } from "../../server/collect/collector";
import type { Fetcher } from "../../server/collect/molit";
import { runMatching } from "../../server/match/run";
import { listTransactions } from "../../server/handlers/transactions";
import { handleAnalysis } from "../../server/phase2/handlers";
import { periodWindow, withSnapshot } from "../../server/phase2/analysis";
import { responseXml, saleItem, type Item } from "../helpers/molitFixture";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-25T03:00:00Z");
const SECRET = "tc-cursor-secret-0123456789abcdefghij";
const E7 = 10_000_000;

describe.skipIf(!url)("Phase 2 required test cases (DB)", () => {
  let pool: pg.Pool;
  let seq = 0;
  // Direct-insert cases use 서귀포시 (50130); collector cases use 제주시 (50110) so a collection run never
  // marks directly inserted rows as missing from the source.
  const apt = async (name: string, city = "50130", pnu: string | null = null) =>
    String((await pool.query(
      "INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, pnu, location_status) VALUES ($1,$2,$3,$4,$5,'NONE') RETURNING apartment_id",
      [name, city, pnu ? pnu.slice(0, 10) : `${city}10100`, `${name} 1`, pnu],
    )).rows[0].apartment_id);
  const sale = async (aptId: string | null, date: string, price: number, area = 84.97, floor = 5) =>
    String((await pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, floor, sale_price)
       VALUES ('sale',$1,1,$2,'50130','동','단지',$3,$4,$5,$6) RETURNING transaction_id`,
      [`tc${++seq}`, aptId, date, area, floor, price],
    )).rows[0].transaction_id);
  const api = async (id: string, view: string, query: Record<string, string> = {}) => {
    const r = await handleAnalysis(pool, id, view, query, { cursorSecret: SECRET, now: NOW });
    return { status: r.status, body: r.body as any };
  };
  const ok = async (id: string, view: string, query: Record<string, string> = {}) => {
    const r = await api(id, view, query);
    expect(r.status, `${view} ${JSON.stringify(query)} ${JSON.stringify(r.body)}`).toBe(200);
    return r.body;
  };
  const allEvidence = async (id: string, q: Record<string, string>) => {
    const items: any[] = [];
    let cursor: string | null = null;
    do {
      const b = await ok(id, "transactions", { ...q, pageSize: "2", ...(cursor ? { cursor } : {}) });
      items.push(...b.items);
      cursor = b.nextCursor;
    } while (cursor);
    return items;
  };
  const months36 = periodWindow(36, NOW).months;
  const setJob = (city: string, period: string, status: string, at = new Date(NOW.getTime() - 3_600_000)) =>
    pool.query(
      `INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at) VALUES ('MOLIT_SALE',$1,$2,$3,$4,$4)`,
      [city, period, status, at],
    );

  // Fake data.go.kr keyed by "<city>:<yyyymm>"; "RESET" simulates a network failure.
  const source = (data: Record<string, Item[] | "RESET">): Fetcher =>
    (async (u: string) => {
      const q = new URL(u).searchParams;
      const v = data[`${q.get("LAWD_CD")}:${q.get("DEAL_YMD")}`] ?? [];
      if (v === "RESET") throw new TypeError("fetch failed");
      return { status: 200, text: responseXml(v, v.length) };
    }) as Fetcher;
  const collectSales = async (data: Record<string, Item[] | "RESET">, months: string[]) => {
    await collect(pool, {
      months, cities: ["50110"], sources: ["MOLIT_SALE"], serviceKey: "FAKE-SERVICE-KEY-1234567890==", fetcher: source(data), retryDelaysMs: [0, 0],
      budget: createBudget(pool, { dailyLimit: 1000, runLimit: 100 }),
    });
    await runMatching(pool);
  };
  // saleItem() lies on parcel 5011012500113940001 (오라이동 1394-1).
  const PNU_A = "5011012500113940001";
  const PNU_B = "5011012500100070000"; // 오라이동 7
  let hillA: string;
  let hillB: string;

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    for (const city of ["50110", "50130"]) for (const m of months36) await setJob(city, m, "SUCCESS");
    hillA = await apt("테스트하이츠", "50110", PNU_A);
    hillB = await apt("테스트하이츠", "50110", PNU_B); // same name, another parcel (TC-015)
  });
  afterAll(async () => {
    await pool?.end();
  });

  // ---- 단위 P2-TC-001~010 ----
  it("P2-TC-001 area type is the integer part: 84.49→84, 84.9999→84, 85.00→85", async () => {
    const id = await apt("TC001");
    for (const a of [84.49, 84.9999, 85.0]) await sale(id, "2026-09-01", 50 * E7, a);
    const b = await ok(id, "areas");
    expect(b.areas).toEqual([{ areaTypeM2: 84, tradeCount: 2 }, { areaTypeM2: 85, tradeCount: 1 }]);
  });

  it("P2-TC-002 no rounding: 84.50→84, 84.91→84", async () => {
    const id = await apt("TC002");
    for (const a of [84.5, 84.91]) await sale(id, "2026-09-01", 50 * E7, a);
    expect((await ok(id, "areas")).areas).toEqual([{ areaTypeM2: 84, tradeCount: 2 }]);
  });

  it("P2-TC-003 median of 3 deals is the middle value", async () => {
    const id = await apt("TC003");
    for (const p of [10, 60, 20]) await sale(id, "2026-09-01", p * E7);
    expect((await ok(id, "summary", { areaType: "84" })).summary).toMatchObject({ tradeCount: 3, medianPriceWon: 20 * E7, priceStatus: "AVAILABLE" });
  });

  it("P2-TC-004 median of 4 deals averages the middle two", async () => {
    const id = await apt("TC004");
    for (const p of [10, 90, 20, 30]) await sale(id, "2026-09-01", p * E7);
    expect((await ok(id, "summary", { areaType: "84" })).summary.medianPriceWon).toBe(25 * E7);
  });

  it("P2-TC-005 a quarter with 2 deals hides its median line but shows the count", async () => {
    const id = await apt("TC005");
    for (const d of ["2026-07-01", "2026-08-01"]) await sale(id, d, 50 * E7);
    const q = (await ok(id, "monthly", { areaType: "84", period: "12" })).quarterly.find((x: any) => x.quarter === "2026Q3");
    expect(q).toEqual({ quarter: "2026Q3", tradeCount: 2, medianPriceWon: null, priceStatus: "INSUFFICIENT_SAMPLE", complete: true });
  });

  it("P2-TC-006 a quarter with 3 deals shows its median line", async () => {
    const id = await apt("TC006");
    for (const [d, p] of [["2026-07-01", 40], ["2026-08-01", 50], ["2026-09-01", 70]] as const) await sale(id, d, p * E7);
    const q = (await ok(id, "monthly", { areaType: "84", period: "12" })).quarterly.find((x: any) => x.quarter === "2026Q3");
    expect(q).toMatchObject({ tradeCount: 3, medianPriceWon: 50 * E7, priceStatus: "AVAILABLE" });
  });

  it("P2-TC-007 price per ㎡ uses each deal's original area (median of price/area)", async () => {
    const id = await apt("TC007");
    await sale(id, "2026-09-01", 840_000_000, 84.0); // 10,000,000/㎡
    await sale(id, "2026-09-02", 849_000_000, 84.9); // 10,000,000/㎡
    await sale(id, "2026-09-03", 845_000_000, 84.5); // 10,000,000/㎡ — any rounding of area to 84 would change this
    const s = (await ok(id, "summary", { areaType: "84" })).summary;
    expect(s.medianPricePerM2Won).toBe(10_000_000);
  });

  it("P2-TC-008 year-over-year = last 12 vs previous 12 contract months medians", async () => {
    const id = await apt("TC008");
    for (const d of ["2025-03-01", "2025-04-01", "2025-05-01"]) await sale(id, d, 40 * E7);
    for (const d of ["2026-03-01", "2026-04-01", "2026-05-01"]) await sale(id, d, 50 * E7);
    const b = await ok(id, "summary", { areaType: "84" });
    expect(b.summary).toMatchObject({ yearOverYearChangePct: 25, comparisonStatus: "AVAILABLE" });
    expect(b.comparison).toMatchObject({ recentMedianWon: 50 * E7, previousMedianWon: 40 * E7, months: { recent: ["202511", "202610"], previous: ["202411", "202510"] } });
  });

  it("P2-TC-009 2 deals in either period → no comparison", async () => {
    const id = await apt("TC009");
    for (const d of ["2025-03-01", "2025-04-01"]) await sale(id, d, 40 * E7);
    for (const d of ["2026-03-01", "2026-04-01", "2026-05-01"]) await sale(id, d, 50 * E7);
    const b = await ok(id, "summary", { areaType: "84" });
    expect(b.summary).toMatchObject({ yearOverYearChangePct: null, comparisonStatus: "INSUFFICIENT_SAMPLE" });
    expect(b.comparison).toMatchObject({ recentTradeCount: 3, previousTradeCount: 2, recentMedianWon: null });
  });

  it("P2-TC-010 'all' gives total volume only — no prices, no points, no evidence", async () => {
    const id = await apt("TC010");
    for (const a of [59.9, 84.9, 84.9, 84.9]) await sale(id, "2026-09-01", 50 * E7, a);
    const b = await ok(id, "summary", { areaType: "all" });
    expect(b.summary).toMatchObject({ tradeCount: 4, medianPriceWon: null, minPriceWon: null, maxPriceWon: null, medianPricePerM2Won: null, priceStatus: "UNAVAILABLE" });
    expect((await ok(id, "monthly", { areaType: "all" })).quarterly).toEqual([]);
    expect((await api(id, "points", { areaType: "all" })).status).toBe(400);
    expect((await api(id, "transactions", { areaType: "all" })).status).toBe(400); // evidence lists prices
  });

  // ---- 데이터 품질 P2-TC-011~020 (011~016: Phase 1 collector + matcher) ----
  it("P2-TC-011 cancelled deals are excluded", async () => {
    const a = saleItem({ dealDay: "1", dealAmount: "50,000" });
    const b = saleItem({ dealDay: "2", dealAmount: "51,000" });
    await collectSales({ "50110:202608": [a, b] }, ["202608"]);
    expect((await ok(hillA, "summary", { areaType: "84" })).summary.tradeCount).toBe(2);
    await collectSales({ "50110:202608": [a, { ...b, cdealType: "O", cdealDay: "26.09.28" }] }, ["202608"]);
    const s = await ok(hillA, "summary", { areaType: "84" });
    expect(s.summary.tradeCount).toBe(1);
    expect((await ok(hillA, "points", { areaType: "84" })).points.map((p: any) => p.priceWon)).toEqual([500_000_000]);
  });

  it("P2-TC-012 a corrected deal counts once, at its latest value", async () => {
    // A correction arrives as the old row gone and the new values present (Phase 1 marks the old one missing).
    const a = saleItem({ dealDay: "1", dealAmount: "50,000" });
    await collectSales({ "50110:202608": [a, saleItem({ dealDay: "3", dealAmount: "60,000" })] }, ["202608"]);
    await collectSales({ "50110:202608": [a, saleItem({ dealDay: "3", dealAmount: "61,000" })] }, ["202608"]);
    const pts = (await ok(hillA, "points", { areaType: "84" })).points.map((p: any) => p.priceWon).sort();
    expect(pts).toEqual([500_000_000, 610_000_000]);
  });

  it("P2-TC-013 re-collecting the same month does not duplicate deals", async () => {
    const src = { "50110:202608": [saleItem({ dealDay: "1", dealAmount: "50,000" }), saleItem({ dealDay: "1", dealAmount: "50,000" })] };
    await collectSales(src, ["202608"]);
    const first = await ok(hillA, "points", { areaType: "84" });
    await collectSales(src, ["202608"]);
    const second = await ok(hillA, "points", { areaType: "84" });
    expect(second.points).toEqual(first.points);
    expect(second.points).toHaveLength(2); // two identical source rows are two deals (v1.3)
    expect(second.points.every((p: any) => p.sameConditionCount === 2)).toBe(true);
  });

  it("P2-TC-014 deals whose match is pending are excluded", async () => {
    const pending = saleItem({ aptSeq: "50110-9004", dealDay: "4", dealAmount: "70,000", bonbun: "9999", bubun: "0000", jibun: "9999" }); // parcel not in reference
    await collectSales({ "50110:202608": [saleItem({ dealDay: "1", dealAmount: "50,000" }), pending] }, ["202608"]);
    const r = await pool.query("SELECT count(*)::int n FROM match_reviews WHERE match_status = 'PENDING'");
    expect(r.rows[0].n).toBeGreaterThan(0);
    expect((await ok(hillA, "points", { areaType: "84" })).points.map((p: any) => p.priceWon)).toEqual([500_000_000]);
  });

  it("P2-TC-015 two complexes with the same name are never mixed", async () => {
    const other = saleItem({ aptSeq: "50110-9005", dealDay: "5", dealAmount: "90,000", bonbun: "0007", bubun: "0000", jibun: "7" });
    await collectSales({ "50110:202608": [saleItem({ dealDay: "1", dealAmount: "50,000" }), other] }, ["202608"]);
    expect((await ok(hillA, "points", { areaType: "84" })).points.map((p: any) => p.priceWon)).toEqual([500_000_000]);
    expect((await ok(hillB, "points", { areaType: "84" })).points.map((p: any) => p.priceWon)).toEqual([900_000_000]);
  });

  it("P2-TC-016 a month whose collection failed is unknown (null), not zero", async () => {
    await collectSales({ "50110:202607": "RESET" }, ["202607"]);
    const m = (await ok(hillA, "monthly", { areaType: "84", period: "12" })).monthly.find((x: any) => x.contractMonth === "202607");
    expect(m).toMatchObject({ tradeCount: null, collectionStatus: "MISSING" });
    const s = await ok(hillA, "summary", { areaType: "84", period: "12" });
    expect(s.summary).toMatchObject({ priceStatus: "INCOMPLETE_DATA", medianPriceWon: null });
    expect(s.dataStatus).toMatchObject({ completeness: "INCOMPLETE", missingMonths: ["202607"] });
    await collectSales({ "50110:202607": [] }, ["202607"]); // recovery for the following cases
  });

  it("P2-TC-017 a successfully collected month with no deals shows 0", async () => {
    await collectSales({ "50110:202606": [] }, ["202606"]);
    const m = (await ok(hillA, "monthly", { areaType: "84", period: "12" })).monthly.find((x: any) => x.contractMonth === "202606");
    expect(m).toMatchObject({ tradeCount: 0, collectionStatus: "COMPLETE" });
  });

  it("P2-TC-018 the current contract month is flagged provisional", async () => {
    const id = await apt("TC018");
    await sale(id, "2026-10-20", 50 * E7);
    const b = await ok(id, "monthly", { areaType: "84", period: "12" });
    expect(b.monthly.at(-1)).toMatchObject({ contractMonth: "202610", isCurrentMonth: true, tradeCount: 1 });
    expect(b.monthly.filter((x: any) => x.isCurrentMonth)).toHaveLength(1);
    expect(b.dataStatus.provisionalCurrentMonth).toBe(true);
  });

  it("P2-TC-019 zero price or zero area can never enter the statistics", async () => {
    const id = await apt("TC019");
    await expect(sale(id, "2026-09-01", 0)).rejects.toThrow(/check constraint/);
    await expect(sale(id, "2026-09-01", 50 * E7, 0)).rejects.toThrow(/check constraint/);
    expect((await ok(id, "summary", { areaType: "all" })).summary.tradeCount).toBe(0);
  });

  it("P2-TC-020 a missing month anywhere in 36 months blocks the 36-month statistics only", async () => {
    const id = await apt("TC020");
    for (const d of ["2026-07-01", "2026-08-01", "2026-09-01"]) await sale(id, d, 50 * E7);
    const old = months36[2]!; // 34 months ago
    await setJob("50130", old, "FAILED", new Date(NOW.getTime() - 1_800_000));
    try {
      const s36 = await ok(id, "summary", { areaType: "84", period: "36" });
      expect(s36.summary).toMatchObject({ tradeCount: 3, medianPriceWon: null, minPriceWon: null, priceStatus: "INCOMPLETE_DATA" });
      expect(s36.dataStatus.missingMonths).toEqual([old]);
      expect((await ok(id, "summary", { areaType: "84", period: "12" })).summary).toMatchObject({ medianPriceWon: 50 * E7, priceStatus: "AVAILABLE" });
    } finally {
      await setJob("50130", old, "SUCCESS", new Date(NOW.getTime() - 1_700_000));
    }
  });

  // ---- API·캐시 P2-TC-021~030 ----
  it("P2-TC-021 the same data version returns identical results", async () => {
    const id = await apt("TC021");
    for (const p of [40, 50, 60]) await sale(id, "2026-09-01", p * E7);
    for (const view of ["summary", "monthly", "points", "areas", "status"]) {
      expect(await ok(id, view, { areaType: "84" })).toEqual(await ok(id, view, { areaType: "84" }));
    }
  });

  it("P2-TC-022 a new deal is reflected with a new data version", async () => {
    const id = await apt("TC022");
    for (const p of [40, 50, 60]) await sale(id, "2026-09-01", p * E7);
    const before = await ok(id, "summary", { areaType: "84" });
    await sale(id, "2026-10-01", 70 * E7);
    const after = await ok(id, "summary", { areaType: "84" });
    expect(after.dataVersion).not.toBe(before.dataVersion);
    expect(after.summary).toMatchObject({ tradeCount: 4, medianPriceWon: 55 * E7 });
  });

  it("P2-TC-023 a correction in a past month updates that month and quarter", async () => {
    const id = await apt("TC023");
    const ids = [];
    for (const d of ["2025-04-01", "2025-05-01", "2025-06-01"]) ids.push(await sale(id, d, 40 * E7));
    const before = await ok(id, "monthly", { areaType: "84" });
    await pool.query("UPDATE transactions SET sale_price = $2 WHERE transaction_id = $1", [ids[2], 70 * E7]);
    const after = await ok(id, "monthly", { areaType: "84" });
    expect(after.dataVersion).not.toBe(before.dataVersion);
    expect(after.quarterly.find((q: any) => q.quarter === "2025Q2").medianPriceWon).toBe(40 * E7);
    await pool.query("UPDATE transactions SET contract_date = '2025-07-01' WHERE transaction_id = $1", [ids[2]]);
    const moved = await ok(id, "monthly", { areaType: "84" });
    expect(moved.monthly.find((m: any) => m.contractMonth === "202506").tradeCount).toBe(0);
    expect(moved.monthly.find((m: any) => m.contractMonth === "202507").tradeCount).toBe(1);
    expect(moved.quarterly.find((q: any) => q.quarter === "2025Q2")).toMatchObject({ tradeCount: 2, medianPriceWon: null });
  });

  it("P2-TC-024 after a cancellation, summary, volume and evidence agree", async () => {
    const id = await apt("TC024");
    const ids = [];
    for (const d of ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]) ids.push(await sale(id, d, 50 * E7));
    await pool.query("UPDATE transactions SET record_status = 'CANCELLED', cancelled_on = '2026-09-10' WHERE transaction_id = $1", [ids[1]]);
    const q = { areaType: "84" };
    const s = await ok(id, "summary", q);
    const vol = (await ok(id, "monthly", q)).monthly.reduce((n: number, m: any) => n + (m.tradeCount ?? 0), 0);
    const ev = await allEvidence(id, q);
    expect([s.summary.tradeCount, vol, ev.length]).toEqual([3, 3, 3]);
    expect(ev.map((d) => d.transactionId)).not.toContain(ids[1]);
  });

  it("P2-TC-025 a failing analysis returns a safe error and leaves Phase 1 working", async () => {
    const id = await apt("TC025");
    await sale(id, "2026-09-01", 50 * E7);
    // Hold a lock so the analysis hits its 2-second statement timeout.
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN; LOCK TABLE transactions IN ACCESS EXCLUSIVE MODE");
      const r = await api(id, "summary", { areaType: "84" });
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe("DB_UNAVAILABLE");
      expect(JSON.stringify(r.body)).not.toMatch(/timeout|lock|transactions|SELECT/i); // no internals leak
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
    }
    const phase1 = await listTransactions(pool, id, { type: "sale" }, NOW);
    expect(phase1.status).toBe(200);
    expect((phase1.body as any).page.total).toBe(1);
  }, 15_000);

  it("P2-TC-026 the Phase 2 transaction refuses writes", async () => {
    for (const sql of ["DELETE FROM transactions", "UPDATE apartments SET name = 'x'", "INSERT INTO sync_jobs (source_id, city_code, period, status) VALUES ('MOLIT_SALE','50110','202601','SUCCESS')", "CREATE TABLE p2_x (a int)"]) {
      await expect(withSnapshot(pool, (c) => c.query(sql))).rejects.toThrow(/read-only/);
    }
  });

  it("P2-TC-027 invalid input answers 400", async () => {
    const id = await apt("TC027");
    for (const q of <Record<string, string>[]>[{ period: "6" }, { period: "x" }, { areaType: "0" }, { areaType: "84.5" }, { areaType: "-1" }, { areaType: "1001" }, { pageSize: "0" }, { pageSize: "101" }, { cursor: "x".repeat(1025) }]) {
      expect((await api(id, "transactions", q)).status, JSON.stringify(q)).toBe(400);
    }
    expect((await api("1;DROP", "summary")).status).toBe(400);
    expect((await api(id, "transactions", { areaType: "84", cursor: "abc.def" })).status).toBe(400);
  });

  it("P2-TC-028 an unknown apartment answers 404", async () => {
    for (const view of ["status", "areas", "summary", "monthly", "points", "transactions"]) {
      expect((await api("987654321", view, { areaType: "84" })).status, view).toBe(404);
    }
    expect((await api("1", "nope")).status).toBe(404);
  });

  it("P2-TC-029 cursor pages have no gaps or duplicates; a data change answers 409", async () => {
    const id = await apt("TC029");
    for (let i = 0; i < 7; i++) await sale(id, "2026-09-01", (40 + i) * E7, 84.9, i % 2 ? 3 : 5); // same date: ties broken by id
    const ev = await allEvidence(id, { areaType: "84" });
    expect(ev).toHaveLength(7);
    expect(new Set(ev.map((d) => d.transactionId)).size).toBe(7);
    const p1 = await ok(id, "transactions", { areaType: "84", pageSize: "2" });
    await sale(id, "2026-09-02", 90 * E7);
    const r = await api(id, "transactions", { areaType: "84", pageSize: "2", cursor: p1.nextCursor });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("DATA_VERSION_CHANGED");
  });

  it("P2-TC-030 one data version across all views; points = evidence = tradeCount; same-condition deals counted separately", async () => {
    const id = await apt("TC030");
    await sale(id, "2026-09-01", 50 * E7, 84.9, 7);
    await sale(id, "2026-09-01", 50 * E7, 84.9, 7); // same date, area, floor and price
    for (const d of ["2026-05-01", "2026-06-01"]) await sale(id, d, 45 * E7);
    const q = { areaType: "84", period: "24" };
    const views = await Promise.all(["status", "areas", "summary", "monthly", "points"].map((v) => ok(id, v, q)));
    const ev = await allEvidence(id, q);
    expect(new Set(views.map((v) => v.dataVersion)).size).toBe(1);
    const [, , summary, monthly, points] = views;
    expect(summary.summary.tradeCount).toBe(4);
    expect(points.points).toHaveLength(4);
    expect(ev).toHaveLength(4);
    expect(monthly.monthly.find((m: any) => m.contractMonth === "202609").tradeCount).toBe(2);
    expect(summary.summary.medianPriceWon).toBe(475_000_000);
    expect(ev.filter((d) => d.sameConditionCount === 2)).toHaveLength(2);
    expect(points.points.filter((d: any) => d.sameConditionCount === 2)).toHaveLength(2);
  });
});
