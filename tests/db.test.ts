// Integration tests against TEST_DATABASE_URL. The database is wiped at the start.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../server/db";
import { getDataStatus } from "../server/handlers/dataStatus";
import { migrate } from "../scripts/migrate";

const url = process.env.TEST_DATABASE_URL;
if (!url) console.warn("TEST_DATABASE_URL not set: skipping DB integration tests");

describe.skipIf(!url)("database schema", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    expect(await migrate(pool)).toEqual(expect.arrayContaining(["0001_init.sql", "0002_reference_location.sql"]));
  });
  afterAll(async () => {
    await pool?.end();
  });

  const apt = (over: Record<string, unknown> = {}) => ({
    name: "테스트아파트", city_code: "50110", legal_dong_code: "5011013700", pnu: "5011013700123180007", ...over,
  });
  const insertApt = (a: Record<string, unknown>) =>
    pool.query(
      `INSERT INTO apartments (name, city_code, legal_dong_code, pnu, latitude, longitude, location_status)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'NONE')) RETURNING apartment_id`,
      [a.name, a.city_code, a.legal_dong_code, a.pnu, a.latitude ?? null, a.longitude ?? null, a.location_status ?? null],
    );
  const sale = (over: Record<string, unknown> = {}) => ({
    trade_type: "sale", natural_key: "k1", occurrence: 1, sgg_code: "50110", umd_name: "연동", apt_name_raw: "테스트",
    contract_date: "2026-08-18", area_m2: 84.729, sale_price: 403_000_000, deposit: null, monthly_rent: null,
    record_status: "ACTIVE", cancelled_on: null, ...over,
  });
  const insertTx = (t: Record<string, unknown>) =>
    pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, sgg_code, umd_name, apt_name_raw, contract_date,
         area_m2, sale_price, deposit, monthly_rent, record_status, cancelled_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING transaction_id`,
      [t.trade_type, t.natural_key, t.occurrence, t.sgg_code, t.umd_name, t.apt_name_raw, t.contract_date,
       t.area_m2, t.sale_price, t.deposit, t.monthly_rent, t.record_status, t.cancelled_on],
    );

  it("is idempotent on re-run", async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it("only accepts Jeju city codes", async () => {
    await expect(insertApt(apt({ city_code: "11110" }))).rejects.toThrow(/check/i);
  });

  it("rejects coordinates outside Jeju and markers without coordinates", async () => {
    await expect(insertApt(apt({ latitude: 37.5, longitude: 127.0, location_status: "VERIFIED_PARCEL" }))).rejects.toThrow();
    await expect(insertApt(apt({ location_status: "VERIFIED_PARCEL" }))).rejects.toThrow();
    await expect(insertApt(apt({ latitude: 33.4875, longitude: 126.4714, location_status: "VERIFIED_PARCEL" }))).resolves.toBeTruthy();
  });

  it("keeps a source id mapped to exactly one apartment", async () => {
    const { rows } = await insertApt(apt({ name: "A" }));
    const id = rows[0].apartment_id;
    await pool.query("INSERT INTO apartment_source_ids (source, source_id, apartment_id) VALUES ('REB','50110300448128',$1)", [id]);
    await expect(
      pool.query("INSERT INTO apartment_source_ids (source, source_id, apartment_id) VALUES ('REB','50110300448128',$1)", [id]),
    ).rejects.toThrow(/duplicate/i);
  });

  it("enforces sale vs rent amount shape", async () => {
    await expect(insertTx(sale({ natural_key: "s-ok" }))).resolves.toBeTruthy();
    await expect(insertTx(sale({ natural_key: "s-bad", sale_price: null }))).rejects.toThrow();
    await expect(insertTx(sale({ natural_key: "s-bad2", deposit: 1000 }))).rejects.toThrow();
    const rent = { trade_type: "rent", sale_price: null, deposit: 110_380_000, monthly_rent: 510_000 };
    await expect(insertTx(sale({ natural_key: "r-ok", ...rent }))).resolves.toBeTruthy();
    await expect(insertTx(sale({ natural_key: "r-bad", ...rent, monthly_rent: null }))).rejects.toThrow();
  });

  it("stores identical source rows as separate occurrences, not duplicates", async () => {
    await insertTx(sale({ natural_key: "dup", occurrence: 1 }));
    await insertTx(sale({ natural_key: "dup", occurrence: 2, record_status: "CANCELLED", cancelled_on: "2026-09-28" }));
    await expect(insertTx(sale({ natural_key: "dup", occurrence: 1 }))).rejects.toThrow(/duplicate/i);
  });

  it("requires cancelled_on exactly for cancelled deals", async () => {
    await expect(insertTx(sale({ natural_key: "c1", record_status: "CANCELLED" }))).rejects.toThrow();
    await expect(insertTx(sale({ natural_key: "c2", cancelled_on: "2026-09-01" }))).rejects.toThrow();
  });

  it("allows unmatched transactions (apartment_id NULL) and blocks CONFIRMED reviews without a candidate", async () => {
    const { rows } = await insertTx(sale({ natural_key: "unmatched" }));
    const txId = rows[0].transaction_id;
    await expect(
      pool.query("INSERT INTO match_reviews (transaction_id, match_rule, match_status) VALUES ($1,'PNU','CONFIRMED')", [txId]),
    ).rejects.toThrow();
    await expect(
      pool.query(
        "INSERT INTO match_reviews (transaction_id, match_rule, match_status, reason) VALUES ($1,'PNU','PENDING','NOT_IN_REB')",
        [txId],
      ),
    ).resolves.toBeTruthy();
  });

  describe("GET /api/system/data-status", () => {
    const now = new Date("2026-10-24T12:00:00Z");

    it("reports NO_DATA before any sync", async () => {
      await pool.query("TRUNCATE sync_jobs");
      const r = await getDataStatus(pool, now);
      expect(r.status).toBe(200);
      expect((r.body as { status: string }).status).toBe("NO_DATA");
    });

    it("reports OK for a fresh success and DELAYED when the last success is stale", async () => {
      await pool.query(`INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at)
        VALUES ('MOLIT_SALE','50110','202610','SUCCESS','2026-10-24T01:00:00Z','2026-10-24T01:05:00Z')`);
      expect(((await getDataStatus(pool, now)).body as { status: string }).status).toBe("OK");

      await pool.query(`INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at)
        VALUES ('MOLIT_RENT','50110','202610','SUCCESS','2026-10-20T01:00:00Z','2026-10-20T01:05:00Z'),
               ('MOLIT_RENT','50110','202610','FAILED','2026-10-24T01:00:00Z',NULL)`);
      const body = (await getDataStatus(pool, now)).body as {
        status: string;
        sources: { source_id: string; delayed: boolean; last_status: string; last_success_at: string }[];
      };
      expect(body.status).toBe("DELAYED");
      const rent = body.sources.find((s) => s.source_id === "MOLIT_RENT")!;
      expect(rent.delayed).toBe(true);
      expect(rent.last_status).toBe("FAILED");
      expect(rent.last_success_at).toBe("2026-10-20T01:05:00.000Z");
    });

    it("does not flag yearly reference data as delayed after a few days", async () => {
      await pool.query("TRUNCATE sync_jobs");
      await pool.query(`INSERT INTO sync_jobs (source_id, status, started_at, completed_at)
        VALUES ('REB_COMPLEX','SUCCESS','2026-09-01T00:00:00Z','2026-09-01T00:01:00Z')`);
      expect(((await getDataStatus(pool, now)).body as { status: string }).status).toBe("OK");
      const muchLater = new Date("2027-11-01T00:00:00Z");
      expect(((await getDataStatus(pool, muchLater)).body as { status: string }).status).toBe("DELAYED");
    });
  });
});

describe("GET /api/system/data-status when the DB is down", () => {
  it("returns a generic 503 without connection details", async () => {
    const dead = createPool("postgres://nobody:SECRETPW@127.0.0.1:1/none", "disable");
    try {
      const r = await getDataStatus(dead);
      expect(r.status).toBe(503);
      const text = JSON.stringify(r.body);
      expect(text).toContain("DB_UNAVAILABLE");
      expect(text).not.toMatch(/SECRETPW|127\.0\.0\.1|ECONNREFUSED/);
    } finally {
      await dead.end();
    }
  });
});
