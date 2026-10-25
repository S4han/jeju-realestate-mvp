// Daily Cron run (CRON-001 D1): transient month failures get one more attempt at the end of the run.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../server/db";
import { createBudget } from "../server/collect/budget";
import { collectDaily, isTransient } from "../server/collect/daily";
import type { Fetcher } from "../server/collect/molit";
import { migrate } from "../scripts/migrate";
import { gatewayErrorXml, responseXml, saleItem } from "./helpers/molitFixture";

const url = process.env.TEST_DATABASE_URL;
const KEY = "FAKE-SERVICE-KEY-1234567890==";

// Fake source: per "<sale|rent>:<city>:<ymd>" a list of responses used in order (the last one repeats).
type Reply = "OK" | "BAD_XML" | "SHORT" | "GATEWAY";
function fakeSource(plan: Record<string, Reply[]>): Fetcher & { calls: Record<string, number> } {
  const f = (async (u: string) => {
    const q = new URL(u).searchParams;
    const key = `${u.includes("AptTradeDev") ? "sale" : "rent"}:${q.get("LAWD_CD")}:${q.get("DEAL_YMD")}`;
    const n = (f.calls[key] = (f.calls[key] ?? 0) + 1);
    const replies = plan[key] ?? ["OK"];
    const reply = replies[Math.min(n, replies.length) - 1];
    if (reply === "BAD_XML") return { status: 200, text: "<html>gateway timeout</html" };
    if (reply === "SHORT") return { status: 200, text: responseXml([saleItem()], 2) };
    if (reply === "GATEWAY") return { status: 200, text: gatewayErrorXml("30") };
    return { status: 200, text: responseXml(key.startsWith("sale") ? [saleItem({ sggCd: q.get("LAWD_CD")!, dealYear: q.get("DEAL_YMD")!.slice(0, 4), dealMonth: String(Number(q.get("DEAL_YMD")!.slice(4))) })] : []) };
  }) as Fetcher & { calls: Record<string, number> };
  f.calls = {};
  return f;
}

describe("isTransient", () => {
  it("retries only failures that can pass by themselves", () => {
    for (const c of ["NETWORK", "COUNT_MISMATCH", "BAD_RESPONSE", "INTERNAL", "HTTP_500", "HTTP_503"]) expect(isTransient(c)).toBe(true);
    for (const c of [undefined, "BUDGET_RUN", "BUDGET_DAILY", "RESULT_03", "GATEWAY_30", "HTTP_404"]) expect(isTransient(c)).toBe(false);
  });
});

describe.skipIf(!url)("daily collection (DB)", () => {
  let pool: pg.Pool;
  const run = (fetcher: Fetcher, runLimit = 30) =>
    collectDaily(pool, {
      months: ["202609", "202610"], serviceKey: KEY, fetcher, retryDelaysMs: [0, 0], pauseMs: 0,
      budget: createBudget(pool, { dailyLimit: 300, runLimit }),
    });
  const latest = async (city: string, period: string) =>
    (await pool.query(
      "SELECT status FROM sync_jobs WHERE source_id='MOLIT_SALE' AND city_code=$1 AND period=$2 ORDER BY started_at DESC, job_id DESC LIMIT 1",
      [city, period],
    )).rows[0]?.status;

  beforeAll(() => {
    pool = createPool(url!, "disable");
  });
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("a month that fails once succeeds on the end-of-run attempt, so its latest job is SUCCESS", async () => {
    const src = fakeSource({ "sale:50130:202609": ["BAD_XML", "OK"] });
    const res = await run(src);
    expect(res.jobs.find((j) => j.city === "50130" && j.period === "202609" && j.source === "MOLIT_SALE")).toMatchObject({ status: "FAILED", errorCode: "BAD_RESPONSE" });
    expect(res.retried).toEqual([expect.objectContaining({ source: "MOLIT_SALE", city: "50130", period: "202609", status: "SUCCESS" })]);
    expect(await latest("50130", "202609")).toBe("SUCCESS");
    expect(src.calls["sale:50130:202609"]).toBe(2);
    expect(Object.values(src.calls).reduce((a, b) => a + b, 0)).toBe(9); // 8 jobs + 1 retry
  });

  it("tries a persistent failure only once more, keeping the stored data", async () => {
    await run(fakeSource({}));
    const src = fakeSource({ "sale:50110:202610": ["SHORT"] });
    const res = await run(src);
    expect(res.retried).toEqual([expect.objectContaining({ status: "FAILED", errorCode: "COUNT_MISMATCH" })]);
    expect(src.calls["sale:50110:202610"]).toBe(2);
    expect(await latest("50110", "202610")).toBe("FAILED");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM transactions WHERE sgg_code='50110' AND to_char(contract_date,'YYYYMM')='202610' AND record_status='ACTIVE'");
    expect(rows[0].n).toBe(1);
  });

  it("does not retry key or quota errors", async () => {
    const src = fakeSource({ "sale:50110:202609": ["GATEWAY"] });
    const res = await run(src);
    expect(res.jobs.find((j) => j.status === "FAILED")).toMatchObject({ errorCode: "GATEWAY_30" });
    expect(res.retried).toEqual([]);
    expect(src.calls["sale:50110:202609"]).toBe(1);
  });

  it("does not retry after the run budget stops the run", async () => {
    const src = fakeSource({ "sale:50110:202609": ["BAD_XML", "OK"] });
    const res = await run(src, 3);
    expect(res.stoppedBy).toBe("BUDGET_RUN");
    expect(res.retried).toEqual([]);
    expect(Object.values(src.calls).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("a retry that hits the run budget stops there", async () => {
    const src = fakeSource({ "sale:50110:202609": ["BAD_XML", "OK"], "sale:50110:202610": ["BAD_XML", "OK"] });
    const res = await run(src, 9);
    expect(res.retried.map((j) => j.status)).toEqual(["SUCCESS", "FAILED"]);
    expect(res.stoppedBy).toBe("BUDGET_RUN");
    expect(Object.values(src.calls).reduce((a, b) => a + b, 0)).toBe(9);
  });
});
