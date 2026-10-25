// P3-TASK-004: region statistics on a fictional region set (tests/phase3/fixture.ts) and fictional deals.
// Regions: A 일도일동, B 일도이동 (no apartments), C 한림읍 (apartment on a ri code), D 서귀동 (서귀포시).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../../server/db";
import { migrate } from "../../scripts/migrate";
import { periodWindow, withSnapshot, type Period } from "../../server/phase2/analysis";
import { buildRegionSet, parseCodeCsv, saveRegionSet } from "../../server/phase3/regionSet";
import { loadRegionMonthly, loadRegionStats } from "../../server/phase3/statistics";
import { CODES, META, files } from "./fixture";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-25T03:00:00Z"); // current KST contract month 2026-10
const A = "5011010100", B = "5011010200", C = "5011025000", D = "5013010100";

describe.skipIf(!url)("region statistics (DB)", () => {
  let pool: pg.Pool;
  let setId: string;
  let seq = 0;
  const apts: Record<string, string> = {};
  const apt = async (legal: string) =>
    String((await pool.query(
      "INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, location_status) VALUES ('단지',$1,$2,'x','NONE') RETURNING apartment_id",
      [legal.slice(0, 5), legal],
    )).rows[0].apartment_id);
  const sale = async (aptId: string | null | undefined, date: string, priceWon: number, area = 100, o: { sgg?: string; umd?: string | null; status?: string } = {}) =>
    String((await pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_code, umd_name, apt_name_raw, contract_date, area_m2, sale_price, record_status, cancelled_on)
       VALUES ('sale',$1,1,$2,$3,$4,'동','단지',$5,$6,$7,$8,$9) RETURNING transaction_id`,
      [`st-${++seq}`, aptId, o.sgg ?? "50110", o.umd ?? null, date, area, priceWon, o.status ?? "ACTIVE", o.status === "CANCELLED" ? date : null],
    )).rows[0].transaction_id);
  const stats = (level: "CITY" | "UMD", cityCode: string | undefined, period: Period = 12, now = NOW) =>
    withSnapshot(pool, (c) => loadRegionStats(c, { setId, level, cityCode, period, now }));
  const region = (s: Awaited<ReturnType<typeof stats>>, code: string) => s.regions.find((r) => r.regionCode === code)!;

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    setId = (await saveRegionSet(pool, META, buildRegionSet(parseCodeCsv(CODES), files(), 20))).setId;
    await pool.query(
      `INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at)
       SELECT 'MOLIT_SALE', c, p, 'SUCCESS', $1, $1 FROM unnest($2::text[]) p CROSS JOIN unnest(ARRAY['50110','50130']) c`,
      [new Date(NOW.getTime() - 3_600_000), periodWindow(36, NOW).months],
    );
    apts.A = await apt("5011010100");
    apts.C = await apt("5011025021"); // ri code → 한림읍
    apts.D = await apt("5013010100");

    // A, last 12 months: precise areas matter (TC-015) — median of price/area, not of price/floor(area).
    await sale(apts.A, "2025-11-01", 500_000_000, 84.99, { umd: "10100" }); // first day of the 12-month window
    await sale(apts.A, "2026-03-10", 600_000_000, 84.01);
    await sale(apts.A, "2026-10-20", 550_000_000, 84.5); // current (provisional) month
    // A, previous 12 months (for the change rate)
    for (const d of ["2025-01-10", "2025-02-10", "2025-03-10"]) await sale(apts.A, d, 500_000_000, 100);
    // C: only 2 recent deals → count only (TC-012); 3 previous
    await sale(apts.C, "2026-05-01", 300_000_000, 100, { umd: "25021" });
    await sale(apts.C, "2026-06-01", 310_000_000, 100);
    for (const d of ["2025-04-10", "2025-05-10", "2025-06-10"]) await sale(apts.C, d, 280_000_000, 100);
    // D: unbalanced months (TC-016) and an even count (TC-014): Mar 8M/㎡; Apr 4M, 5M, 6M/㎡
    await sale(apts.D, "2026-03-05", 800_000_000, 100, { sgg: "50130" });
    for (const p of [400_000_000, 500_000_000, 600_000_000]) await sale(apts.D, "2026-04-05", p, 100, { sgg: "50130" });
    // Never counted in any region: cancelled, missing from source, unmatched, code conflict, outside the window
    await sale(apts.A, "2026-02-01", 900_000_000, 100, { status: "CANCELLED" });
    await sale(apts.A, "2026-02-02", 900_000_000, 100, { status: "MISSING_FROM_SOURCE" });
    await sale(null, "2026-02-03", 900_000_000, 100);
    await sale(apts.A, "2026-02-04", 900_000_000, 100, { umd: "10200" });
    await sale(apts.A, "2026-11-01", 900_000_000, 100); // first day after the window (half-open)
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("computes the median price per ㎡ from raw deals with their original area (TC-011/015)", async () => {
    const a = region(await stats("UMD", "50110"), A);
    const ppm = [500_000_000 / 84.99, 600_000_000 / 84.01, 550_000_000 / 84.5].sort((x, y) => x - y);
    expect(a).toMatchObject({ tradeCount: 3, priceStatus: "AVAILABLE", medianPricePerM2Won: Math.round(ppm[1]!), countStatus: "COMPLETE" });
    expect(a.medianPricePerM2Won).not.toBe(Math.round(550_000_000 / 84)); // integer area would give a different value
  });

  it("averages the middle two for even counts and never uses monthly medians (TC-014/016)", async () => {
    const d = region(await stats("UMD", "50130"), D);
    expect(d.tradeCount).toBe(4);
    expect(d.medianPricePerM2Won).toBe(5_500_000); // raw: 4,5,6,8 → 5.5; monthly medians 8 and 5 would give 6.5
  });

  it("shows 1–2 deals as a count without a price, and separates 'no apartments' from 'no trades' (TC-012/013)", async () => {
    const s = await stats("UMD", "50110");
    expect(region(s, C)).toMatchObject({ tradeCount: 2, priceStatus: "INSUFFICIENT_SAMPLE", medianPricePerM2Won: null, hasApartments: true });
    expect(region(s, B)).toMatchObject({ tradeCount: 0, priceStatus: "NO_APARTMENTS", hasApartments: false, medianPricePerM2Won: null });
    const s36 = await stats("UMD", "50110", 36);
    expect(region(s36, B).priceStatus).toBe("NO_APARTMENTS");
  });

  it("computes the 12-month change only with >= 3 deals on both sides (TC-018/019)", async () => {
    const s = await stats("UMD", "50110");
    const a = region(s, A);
    const recent = [500_000_000 / 84.99, 600_000_000 / 84.01, 550_000_000 / 84.5].sort((x, y) => x - y)[1]!;
    expect(a.change).toMatchObject({ status: "AVAILABLE", recentCount: 3, previousCount: 3, previousMedianWon: 5_000_000, recentMedianWon: Math.round(recent) });
    expect(a.change.pct).toBe(Math.round(((recent - 5_000_000) / 5_000_000) * 1000) / 10);
    expect(region(s, C).change).toMatchObject({ status: "INSUFFICIENT_SAMPLE", pct: null, recentCount: 2, previousCount: 3 });
  });

  it("excludes cancelled, superseded, unmatched and conflicting deals; city = regions + isolated (TC-017/021/022/024/025)", async () => {
    const s = await stats("CITY", undefined);
    const jeju = region(s, "5011000000");
    expect(jeju.tradeCount).toBe(5); // A 3 + C 2
    expect(s.unmapped["50110"]).toEqual({ mapped: 5, unmatched: 1, codeConflict: 1, codeNotInSet: 0, total: 7 });
    const umd = await stats("UMD", "50110");
    expect(umd.regions.reduce((n, r) => n + r.tradeCount, 0)).toBe(s.unmapped["50110"]!.mapped);
    // City price comes from the city's own deals, not from its regions' medians.
    const cityPpm = [500_000_000 / 84.99, 600_000_000 / 84.01, 550_000_000 / 84.5, 3_000_000, 3_100_000].sort((x, y) => x - y)[2]!;
    expect(jeju.medianPricePerM2Won).toBe(Math.round(cityPpm));
    expect(region(s, "5013000000")).toMatchObject({ tradeCount: 4, medianPricePerM2Won: 5_500_000 });
  });

  it("keeps 12/24/36-month windows half-open and consistent with the monthly series (TC-010)", async () => {
    for (const period of [12, 24, 36] as const) {
      const s = await stats("UMD", "50110", period);
      const w = periodWindow(period, NOW);
      expect(s.contractPeriod).toEqual({ startInclusive: w.from, endExclusive: w.to });
      const monthly = await withSnapshot(pool, (c) => loadRegionMonthly(c, { setId, regionCode: A, period, now: NOW }));
      expect(monthly).toHaveLength(period);
      expect(monthly.reduce((n, m) => n + (m.tradeCount ?? 0), 0)).toBe(region(s, A).tradeCount);
      expect(monthly.at(-1)).toMatchObject({ contractMonth: "202610", isCurrentMonth: true });
    }
    expect(region(await stats("UMD", "50110", 24), A).tradeCount).toBe(6);
  });

  it("marks a city with a failed month as incomplete — no price, no zero (TC-020)", async () => {
    await pool.query("INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at) VALUES ('MOLIT_SALE','50130','202604','FAILED',$1,$1)", [new Date(NOW.getTime() - 1_800_000)]);
    try {
      const s = await stats("UMD", "50130");
      expect(region(s, D)).toMatchObject({ priceStatus: "INCOMPLETE_DATA", medianPricePerM2Won: null, countStatus: "INCOMPLETE" });
      expect(s.dataStatus).toMatchObject({ completeness: "INCOMPLETE", missingMonths: ["202604"] });
      expect(region(await stats("UMD", "50110"), A).priceStatus).toBe("AVAILABLE"); // the other city is unaffected
      const monthly = await withSnapshot(pool, (c) => loadRegionMonthly(c, { setId, regionCode: D, period: 12, now: NOW }));
      expect(monthly.find((m) => m.contractMonth === "202604")).toMatchObject({ tradeCount: null, collectionStatus: "MISSING" });
    } finally {
      await pool.query("INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at) VALUES ('MOLIT_SALE','50130','202604','SUCCESS',$1,$1)", [new Date(NOW.getTime() - 900_000)]);
    }
  });

  it("flags data older than 48 hours as STALE", async () => {
    expect((await stats("CITY", undefined)).dataStatus).toMatchObject({ freshness: "FRESH", provisionalCurrentMonth: true, currentMonth: "202610" });
    const later = new Date(NOW.getTime() + 49 * 3_600_000);
    expect((await stats("CITY", undefined, 12, later)).dataStatus.freshness).toBe("STALE");
  });

  it("keeps the snapshot id for the same data and changes it on new deals, cancellations or another region set (TC-031/032/033)", async () => {
    const id = async () => (await stats("UMD", "50110")).snapshotId;
    const v0 = await id();
    expect(await id()).toBe(v0);
    const tx = await sale(apts.A, "2026-09-01", 700_000_000, 100);
    const v1 = await id();
    expect(v1).not.toBe(v0);
    expect(region(await stats("UMD", "50110"), A).tradeCount).toBe(4);
    await pool.query("UPDATE transactions SET record_status = 'CANCELLED', cancelled_on = contract_date WHERE transaction_id = $1", [tx]);
    const v2 = await id();
    expect(v2).not.toBe(v1);
    expect(region(await stats("UMD", "50110"), A).tradeCount).toBe(3);
    const other = (await saveRegionSet(pool, META, buildRegionSet(parseCodeCsv(CODES), files(), 20))).setId;
    const vOther = (await withSnapshot(pool, (c) => loadRegionStats(c, { setId: other, level: "UMD", cityCode: "50110", period: 12, now: NOW }))).snapshotId;
    expect(vOther).not.toBe(v2);
  });

  it("reports a region whose apartments trade nothing in the period as NO_TRADES once it has apartments", async () => {
    await apt("5011010200");
    expect(region(await stats("UMD", "50110"), B)).toMatchObject({ priceStatus: "NO_TRADES", tradeCount: 0, hasApartments: true });
  });
});
