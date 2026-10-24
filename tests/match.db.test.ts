import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../server/db";
import { runMatching } from "../server/match/run";
import { migrate } from "../scripts/migrate";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("runMatching (DB)", () => {
  let pool: pg.Pool;
  let aptA: string;

  const insertTx = (key: string, over: { seq: string; pnu: string | null; type?: string; name?: string; jibun?: string }) =>
    pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, source_apt_seq, source_pnu, sgg_code, umd_name, jibun, apt_name_raw,
         contract_date, area_m2, sale_price, deposit, monthly_rent)
       VALUES ($1,$2,1,$3,$4,'50110','연동',$5,$6,'2026-08-01',84.9,$7,$8,$9)`,
      over.type === "rent"
        ? ["rent", key, over.seq, over.pnu, over.jibun ?? "1-0", over.name ?? "한라", null, 100_000_000, 0]
        : ["sale", key, over.seq, over.pnu, over.jibun ?? "1-0", over.name ?? "한라", 300_000_000, null, null],
    );

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    const a = await pool.query(
      `INSERT INTO apartments (name, city_code, legal_dong_code, pnu, lot_address) VALUES
         ('한라','50110','5011013700','5011013700100010000','제주특별자치도 제주시 연동 1-0') RETURNING apartment_id`,
    );
    aptA = a.rows[0].apartment_id;
    await insertTx("s1", { seq: "S1", pnu: "5011013700100010000" });
    await insertTx("r1", { seq: "S1", pnu: null, type: "rent" });
    await insertTx("s2", { seq: "S2", pnu: "5011013700100020000", jibun: "2-0" }); // same name, other parcel
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("links only confirmed transactions and records a review for every row", async () => {
    const s = await runMatching(pool);
    expect(s).toMatchObject({ transactions: 3, confirmed: 2, pending: { NOT_IN_REFERENCE: 1 } });
    const { rows } = await pool.query(
      `SELECT t.natural_key, t.apartment_id, m.match_status, m.reason FROM transactions t JOIN match_reviews m USING (transaction_id) ORDER BY 1`,
    );
    expect(rows).toEqual([
      { natural_key: "r1", apartment_id: aptA, match_status: "CONFIRMED", reason: null },
      { natural_key: "s1", apartment_id: aptA, match_status: "CONFIRMED", reason: null },
      { natural_key: "s2", apartment_id: null, match_status: "PENDING", reason: "NOT_IN_REFERENCE" },
    ]);
    const seqs = await pool.query("SELECT source_id FROM apartment_source_ids WHERE source='MOLIT_APTSEQ'");
    expect(seqs.rows).toEqual([{ source_id: "S1" }]);
  });

  it("is idempotent and unlinks when the evidence disappears", async () => {
    await runMatching(pool);
    expect((await pool.query("SELECT count(*)::int n FROM match_reviews")).rows[0].n).toBe(3);
    // A second apartment on the same parcel makes the match ambiguous → links are removed.
    await pool.query(
      `INSERT INTO apartments (name, city_code, legal_dong_code, pnu) VALUES ('한라2','50110','5011013700','5011013700100010000')`,
    );
    const s = await runMatching(pool);
    expect(s.confirmed).toBe(0);
    expect((await pool.query("SELECT count(*)::int n FROM transactions WHERE apartment_id IS NOT NULL")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int n FROM apartment_source_ids WHERE source='MOLIT_APTSEQ'")).rows[0].n).toBe(0);
  });
});
