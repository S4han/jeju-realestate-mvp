import type pg from "pg";
import { serviceUnavailable, type HandlerResult } from "../http.js";
import { windowStart } from "./apartments.js";

export const PYEONG_M2 = 3.3058;
const TOP_N = 5;
const CITIES = ["50110", "50130"] as const;

// Whitelisted ranking expressions (never built from input).
const METRICS = {
  price: "t.sale_price",
  per_pyeong: `t.sale_price / (t.area_m2 / ${PYEONG_M2})`,
} as const;
type Metric = keyof typeof METRICS;

export type TopApartment = {
  rank: number;
  id: string;
  name: string;
  road_address: string | null;
  lot_address: string | null;
  sale_count: number;
  deal: { contract_date: string; area_m2: number; floor: number | null; sale_price: number; price_per_pyeong: number };
};

// Each complex is represented by its single highest deal under the metric (shown as is, with its
// area, floor and date, so an unusual deal is visible rather than hidden), then ranked per city.
// Same publication rule as the detail APIs: confirmed matches only (apartment_id set), ACTIVE sales,
// contract date within the 12-month window.
async function topBy(pool: pg.Pool, metric: Metric, from: string): Promise<Record<string, TopApartment[]>> {
  const expr = METRICS[metric];
  const { rows } = await pool.query(
    `WITH best AS (
       SELECT DISTINCT ON (t.apartment_id)
              t.apartment_id, a.name, a.city_code, a.road_address, a.lot_address,
              to_char(t.contract_date, 'YYYY-MM-DD') AS contract_date, t.area_m2, t.floor, t.sale_price,
              ${METRICS.per_pyeong} AS per_pyeong, ${expr} AS score
         FROM transactions t JOIN apartments a USING (apartment_id)
        WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.contract_date >= $1
        ORDER BY t.apartment_id, ${expr} DESC, t.contract_date DESC, t.transaction_id DESC
     ), ranked AS (
       SELECT best.*, row_number() OVER (PARTITION BY city_code ORDER BY score DESC, apartment_id) AS rank
         FROM best
     )
     SELECT r.*, (SELECT count(*)::int FROM transactions c
                   WHERE c.apartment_id = r.apartment_id AND c.trade_type = 'sale' AND c.record_status = 'ACTIVE' AND c.contract_date >= $1) AS sale_count
       FROM ranked r WHERE rank <= $2 ORDER BY city_code, rank`,
    [from, TOP_N],
  );
  const out: Record<string, TopApartment[]> = Object.fromEntries(CITIES.map((c) => [c, []]));
  for (const r of rows) {
    out[r.city_code]?.push({
      rank: Number(r.rank),
      id: String(r.apartment_id),
      name: r.name,
      road_address: r.road_address,
      lot_address: r.lot_address,
      sale_count: r.sale_count,
      deal: {
        contract_date: r.contract_date,
        area_m2: Number(r.area_m2),
        floor: r.floor,
        sale_price: Number(r.sale_price),
        price_per_pyeong: Math.round(Number(r.per_pyeong)),
      },
    });
  }
  return out;
}

// GET /api/dashboard/top-apartments: most expensive complexes per city (TASK-010).
export async function topApartments(pool: pg.Pool, now: Date = new Date()): Promise<HandlerResult> {
  const from = windowStart(now);
  try {
    const [price, perPyeong] = await Promise.all([topBy(pool, "price", from), topBy(pool, "per_pyeong", from)]);
    return {
      status: 200,
      body: { from, top_n: TOP_N, by_price: price, by_per_pyeong: perPyeong, source: "국토교통부 실거래가 공개시스템(공공데이터포털)" },
      cacheSeconds: 300,
    };
  } catch {
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}
