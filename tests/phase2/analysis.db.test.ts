import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../../server/db";
import { migrate } from "../../scripts/migrate";
import {
  dataVersion, defaultArea, loadAnalysis, loadEvidencePage, loadPoints, periodWindow, withSnapshot,
  type AreaSel, type Period,
} from "../../server/phase2/analysis";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-25T03:00:00Z"); // KST 2026-10-25 → 12-month window 2025-11..2026-10
const E7 = 10_000_000;

describe("periodWindow", () => {
  it("counts KST contract months including the current one, half-open dates", () => {
    const w = periodWindow(12, NOW);
    expect(w.months[0]).toBe("202511");
    expect(w.currentMonth).toBe("202610");
    expect([w.from, w.to]).toEqual(["2025-11-01", "2026-11-01"]);
    expect(periodWindow(36, NOW).from).toBe("2023-11-01");
    // 2026-10-31T16:00Z is already November in Korea.
    expect(periodWindow(12, new Date("2026-10-31T16:00:00Z")).currentMonth).toBe("202611");
  });
});

describe.skipIf(!url)("phase2 analysis (DB)", () => {
  let pool: pg.Pool;
  let seq = 0;
  const apt = async (name: string, city = "50110") =>
    String((await pool.query(
      "INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, location_status) VALUES ($1,$2,$3,$4,'NONE') RETURNING apartment_id",
      [name, city, `${city}10100`, `${name} 1`],
    )).rows[0].apartment_id);
  const sale = async (aptId: string | null, date: string, price: number, area = 84.97, o: { status?: string; floor?: number; city?: string } = {}) =>
    String((await pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, floor,
         sale_price, record_status, cancelled_on)
       VALUES ('sale',$1,1,$2,$3,'동','단지',$4,$5,$6,$7,$8,$9) RETURNING transaction_id`,
      [`k${++seq}`, aptId, o.city ?? "50110", date, area, o.floor ?? 5, price, o.status ?? "ACTIVE", o.status === "CANCELLED" ? date : null],
    )).rows[0].transaction_id);
  const months = periodWindow(36, NOW).months;
  const setCoverage = async (city: string, status = "SUCCESS", completedAt = new Date(NOW.getTime() - 3_600_000)) => {
    await pool.query("DELETE FROM sync_jobs WHERE city_code = $1", [city]);
    await pool.query(
      `INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at)
       SELECT 'MOLIT_SALE', $1, p, $2, $3, $3 FROM unnest($4::text[]) p`,
      [city, status, completedAt, months],
    );
  };
  const analyze = (id: string, area: AreaSel = 84, period: Period = 12, now = NOW) =>
    withSnapshot(pool, (c) => loadAnalysis(c, { apartmentId: id, area, period, now }));

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    await setCoverage("50110");
    await setCoverage("50130");
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("period median is recomputed from raw deals (not a median of medians); even counts average the middle two", async () => {
    const id = await apt("중위");
    for (const p of [1, 2, 3]) await sale(id, "2026-03-10", p * E7);
    for (const p of [100, 101, 102, 103, 104]) await sale(id, "2026-04-10", p * E7);
    const a = (await analyze(id))!;
    expect(a.summary).toMatchObject({ tradeCount: 8, medianPriceWon: 1_005_000_000, minPriceWon: E7, maxPriceWon: 104 * E7, priceStatus: "AVAILABLE" });
    expect(a.quarterly.find((q) => q.quarter === "2026Q1")).toMatchObject({ tradeCount: 3, medianPriceWon: 2 * E7, priceStatus: "AVAILABLE" });
    expect(a.quarterly.find((q) => q.quarter === "2026Q2")).toMatchObject({ tradeCount: 5, medianPriceWon: 102 * E7 });
    // Per-㎡ median uses each deal's own area.
    expect(a.summary.medianPricePerM2Won).toBe(Math.round(((100 + 101) / 2) * E7 / 84.97));
    expect(a.monthly.find((m) => m.contractMonth === "202603")).toMatchObject({ tradeCount: 3, collectionStatus: "COMPLETE" });
  });

  it("hides medians below 3 deals but shows counts and min/max", async () => {
    const id = await apt("소표본");
    await sale(id, "2026-05-01", 5 * E7);
    await sale(id, "2026-06-01", 7 * E7);
    const a = (await analyze(id))!;
    expect(a.summary).toMatchObject({ tradeCount: 2, medianPriceWon: null, medianPricePerM2Won: null, minPriceWon: 5 * E7, maxPriceWon: 7 * E7, priceStatus: "INSUFFICIENT_SAMPLE" });
    expect(a.quarterly.find((q) => q.quarter === "2026Q2")).toMatchObject({ tradeCount: 2, medianPriceWon: null, priceStatus: "INSUFFICIENT_SAMPLE" });
    expect(a.quarterly.find((q) => q.quarter === "2026Q1")!.priceStatus).toBe("NO_TRADES");
  });

  it("counts only confirmed, active sales of the area type inside the window; same-condition deals count separately", async () => {
    const id = await apt("필터");
    await sale(id, "2026-07-01", 5 * E7);
    await sale(id, "2026-07-01", 5 * E7); // same condition: kept (PRD v1.3)
    await sale(id, "2026-07-02", 6 * E7);
    await sale(id, "2026-07-03", 99 * E7, 84.97, { status: "CANCELLED" });
    await sale(id, "2026-07-03", 99 * E7, 84.97, { status: "MISSING_FROM_SOURCE" });
    await sale(null, "2026-07-03", 99 * E7); // unmatched
    await sale(id, "2026-07-03", 99 * E7, 59.98); // other area type
    await sale(id, "2025-10-31", 99 * E7); // before the 12-month window
    await pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, deposit, monthly_rent, record_status)
       VALUES ('rent','r-filter',1,$1,'50110','동','단지','2026-07-03',84.97,999000000,0,'ACTIVE')`,
      [id],
    );
    const a = (await analyze(id))!;
    expect(a.summary).toMatchObject({ tradeCount: 3, medianPriceWon: 5 * E7, maxPriceWon: 6 * E7 });
    expect(a.areas).toEqual([{ areaTypeM2: 84, tradeCount: 3 }, { areaTypeM2: 59, tradeCount: 1 }]);
    const pts = await withSnapshot(pool, (c) => loadPoints(c, id, 84, 12, NOW));
    expect(pts.points).toHaveLength(a.summary.tradeCount); // points = evidence = tradeCount
    expect(pts.points.filter((p) => p.sameConditionCount === 2)).toHaveLength(2);
    const all = (await analyze(id, "all"))!;
    expect(all.summary).toMatchObject({ tradeCount: 4, medianPriceWon: null, priceStatus: "UNAVAILABLE" });
    expect(all.comparison.status).toBe("UNAVAILABLE");
  });

  it("evidence pages are stable, without gaps or duplicates, and keep full same-condition counts across pages", async () => {
    const id = await apt("근거");
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await sale(id, `2026-08-0${1 + (i % 3)}`, 5 * E7));
    const seen: string[] = [];
    let after: { contractDate: string; transactionId: string } | undefined;
    for (;;) {
      const page = await withSnapshot(pool, (c) => loadEvidencePage(c, { apartmentId: id, area: 84, period: 12, now: NOW, pageSize: 2, after }));
      seen.push(...page.items.map((d) => d.transactionId));
      for (const d of page.items) expect(d.sameConditionCount).toBe(d.contractDate === "2026-08-03" ? 1 : 2);
      if (!page.next) break;
      after = page.next;
    }
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(5);
  });

  it("year-over-year compares the last 12 vs previous 12 contract months, each needing 3 deals", async () => {
    const id = await apt("변화율");
    for (const d of ["2025-01-10", "2025-02-10", "2025-03-10"]) await sale(id, d, 50 * E7);
    for (const d of ["2026-01-10", "2026-02-10"]) await sale(id, d, 55 * E7);
    let a = (await analyze(id, 84, 12))!;
    expect(a.comparison).toMatchObject({ status: "INSUFFICIENT_SAMPLE", changePct: null, recentTradeCount: 2, previousTradeCount: 3 });
    await sale(id, "2026-03-10", 55 * E7);
    a = (await analyze(id, 84, 12))!; // a 12-month view still gets the 24-month comparison
    expect(a.comparison).toMatchObject({ status: "AVAILABLE", changePct: 10, recentMedianWon: 55 * E7, previousMedianWon: 50 * E7 });
    expect(a.comparison.months).toEqual({ recent: ["202511", "202610"], previous: ["202411", "202510"] });
  });

  it("default area type is the most traded, smaller on ties", () => {
    expect(defaultArea([{ areaTypeM2: 59, tradeCount: 4 }, { areaTypeM2: 84, tradeCount: 4 }])).toBe(59);
    expect(defaultArea([])).toBeNull();
  });

  it("missing collection months are never shown as zero and block period stats and comparison", async () => {
    const id = await apt("누락", "50130");
    for (const d of ["2026-04-10", "2026-05-10", "2026-06-10"]) await sale(id, d, 30 * E7, 84.97, { city: "50130" });
    for (const d of ["2025-04-10", "2025-05-10", "2025-06-10"]) await sale(id, d, 30 * E7, 84.97, { city: "50130" });
    expect((await analyze(id))!.summary.priceStatus).toBe("AVAILABLE");
    await pool.query("UPDATE sync_jobs SET status = 'FAILED' WHERE city_code = '50130' AND period = '202607'");
    await pool.query("UPDATE sync_jobs SET status = 'PARTIAL' WHERE city_code = '50130' AND period = '202608'");
    try {
      const a = (await analyze(id))!;
      expect(a.monthly.find((m) => m.contractMonth === "202607")).toMatchObject({ tradeCount: null, collectionStatus: "MISSING" });
      expect(a.monthly.find((m) => m.contractMonth === "202608")).toMatchObject({ tradeCount: 0, collectionStatus: "PARTIAL" });
      expect(a.dataStatus).toMatchObject({ completeness: "INCOMPLETE", missingMonths: ["202607"], partialMonths: ["202608"] });
      expect(a.summary).toMatchObject({ tradeCount: 3, medianPriceWon: null, priceStatus: "INCOMPLETE_DATA" });
      expect(a.comparison.status).toBe("INCOMPLETE_DATA");
      expect(a.quarterly.find((q) => q.quarter === "2026Q3")!.priceStatus).toBe("INCOMPLETE_DATA");
      expect(a.quarterly.find((q) => q.quarter === "2026Q2")!.priceStatus).toBe("AVAILABLE");
    } finally {
      await setCoverage("50130");
    }
  });

  it("freshness turns STALE after more than 48 hours since the last successful collection", async () => {
    const id = await apt("최신성", "50130");
    try {
      await setCoverage("50130", "SUCCESS", new Date(NOW.getTime() - 47 * 3_600_000));
      expect((await analyze(id))!.dataStatus.freshness).toBe("FRESH");
      await setCoverage("50130", "SUCCESS", new Date(NOW.getTime() - 49 * 3_600_000));
      expect((await analyze(id))!.dataStatus.freshness).toBe("STALE");
    } finally {
      await setCoverage("50130");
    }
  });

  it("dataVersion is stable for the same data and changes with deals, cancellation, matching and collection status", async () => {
    const id = await apt("버전");
    const other = await apt("다른단지");
    const tx = await sale(id, "2026-09-01", 40 * E7);
    const v = async () => (await analyze(id))!.dataStatus.dataVersion;
    const v0 = await v();
    expect(await v()).toBe(v0);
    await sale(other, "2026-09-01", 40 * E7);
    expect(await v()).toBe(v0); // another complex does not matter
    await sale(id, "2026-09-02", 41 * E7);
    const v1 = await v();
    expect(v1).not.toBe(v0);
    await pool.query("UPDATE transactions SET record_status = 'CANCELLED', cancelled_on = contract_date WHERE transaction_id = $1", [tx]);
    const v2 = await v();
    expect(v2).not.toBe(v1);
    await pool.query("UPDATE transactions SET apartment_id = NULL WHERE apartment_id = $1", [id]);
    const v3 = await v();
    expect(v3).not.toBe(v2);
    await pool.query("UPDATE sync_jobs SET completed_at = completed_at + interval '1 second' WHERE city_code = '50110' AND period = '202609'");
    expect(await v()).not.toBe(v3);
    const direct = await withSnapshot(pool, (c) => dataVersion(c, id, "50110", "2023-11-01", "2026-11-01", months));
    expect(direct).toMatch(/^[0-9a-f]{16}$/);
  });

  it("one snapshot sees no concurrent changes, cannot write, and has a statement timeout", async () => {
    const id = await apt("스냅샷");
    for (const d of ["2026-02-01", "2026-02-02", "2026-02-03"]) await sale(id, d, 20 * E7);
    await withSnapshot(pool, async (c) => {
      const before = await loadAnalysis(c, { apartmentId: id, area: 84, period: 12, now: NOW });
      await sale(id, "2026-02-04", 90 * E7); // committed by another connection meanwhile
      const after = await loadAnalysis(c, { apartmentId: id, area: 84, period: 12, now: NOW });
      expect(after).toEqual(before);
      expect((await c.query("SHOW statement_timeout")).rows[0].statement_timeout).toBe("2s");
    });
    expect((await analyze(id))!.summary.tradeCount).toBe(4);
    await expect(withSnapshot(pool, (c) => c.query("DELETE FROM api_usage"))).rejects.toThrow(/read-only/);
  });

  it("unknown apartments return null", async () => {
    expect(await analyze("999999999")).toBeNull();
  });
});
