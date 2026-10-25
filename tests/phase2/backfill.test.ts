import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { monthRange } from "../../scripts/phase2/backfill-sales";
import { createPool } from "../../server/db";
import { createBudget } from "../../server/collect/budget";
import { collect } from "../../server/collect/collector";
import { migrate } from "../../scripts/migrate";
import { responseXml, saleItem } from "../helpers/molitFixture";

describe("phase2 backfill month range", () => {
  it("spans years inclusively, oldest first", () => {
    const m = monthRange("202311", "202510");
    expect(m).toHaveLength(24);
    expect(m.slice(0, 3)).toEqual(["202311", "202312", "202401"]);
    expect(m.at(-1)).toBe("202510");
    expect(monthRange("202405", "202405")).toEqual(["202405"]);
  });
  it("rejects bad input", () => {
    expect(() => monthRange("202313", "202401")).toThrow();
    expect(() => monthRange("202402", "202401")).toThrow();
    expect(() => monthRange("202001", "202312")).toThrow(/36/);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("phase2 backfill uses the Phase 1 collector for sale only (DB)", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("calls only the sale endpoint, within the run budget, and stores past-month rows", async () => {
    const urls: string[] = [];
    const fetcher = async (u: string) => {
      urls.push(u);
      const q = new URL(u).searchParams;
      const ymd = q.get("DEAL_YMD")!;
      const item = saleItem({ sggCd: q.get("LAWD_CD")!, aptSeq: `${q.get("LAWD_CD")}-9001`, dealYear: ymd.slice(0, 4), dealMonth: String(Number(ymd.slice(4))) });
      return { status: 200, text: responseXml([item]) };
    };
    const budget = createBudget(pool, { dailyLimit: 300, runLimit: 4 });
    const { jobs } = await collect(pool, {
      months: monthRange("202311", "202312"), cities: ["50110", "50130"], serviceKey: "TEST-KEY-0000000000000000",
      fetcher, budget, sources: ["MOLIT_SALE"], retryDelaysMs: [0, 0],
    });
    expect(urls).toHaveLength(4);
    expect(urls.every((u) => u.includes("RTMSDataSvcAptTradeDev"))).toBe(true);
    expect(jobs.map((j) => j.status)).toEqual(["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"]);
    const { rows } = await pool.query("SELECT trade_type, to_char(contract_date,'YYYYMM') AS m, count(*)::int AS n FROM transactions GROUP BY 1, 2 ORDER BY 2");
    expect(rows).toEqual([
      { trade_type: "sale", m: "202311", n: 2 },
      { trade_type: "sale", m: "202312", n: 2 },
    ]);
    const sources = await pool.query("SELECT DISTINCT source_id FROM sync_jobs");
    expect(sources.rows).toEqual([{ source_id: "MOLIT_SALE" }]);
  });
});
