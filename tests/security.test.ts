// Hostile-input and access checks for every public handler (AT-018, SECURITY_COST.md).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { ServerResponse, IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { createPool } from "../server/db";
import { getApartment, mapApartments, searchApartments } from "../server/handlers/apartments";
import { getTransaction, listTransactions } from "../server/handlers/transactions";
import { migrate } from "../scripts/migrate";

const url = process.env.TEST_DATABASE_URL;

const HOSTILE = [
  "' OR '1'='1", "'; DROP TABLE apartments; --", "1; SELECT pg_sleep(5)", "\\", "%", "_", "%%%%", "\u0000", "<script>alert(1)</script>",
  "../../etc/passwd", "😀🏠", "ㄱ".repeat(29), "a".repeat(5000), "NaN", "-1", "1e309", "0x10", "  ", "",
];

describe.skipIf(!url)("hostile input", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    await pool.query(`INSERT INTO apartments (name, city_code, legal_dong_code, latitude, longitude, location_status)
      VALUES ('한라','50110','5011013700',33.48,126.48,'VERIFIED_PARCEL')`);
  });
  afterAll(async () => {
    await pool?.end();
  });

  const ok = (status: number) => [200, 400, 404].includes(status);

  it("never errors or leaks internals on hostile query values", async () => {
    for (const v of HOSTILE) {
      const results = [
        await searchApartments(pool, { q: v }),
        await searchApartments(pool, { q: "한라", city_code: v, limit: v }),
        await mapApartments(pool, { bbox: v }),
        await mapApartments(pool, { bbox: `${v},33.4,126.6,33.6` }),
        await getApartment(pool, v),
        await listTransactions(pool, "1", { type: v, sort: v, from: v, to: v, page: v, page_size: v, area_min: v, area_max: v }),
        await listTransactions(pool, v, {}),
        await getTransaction(pool, v),
      ];
      for (const r of results) {
        expect(ok(r.status), `status ${r.status} for ${JSON.stringify(v).slice(0, 40)}`).toBe(true);
        expect(JSON.stringify(r.body)).not.toMatch(/syntax error|relation |pg_|stack|at .*\.ts/i);
      }
    }
    // The schema is intact and the injected statements did nothing.
    expect((await pool.query("SELECT count(*)::int AS n FROM apartments")).rows[0].n).toBe(1);
  });

  it("accepts array-valued query parameters without crashing (first value wins)", async () => {
    const r = await searchApartments(pool, { q: ["한라", "x"] });
    expect(r.status).toBe(200);
  });
});

function fakeReqRes(headers: Record<string, string> = {}) {
  const req = new IncomingMessage(new Socket());
  req.headers = headers;
  const res = new ServerResponse(req);
  let body = "";
  res.end = ((chunk?: unknown) => {
    body += chunk ? String(chunk) : "";
    return res;
  }) as typeof res.end;
  return { req, res, body: () => body };
}

describe("cron endpoint access", () => {
  it("rejects requests without the exact bearer secret and never starts collection", async () => {
    const collect = vi.fn();
    vi.doMock("../server/collect/collector", () => ({ collect }));
    const { default: handler } = await import("../api/cron/collect-transactions");
    const saved = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      for (const auth of [undefined, "Bearer ", "Bearer undefined"]) {
        const t = fakeReqRes(auth ? { authorization: auth } : {});
        await handler(t.req as any, t.res);
        expect(t.res.statusCode).toBe(401);
      }
      process.env.CRON_SECRET = "correct-horse-battery-staple";
      for (const auth of ["Bearer wrong", "correct-horse-battery-staple", "Bearer correct-horse-battery-staple "]) {
        const t = fakeReqRes({ authorization: auth });
        await handler(t.req as any, t.res);
        expect(t.res.statusCode).toBe(401);
        expect(t.body()).not.toContain("correct-horse");
      }
      expect(collect).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = saved;
      vi.doUnmock("../server/collect/collector");
    }
  });
});
