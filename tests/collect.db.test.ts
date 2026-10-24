// End-to-end collector runs against TEST_DATABASE_URL with a fake data.go.kr.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../server/db";
import { createBudget } from "../server/collect/budget";
import { collect } from "../server/collect/collector";
import type { Fetcher } from "../server/collect/molit";
import { getDataStatus } from "../server/handlers/dataStatus";
import { migrate } from "../scripts/migrate";
import { rentItem, responseXml, saleItem, type Item } from "./helpers/molitFixture";

const url = process.env.TEST_DATABASE_URL;
const KEY = "FAKE-SERVICE-KEY-1234567890==";

// Fake source: responses keyed by "<sale|rent>:<city>:<ymd>".
function fakeSource(data: Record<string, Item[] | "RESET">): Fetcher & { calls: number } {
  const f = (async (u: string) => {
    f.calls++;
    const q = new URL(u).searchParams;
    const kind = u.includes("AptTradeDev") ? "sale" : "rent";
    const v = data[`${kind}:${q.get("LAWD_CD")}:${q.get("DEAL_YMD")}`] ?? [];
    if (v === "RESET") throw new TypeError("fetch failed");
    return { status: 200, text: responseXml(v, v.length) };
  }) as Fetcher & { calls: number };
  f.calls = 0;
  return f;
}

describe.skipIf(!url)("collector (DB)", () => {
  let pool: pg.Pool;
  const run = (fetcher: Fetcher, months: string[], opts: { runLimit?: number; dailyLimit?: number } = {}) =>
    collect(pool, {
      months, cities: ["50110"], serviceKey: KEY, fetcher, retryDelaysMs: [0, 0],
      budget: createBudget(pool, { dailyLimit: opts.dailyLimit ?? 300, runLimit: opts.runLimit ?? 100 }),
    });
  const txRows = () =>
    pool.query("SELECT transaction_id, trade_type, record_status, cancelled_on, occurrence, sale_price, deposit, monthly_rent, source_pnu FROM transactions ORDER BY transaction_id").then((r) => r.rows);

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

  it("stores a month, then follows a cancellation and a disappearance without changing ids", async () => {
    const a = saleItem();
    const b = saleItem({ aptNm: "다른단지", aptSeq: "50110-9003", dealAmount: "25,000" });
    const first = await run(fakeSource({ "sale:50110:202608": [a, b], "rent:50110:202608": [rentItem()] }), ["202608"]);
    expect(first.jobs.map((j) => j.status)).toEqual(["SUCCESS", "SUCCESS"]);
    const before = await txRows();
    expect(before).toHaveLength(3);
    expect(before[0]).toMatchObject({ trade_type: "sale", sale_price: "403000000", source_pnu: "5011012500113940001" });
    expect(before[2]).toMatchObject({ trade_type: "rent", deposit: "110380000", monthly_rent: "510000" });

    await run(fakeSource({ "sale:50110:202608": [{ ...a, cdealType: "O", cdealDay: "26.09.28" }], "rent:50110:202608": [rentItem()] }), ["202608"]);
    const after = await txRows();
    expect(after.map((r) => r.transaction_id)).toEqual(before.map((r) => r.transaction_id));
    expect(after[0]).toMatchObject({ record_status: "CANCELLED" });
    expect(after[1]).toMatchObject({ record_status: "MISSING_FROM_SOURCE" });
    expect(after[2]).toMatchObject({ record_status: "ACTIVE" });
  });

  it("is idempotent: re-collecting the same data changes nothing", async () => {
    const src = { "sale:50110:202608": [saleItem(), saleItem()], "rent:50110:202608": [rentItem()] };
    await run(fakeSource(src), ["202608"]);
    const r1 = await txRows();
    const second = await run(fakeSource(src), ["202608"]);
    expect(await txRows()).toEqual(r1);
    expect(r1.filter((r) => r.trade_type === "sale").map((r) => r.occurrence)).toEqual([1, 2]);
    expect(second.jobs[0]!.applied).toEqual({ inserted: 0, updated: 2, cancelled: 0, missing: 0 });
  });

  it("keeps the last good data when a month fails and records the failure", async () => {
    await run(fakeSource({ "sale:50110:202608": [saleItem()] }), ["202608"]);
    const res = await run(fakeSource({ "sale:50110:202608": "RESET" }), ["202608"]);
    expect(res.jobs[0]).toMatchObject({ status: "FAILED", errorCode: "NETWORK", calls: 3 });
    expect((await txRows())[0]).toMatchObject({ record_status: "ACTIVE" });
    const { rows } = await pool.query("SELECT error_message FROM sync_jobs WHERE status='FAILED'");
    expect(JSON.stringify(rows)).not.toContain(KEY);
  });

  it("does not mark rows missing when some fetched rows were unreadable (PARTIAL)", async () => {
    await run(fakeSource({ "sale:50110:202608": [saleItem(), saleItem({ aptNm: "B" })] }), ["202608"]);
    const res = await run(fakeSource({ "sale:50110:202608": [saleItem(), saleItem({ aptNm: "B", dealAmount: "??" })] }), ["202608"]);
    expect(res.jobs[0]).toMatchObject({ status: "PARTIAL", rejected: { BAD_AMOUNT: 1 } });
    expect((await txRows()).map((r) => r.record_status)).toEqual(["ACTIVE", "ACTIVE"]);
  });

  it("stops at the run budget before calling the source again", async () => {
    const src = fakeSource({});
    const res = await run(src, ["202607", "202608"], { runLimit: 3 });
    expect(src.calls).toBe(3);
    expect(res.stoppedBy).toBe("BUDGET_RUN");
    expect(res.jobs.at(-1)).toMatchObject({ status: "FAILED", errorCode: "BUDGET_RUN" });
  });

  it("enforces the shared per-source daily limit across runs", async () => {
    await run(fakeSource({}), ["202608"], { dailyLimit: 1 }); // 1 sale call + 1 rent call
    const src = fakeSource({});
    const res = await run(src, ["202608"], { dailyLimit: 1 });
    expect(src.calls).toBe(0);
    expect(res.stoppedBy).toBe("BUDGET_DAILY");
    const { rows } = await pool.query("SELECT sum(calls)::int AS n FROM api_usage");
    expect(rows[0].n).toBe(2);
  });

  it("data-status lists months never collected", async () => {
    const now = new Date("2026-10-24T03:00:00Z");
    await run(fakeSource({}), ["202610"]);
    const body = (await getDataStatus(pool, now)).body as { status: string; missing_periods: { source_id: string; period: string }[] };
    expect(body.status).toBe("PARTIAL");
    expect(body.missing_periods.filter((p) => p.source_id === "MOLIT_SALE").map((p) => p.period)).toContain("202511");
    const sale = body.missing_periods.filter((p) => p.source_id === "MOLIT_SALE" && (p as { city_code?: string }).city_code === "50110");
    expect(sale.some((p) => p.period === "202610")).toBe(false);
    expect(sale).toHaveLength(11);
  });
});
