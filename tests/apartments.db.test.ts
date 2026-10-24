import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../server/db";
import { getApartment, mapApartments, searchApartments } from "../server/handlers/apartments";
import { migrate } from "../scripts/migrate";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("apartment APIs (DB)", () => {
  let pool: pg.Pool;
  const ids: Record<string, string> = {};
  const body = (r: { body: unknown }) => r.body as any;

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    const add = async (key: string, name: string, city: string, lat: number | null, lng: number | null, status: string, lot: string) => {
      const r = await pool.query(
        `INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, road_address, latitude, longitude, location_status, unit_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,100) RETURNING apartment_id`,
        [name, city, `${city}10100`, lot, `${lot} 도로`, lat, lng, status],
      );
      ids[key] = r.rows[0].apartment_id;
    };
    await add("a", "노형뜨란채", "50110", 33.4875, 126.4714, "VERIFIED_PARCEL", "제주시 노형동 1");
    await add("b", "남양맨션", "50110", 33.51, 126.52, "VERIFIED_PARCEL", "제주시 도남동 56-5");
    await add("c", "남양맨션", "50110", 33.505, 126.51, "VERIFIED_PARCEL", "제주시 용담이동 609-68");
    await add("d", "서귀포부영", "50130", 33.25, 126.52, "REVIEW", "서귀포시 서호동 1");
    await add("e", "100%행복", "50130", null, null, "NONE", "서귀포시 동홍동 1");
    await pool.query("INSERT INTO apartment_aliases (apartment_id, alias_name, source) VALUES ($1, '노형 뜨란채 아파트', 'REB_NM2')", [ids.a]);
    const tx = (key: string, apt: string | null, type: string, date: string, status = "ACTIVE", price = 500_000_000) =>
      pool.query(
        `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, floor,
           sale_price, deposit, monthly_rent, record_status, cancelled_on)
         VALUES ($1,$2,1,$3,'50110','노형동','노형뜨란채',$4,84.85,3,$5,$6,$7,$8,$9)`,
        type === "sale"
          ? ["sale", key, apt, date, price, null, null, status, status === "CANCELLED" ? date : null]
          : ["rent", key, apt, date, null, 20_000_000, 1_330_000, status, null],
      );
    const thisMonth = new Date().toISOString().slice(0, 7);
    await tx("s1", ids.a!, "sale", `${thisMonth}-01`, "ACTIVE", 598_000_000);
    await tx("s2", ids.a!, "sale", `${thisMonth}-02`, "CANCELLED", 999_000_000); // newer but cancelled
    await tx("s3", ids.a!, "sale", "2020-01-01"); // outside the 12-month window
    await tx("s4", null, "sale", `${thisMonth}-03`); // unmatched: never attributed
    await tx("r1", ids.a!, "rent", `${thisMonth}-01`);
  });
  afterAll(async () => {
    await pool?.end();
  });

  describe("search", () => {
    it("matches names and aliases ignoring spaces, prefix first", async () => {
      const r = await searchApartments(pool, { q: "노형 뜨란" });
      expect(r.status).toBe(200);
      expect(body(r).items.map((i: any) => i.name)).toEqual(["노형뜨란채"]);
    });

    it("returns same-named complexes with distinguishing addresses", async () => {
      const items = body(await searchApartments(pool, { q: "남양맨션" })).items;
      expect(items).toHaveLength(2);
      expect(new Set(items.map((i: any) => i.lot_address)).size).toBe(2);
    });

    it("filters by city and hides coordinates of unverified locations", async () => {
      const items = body(await searchApartments(pool, { q: "부영", city_code: "50130" })).items;
      expect(items).toEqual([expect.objectContaining({ name: "서귀포부영", lat: null, lng: null, location_status: "REVIEW" })]);
      expect(body(await searchApartments(pool, { q: "부영", city_code: "50110" })).items).toEqual([]);
    });

    it("treats LIKE wildcards literally", async () => {
      expect(body(await searchApartments(pool, { q: "%" })).items.map((i: any) => i.name)).toEqual(["100%행복"]);
      expect(body(await searchApartments(pool, { q: "_" })).items).toEqual([]);
    });

    it("validates input", async () => {
      expect((await searchApartments(pool, { q: "  " })).status).toBe(400);
      expect((await searchApartments(pool, { q: "a".repeat(31) })).status).toBe(400);
      expect((await searchApartments(pool, { q: "a", city_code: "11110" })).status).toBe(400);
      expect((await searchApartments(pool, { q: "a", limit: "999" })).status).toBe(400);
    });
  });

  describe("map", () => {
    it("returns only verified apartments inside the bbox", async () => {
      const r = body(await mapApartments(pool, { bbox: "126.40,33.40,126.60,33.60" }));
      expect(r.items.map((i: any) => i.name).sort()).toEqual(["남양맨션", "남양맨션", "노형뜨란채"]);
      expect(r.truncated).toBe(false);
      const small = body(await mapApartments(pool, { bbox: "126.46,33.48,126.48,33.49" }));
      expect(small.items).toEqual([expect.objectContaining({ id: ids.a, recent_count: 2 })]);
    });

    it("rejects malformed or non-Jeju boxes", async () => {
      for (const bbox of ["", "1,2,3", "126.6,33.4,126.4,33.6", "127.0,37.5,127.1,37.6", "a,b,c,d"]) {
        expect((await mapApartments(pool, { bbox })).status).toBe(400);
      }
    });
  });

  describe("detail", () => {
    it("summarises confirmed, active deals in the 12-month window", async () => {
      const d = body(await getApartment(pool, ids.a));
      expect(d.recent).toMatchObject({ sale_count: 1, rent_count: 1 });
      expect(d.recent.last_sale).toMatchObject({ sale_price: 598_000_000, area_m2: 84.85, floor: 3 });
      expect(d.recent.last_rent).toMatchObject({ deposit: 20_000_000, monthly_rent: 1_330_000 });
      expect(d.source.transactions).toContain("국토교통부");
    });

    it("reports an apartment without deals as an empty (not failed) summary", async () => {
      const d = body(await getApartment(pool, ids.b));
      expect(d.recent).toMatchObject({ sale_count: 0, rent_count: 0, last_sale: null, last_rent: null });
    });

    it("404s unknown ids and 400s malformed ones", async () => {
      expect((await getApartment(pool, "999999")).status).toBe(404);
      expect((await getApartment(pool, "1;drop")).status).toBe(400);
      expect((await getApartment(pool, undefined)).status).toBe(400);
    });
  });
});

describe("apartment APIs when the DB is down", () => {
  it("returns a generic 503", async () => {
    const dead = createPool("postgres://x:y@127.0.0.1:1/none", "disable");
    try {
      for (const r of [await searchApartments(dead, { q: "a" }), await mapApartments(dead, { bbox: "126.4,33.4,126.6,33.6" }), await getApartment(dead, "1")]) {
        expect(r.status).toBe(503);
      }
    } finally {
      await dead.end();
    }
  });
});
