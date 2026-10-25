import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createPool } from "../../server/db";
import { migrate } from "../../scripts/migrate";
import { decodeCursor, encodeCursor } from "../../server/phase2/cursor";
import { isPhase2Enabled } from "../../server/phase2/flag";
import { handleAnalysis } from "../../server/phase2/handlers";
import { periodWindow } from "../../server/phase2/analysis";

const SECRET = "test-cursor-secret-0123456789abcdef";
const NOW = new Date("2026-10-25T03:00:00Z");

function fakeReqRes(query: Record<string, string>) {
  const req = new IncomingMessage(new Socket()) as IncomingMessage & { query: Record<string, string> };
  req.query = query;
  const res = new ServerResponse(req);
  let body = "";
  res.end = ((chunk?: unknown) => {
    body += chunk ? String(chunk) : "";
    return res;
  }) as typeof res.end;
  return { req, res, body: () => body };
}

describe("phase2 feature flag", () => {
  it("is off unless exactly 'true'", () => {
    expect(isPhase2Enabled({})).toBe(false);
    expect(isPhase2Enabled({ PHASE2_PRICE_ANALYSIS_ENABLED: "1" })).toBe(false);
    expect(isPhase2Enabled({ PHASE2_PRICE_ANALYSIS_ENABLED: "TRUE" })).toBe(false);
    expect(isPhase2Enabled({ PHASE2_PRICE_ANALYSIS_ENABLED: "true" })).toBe(true);
  });

  it("answers 404 for every view when off, without touching the database", async () => {
    vi.stubEnv("PHASE2_PRICE_ANALYSIS_ENABLED", "");
    vi.stubEnv("DATABASE_URL", ""); // any DB access would fail with 503 instead of 404
    try {
      const { default: handler } = await import("../../api/v2/analysis/apartments/[id]/[view]");
      for (const view of ["status", "areas", "summary", "monthly", "points", "transactions"]) {
        const t = fakeReqRes({ id: "1", view });
        await handler(t.req, t.res);
        expect(t.res.statusCode, view).toBe(404);
        expect(JSON.parse(t.body())).toEqual({ error: { code: "NOT_FOUND" } });
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("signed cursors", () => {
  const payload = { a: "1", ar: 84, p: 24, v: "abcdef0123456789", d: "2026-01-02", i: "42" };
  it("round-trips and rejects tampering, other secrets and garbage", () => {
    const c = encodeCursor(payload, SECRET);
    expect(decodeCursor(c, SECRET)).toEqual(payload);
    expect(decodeCursor(c, "another-secret-0123456789abcdefgh")).toBeNull();
    const [body, mac] = c.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, ar: 59 })).toString("base64url");
    expect(decodeCursor(`${forged}.${mac}`, SECRET)).toBeNull();
    expect(decodeCursor(`${body}.${mac}.x`, SECRET)).toBeNull();
    for (const g of ["", ".", "abc", "a.b", "%%%.%%%"]) expect(decodeCursor(g, SECRET)).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("phase2 analysis API (DB)", () => {
  let pool: pg.Pool;
  let aptId: string;
  let seq = 0;
  const sale = (date: string, price: number, area = 84.97) =>
    pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, floor, sale_price, record_status)
       VALUES ('sale',$1,1,$2,'50110','동','단지',$3,$4,5,$5,'ACTIVE')`,
      [`api${++seq}`, aptId, date, area, price],
    );
  const call = (view: string, query: Record<string, string> = {}, env: { cursorSecret?: string } = { cursorSecret: SECRET }) =>
    handleAnalysis(pool, aptId, view, query, { ...env, now: NOW });
  const body = (r: { body: unknown }) => r.body as any;

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    aptId = String((await pool.query(
      "INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, location_status) VALUES ('API단지','50110','5011010100','x 1','NONE') RETURNING apartment_id",
    )).rows[0].apartment_id);
    await pool.query(
      `INSERT INTO sync_jobs (source_id, city_code, period, status, started_at, completed_at)
       SELECT 'MOLIT_SALE', '50110', p, 'SUCCESS', $1, $1 FROM unnest($2::text[]) p`,
      [new Date(NOW.getTime() - 3_600_000), periodWindow(36, NOW).months],
    );
    for (let i = 0; i < 5; i++) await sale(`2026-0${3 + i}-10`, (50 + i) * 10_000_000);
    for (let i = 0; i < 5; i++) await sale(`2025-0${3 + i}-10`, 50 * 10_000_000);
    await sale("2026-05-11", 30 * 10_000_000, 59.98);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("validates input", async () => {
    expect((await handleAnalysis(pool, aptId, "nope", {})).status).toBe(404);
    expect((await handleAnalysis(pool, "abc", "summary", {})).status).toBe(400);
    for (const q of <Record<string, string>[]>[{ period: "18" }, { period: "x" }, { areaType: "0" }, { areaType: "84.5" }, { areaType: "x" }, { pageSize: "0" }, { pageSize: "101" }]) {
      expect((await call("summary", q)).status, JSON.stringify(q)).toBe(400);
    }
    expect((await handleAnalysis(pool, "999999999", "summary", {}, { now: NOW })).status).toBe(404);
  });

  it("areas/summary/monthly/status share one data version and default to the most traded area type", async () => {
    const areas = await call("areas");
    expect(areas.status).toBe(200);
    expect(body(areas)).toMatchObject({ periodMonths: 24, areaTypeM2: 84, defaultAreaTypeM2: 84, areas: [{ areaTypeM2: 84, tradeCount: 10 }, { areaTypeM2: 59, tradeCount: 1 }] });
    const summary = body(await call("summary"));
    expect(summary.summary).toMatchObject({ tradeCount: 10, priceStatus: "AVAILABLE", comparisonStatus: "AVAILABLE", yearOverYearChangePct: 4 });
    const monthly = body(await call("monthly", { period: "12" }));
    expect(monthly.monthly).toHaveLength(12);
    expect(monthly.quarterly.length).toBeGreaterThan(0);
    const status = body(await call("status"));
    expect(status).toMatchObject({ enabled: true, apartment: { name: "API단지", cityCode: "50110" } });
    // 12-month views share the 24-month version because the year-over-year comparison always reads 24 months.
    expect(new Set([areas, { body: summary }, { body: monthly }, { body: status }].map((r) => body(r).dataVersion)).size).toBe(1);
    expect(summary.dataVersion).toBe(status.dataVersion);
    expect((await call("summary")).cacheSeconds).toBe(300);
  });

  it("'all' gives counts only and points require an area type", async () => {
    expect(body(await call("summary", { areaType: "all" })).summary).toMatchObject({ tradeCount: 11, medianPriceWon: null, priceStatus: "UNAVAILABLE" });
    expect((await call("points", { areaType: "all" })).status).toBe(400);
    const points = body(await call("points", { areaType: "84" }));
    expect(points.points).toHaveLength(10);
  });

  it("pages evidence with signed cursors and rejects tampering, other filters and stale versions", async () => {
    expect((await call("transactions", {}, {})).status).toBe(503); // secret missing
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r = body(await call("transactions", { areaType: "84", pageSize: "3", ...(cursor ? { cursor } : {}) }));
      seen.push(...r.items.map((d: any) => d.transactionId));
      expect(r.tradeCount).toBe(10);
      cursor = r.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(10);

    const first = body(await call("transactions", { areaType: "84", pageSize: "3" }));
    const next = first.nextCursor as string;
    expect((await call("transactions", { areaType: "84", pageSize: "3", cursor: next + "x" })).status).toBe(400);
    expect((await call("transactions", { areaType: "59", pageSize: "3", cursor: next })).status).toBe(400);
    expect((await call("transactions", { areaType: "84", period: "12", pageSize: "3", cursor: next })).status).toBe(400);
    await sale("2026-06-20", 60 * 10_000_000); // data changes between pages
    const stale = await call("transactions", { areaType: "84", pageSize: "3", cursor: next });
    expect(stale.status).toBe(409);
    expect(body(stale).error.code).toBe("DATA_VERSION_CHANGED");
  });

  it("answers 503 with a generic body when the database is unreachable", async () => {
    const down = createPool("postgres://nobody:PASSWORD@127.0.0.1:1/none", "disable");
    const r = await handleAnalysis(down, aptId, "summary", {}, { now: NOW });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|PASSWORD/);
    await down.end();
  });
});
