import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../server/db";
import { getTransaction, listTransactions } from "../server/handlers/transactions";
import { migrate } from "../scripts/migrate";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-24T03:00:00Z"); // window 2025-11 .. 2026-10

describe.skipIf(!url)("transaction APIs (DB)", () => {
  let pool: pg.Pool;
  let apt: string;
  let empty: string;
  const tx: Record<string, string> = {};
  const body = (r: { body: unknown }) => r.body as any;

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    const a = await pool.query(
      `INSERT INTO apartments (name, city_code, legal_dong_code) VALUES ('한라','50110','5011013700'), ('빈단지','50110','5011013700') RETURNING apartment_id`,
    );
    apt = a.rows[0].apartment_id;
    empty = a.rows[1].apartment_id;
    let k = 0;
    const add = async (name: string, o: { type?: string; date: string; area?: number; price?: number; deposit?: number; rent?: number; status?: string; apt?: string | null }) => {
      const sale = (o.type ?? "sale") === "sale";
      const r = await pool.query(
        `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, floor,
           sale_price, deposit, monthly_rent, record_status, cancelled_on, contract_type, contract_term)
         VALUES ($1,$2,1,$3,'50110','연동','한라',$4,$5,5,$6,$7,$8,$9,$10,$11,$12) RETURNING transaction_id`,
        [sale ? "sale" : "rent", `k${++k}`, o.apt === undefined ? apt : o.apt, o.date, o.area ?? 84.9, sale ? o.price ?? 500_000_000 : null,
         sale ? null : o.deposit ?? 100_000_000, sale ? null : o.rent ?? 0, o.status ?? "ACTIVE", o.status === "CANCELLED" ? o.date : null,
         sale ? null : "신규", sale ? null : "26.09~28.09"],
      );
      tx[name] = r.rows[0].transaction_id;
    };
    await add("s_new", { date: "2026-10-10", price: 600_000_000 });
    await add("s_mid", { date: "2026-05-02", price: 450_000_000, area: 59.9 });
    await add("s_old", { date: "2025-11-01", price: 520_000_000 });
    await add("s_outside", { date: "2025-10-31" });
    await add("s_cancel", { date: "2026-09-01", status: "CANCELLED", price: 999_000_000 });
    await add("s_missing", { date: "2026-09-02", status: "MISSING_FROM_SOURCE" });
    await add("s_unmatched", { date: "2026-09-03", apt: null });
    await add("r_jeonse", { type: "rent", date: "2026-07-01", deposit: 300_000_000, rent: 0 });
    await add("r_monthly", { type: "rent", date: "2026-08-01", deposit: 20_000_000, rent: 1_330_000 });
    // Coverage: every month collected for rent; sale missing 2026-05; sale last success recent.
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(2025, 10 + m, 1));
      const period = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      await pool.query(`INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at) VALUES ('MOLIT_RENT','50110',$1,'SUCCESS',$2,$2)`, [period, "2026-10-24T01:00:00Z"]);
      if (period !== "202605") await pool.query(`INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at) VALUES ('MOLIT_SALE','50110',$1,'SUCCESS',$2,$2)`, [period, "2026-10-24T01:00:00Z"]);
    }
    await pool.query(`INSERT INTO sync_jobs (source_id, city_code, period, status, started_at) VALUES ('MOLIT_SALE','50110','202605','FAILED','2026-10-24T01:00:00Z')`);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("lists only confirmed, active deals in the 12-month window, newest first", async () => {
    const r = body(await listTransactions(pool, apt, {}, NOW));
    expect(r.items.map((i: any) => i.id)).toEqual([tx.s_new, tx.s_mid, tx.s_old]);
    expect(r.page.total).toBe(3);
    expect(r.items[0]).toMatchObject({ contract_date: "2026-10-10", sale_price: 600_000_000, area_m2: 84.9, floor: 5, deposit: null });
  });

  it("reports months that failed to collect, separately from an empty result", async () => {
    const sale = body(await listTransactions(pool, apt, {}, NOW));
    expect(sale.data).toMatchObject({ missing_months: ["2026-05"], delayed: false });
    const none = body(await listTransactions(pool, empty, { type: "rent" }, NOW));
    expect(none.page.total).toBe(0);
    expect(none.data.missing_months).toEqual([]);
  });

  it("flags stale data as delayed", async () => {
    const later = new Date("2026-10-27T03:00:00Z");
    expect(body(await listTransactions(pool, apt, { type: "rent" }, later)).data.delayed).toBe(true);
  });

  it("keeps deposit and monthly rent separate and sorts by price", async () => {
    const r = body(await listTransactions(pool, apt, { type: "rent", sort: "price_desc" }, NOW));
    expect(r.items.map((i: any) => [i.deposit, i.monthly_rent, i.sale_price])).toEqual([[300_000_000, 0, null], [20_000_000, 1_330_000, null]]);
    expect(r.items[0]).toMatchObject({ contract_type: "신규", contract_term: "26.09~28.09" });
  });

  it("filters by area and period, sorts, pages and groups areas", async () => {
    const small = body(await listTransactions(pool, apt, { area_min: "59", area_max: "59.9999" }, NOW));
    expect(small.items.map((i: any) => i.id)).toEqual([tx.s_mid]);
    expect(small.area_groups).toEqual([{ m2: 59, n: 1 }, { m2: 84, n: 2 }]);
    const cheap = body(await listTransactions(pool, apt, { sort: "price_asc" }, NOW));
    expect(cheap.items.map((i: any) => i.sale_price)).toEqual([450_000_000, 520_000_000, 600_000_000]);
    const p2 = body(await listTransactions(pool, apt, { page_size: "2", page: "2" }, NOW));
    expect(p2.items.map((i: any) => i.id)).toEqual([tx.s_old]);
    const period = body(await listTransactions(pool, apt, { from: "2026-05", to: "2026-05" }, NOW));
    expect(period.items.map((i: any) => i.id)).toEqual([tx.s_mid]);
    expect(period.data.missing_months).toEqual(["2026-05"]);
  });

  it("validates parameters", async () => {
    for (const q of [{ type: "lease" }, { sort: "1;drop" }, { from: "2024-01" }, { to: "2026-11" }, { from: "2026-06", to: "2026-05" }, { page_size: "500" }, { area_min: "90", area_max: "80" }, { from: "2026-13" }]) {
      expect((await listTransactions(pool, apt, q, NOW)).status).toBe(400);
    }
    expect((await listTransactions(pool, "x", {}, NOW)).status).toBe(400);
    expect((await listTransactions(pool, "999999", {}, NOW)).status).toBe(404);
  });

  it("serves a single deal only when it is publicly shown", async () => {
    expect(body(await getTransaction(pool, tx.s_new))).toMatchObject({ id: tx.s_new, apartment: { id: apt, name: "한라" } });
    for (const hidden of [tx.s_cancel, tx.s_missing, tx.s_unmatched]) expect((await getTransaction(pool, hidden)).status).toBe(404);
    expect((await getTransaction(pool, "abc")).status).toBe(400);
  });
});
