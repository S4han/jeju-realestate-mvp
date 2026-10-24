import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../server/db";
import { topApartments } from "../server/handlers/dashboard";
import { migrate } from "../scripts/migrate";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-24T03:00:00Z"); // window: 2025-11-01 ..

describe.skipIf(!url)("dashboard top apartments (DB)", () => {
  let pool: pg.Pool;
  const ids: Record<string, string> = {};
  let seq = 0;

  const addApt = async (key: string, city: string) => {
    const r = await pool.query(
      `INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, location_status)
       VALUES ($1,$2,$3,$4,'NONE') RETURNING apartment_id`,
      [`단지${key}`, city, `${city}10100`, `${key} 1`],
    );
    ids[key] = r.rows[0].apartment_id;
  };
  const sale = (apt: string | null, price: number, area: number, date = "2026-05-10", status = "ACTIVE") =>
    pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, floor,
         sale_price, record_status, cancelled_on)
       VALUES ('sale',$1,1,$2,'50110','동','단지',$3,$4,7,$5,$6,$7)`,
      [`k${++seq}`, apt, date, area, price, status, status === "CANCELLED" ? date : null],
    );

  beforeAll(async () => {
    pool = createPool(url!, "disable");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(pool);
    for (const k of ["A", "B", "C", "D", "E", "F"]) await addApt(k, "50110");
    await addApt("S", "50130");
    // A: big unit, highest price; small per-pyeong
    await sale(ids.A!, 1_500_000_000, 200);
    await sale(ids.A!, 900_000_000, 100);
    // B: small unit, highest per-pyeong
    await sale(ids.B!, 800_000_000, 50);
    for (const [k, p] of [["C", 700_000_000], ["D", 600_000_000], ["E", 500_000_000], ["F", 400_000_000]] as const) await sale(ids[k]!, p, 84);
    // Excluded: cancelled, unmatched, before the window, rent
    await sale(ids.F!, 9_000_000_000, 84, "2026-05-10", "CANCELLED");
    await sale(null, 9_000_000_000, 84);
    await sale(ids.E!, 9_000_000_000, 84, "2025-10-31");
    await pool.query(
      `INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date, area_m2, deposit, monthly_rent, record_status)
       VALUES ('rent','r1',1,$1,'50110','동','단지','2026-05-10',84,9000000000,0,'ACTIVE')`,
      [ids.D],
    );
    await sale(ids.S!, 650_000_000, 84);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("ranks by the highest confirmed active sale per complex, top 5 per city", async () => {
    const r = await topApartments(pool, NOW);
    expect(r.status).toBe(200);
    const body = r.body as any;
    const jeju = body.by_price["50110"];
    expect(jeju.map((x: any) => x.name)).toEqual(["단지A", "단지B", "단지C", "단지D", "단지E"]);
    expect(jeju[0]).toMatchObject({ rank: 1, sale_count: 2, deal: { sale_price: 1_500_000_000, area_m2: 200, contract_date: "2026-05-10", floor: 7 } });
    // Cancelled, unmatched, out-of-window and rent rows never inflate a rank.
    expect(Math.max(...jeju.map((x: any) => x.deal.sale_price))).toBe(1_500_000_000);
    expect(body.by_price["50130"].map((x: any) => x.name)).toEqual(["단지S"]);
  });

  it("per-pyeong ranking uses price / (area / 3.3058) and can differ from the price ranking", async () => {
    const body = (await topApartments(pool, NOW)).body as any;
    const jeju = body.by_per_pyeong["50110"];
    expect(jeju[0].name).toBe("단지B");
    expect(jeju[0].deal.price_per_pyeong).toBe(Math.round(800_000_000 / (50 / 3.3058)));
    // A is represented by its best per-pyeong deal, not by its highest-price deal.
    const a = jeju.find((x: any) => x.name === "단지A");
    expect(a.deal.sale_price).toBe(900_000_000);
  });

  it("returns 503 without details when the DB is unreachable", async () => {
    const down = createPool("postgres://nobody:PASSWORD@127.0.0.1:1/none", "disable");
    const r = await topApartments(down, NOW);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain("127.0.0.1");
    await down.end();
  });
});
