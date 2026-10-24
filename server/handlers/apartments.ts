import type pg from "pg";
import { z } from "zod";
import { recentMonths } from "../collect/months.js";
import { serviceUnavailable, type HandlerResult } from "../http.js";

type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const badRequest = (message: string): HandlerResult => ({ status: 400, body: { error: { code: "BAD_REQUEST", message } } });

const citySchema = z.enum(["50110", "50130"]).optional();

// Start of the 12-contract-month window (current month included, KST).
export const windowStart = (now: Date) => {
  const first = recentMonths(12, now)[0]!;
  return `${first.slice(0, 4)}-${first.slice(4)}-01`;
};

export type ApartmentListItem = {
  id: string;
  name: string;
  city_code: string;
  road_address: string | null;
  lot_address: string | null;
  lat: number | null;
  lng: number | null;
  location_status: string;
};

const toItem = (r: Record<string, any>): ApartmentListItem => ({
  id: String(r.apartment_id),
  name: r.name,
  city_code: r.city_code,
  road_address: r.road_address,
  lot_address: r.lot_address,
  // Coordinates are only exposed for verified locations (no false markers, AT-006).
  lat: r.location_status === "VERIFIED_PARCEL" ? Number(r.latitude) : null,
  lng: r.location_status === "VERIFIED_PARCEL" ? Number(r.longitude) : null,
  location_status: r.location_status,
});

const searchSchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "q is required")
    .max(30, "q is too long")
    // Control characters (e.g. NUL, which PostgreSQL rejects) are input errors, not outages.
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "q contains control characters"),
  city_code: citySchema,
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

// GET /api/apartments/search: name/alias partial match, spaces ignored (FR-001, FR-003).
export async function searchApartments(pool: pg.Pool, query: Query): Promise<HandlerResult> {
  const parsed = searchSchema.safeParse({ q: one(query.q), city_code: one(query.city_code) || undefined, limit: one(query.limit) });
  if (!parsed.success) return badRequest(parsed.error.issues[0]!.message);
  const { q, city_code, limit } = parsed.data;
  const needle = q.toLowerCase().replace(/\s+/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
  try {
    const { rows } = await pool.query(
      `WITH names AS (
         SELECT apartment_id, regexp_replace(lower(name), '\\s', '', 'g') AS n FROM apartments
         UNION ALL
         SELECT apartment_id, regexp_replace(lower(alias_name), '\\s', '', 'g') FROM apartment_aliases
       ), hits AS (
         SELECT apartment_id, bool_or(n LIKE $1 || '%') AS prefix FROM names WHERE n LIKE '%' || $1 || '%' GROUP BY apartment_id
       )
       SELECT a.*, h.prefix,
              (SELECT count(*) FROM transactions t WHERE t.apartment_id = a.apartment_id AND t.record_status = 'ACTIVE' AND t.contract_date >= $4) AS recent
         FROM hits h JOIN apartments a USING (apartment_id)
        WHERE ($2::text IS NULL OR a.city_code = $2)
        ORDER BY h.prefix DESC, recent DESC, a.name
        LIMIT $3`,
      [needle, city_code ?? null, limit, windowStart(new Date())],
    );
    return { status: 200, body: { items: rows.map(toItem) }, cacheSeconds: 300 };
  } catch {
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}

// Generous box around Jeju island; requests outside are rejected rather than scanned.
const JEJU = { minLat: 32.9, maxLat: 33.9, minLng: 125.9, maxLng: 127.2 };
export const MAP_LIMIT = 1200; // all verified Jeju apartments (~1,090) fit; clustering handles density

const mapSchema = z.object({
  bbox: z
    .string()
    .transform((s) => s.split(",").map(Number))
    .refine((a) => a.length === 4 && a.every(Number.isFinite), "bbox must be minLng,minLat,maxLng,maxLat")
    .refine(([x1, y1, x2, y2]) => x1! < x2! && y1! < y2!, "bbox min must be below max")
    .refine(([x1, y1, x2, y2]) => x2! >= JEJU.minLng && x1! <= JEJU.maxLng && y2! >= JEJU.minLat && y1! <= JEJU.maxLat, "bbox must overlap Jeju"),
  city_code: citySchema,
});

// GET /api/apartments/map: verified markers inside the current map bounds (FR-005, FR-006).
export async function mapApartments(pool: pg.Pool, query: Query): Promise<HandlerResult> {
  const parsed = mapSchema.safeParse({ bbox: one(query.bbox) ?? "", city_code: one(query.city_code) || undefined });
  if (!parsed.success) return badRequest(parsed.error.issues[0]!.message);
  const [minLng, minLat, maxLng, maxLat] = parsed.data.bbox as [number, number, number, number];
  try {
    const { rows } = await pool.query(
      `SELECT apartment_id, name, latitude, longitude,
              (SELECT count(*) FROM transactions t WHERE t.apartment_id = a.apartment_id AND t.record_status = 'ACTIVE' AND t.contract_date >= $6) AS recent
         FROM apartments a
        WHERE location_status = 'VERIFIED_PARCEL'
          AND latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4
          AND ($5::text IS NULL OR city_code = $5)
        ORDER BY recent DESC, apartment_id
        LIMIT ${MAP_LIMIT + 1}`,
      [minLat, maxLat, minLng, maxLng, parsed.data.city_code ?? null, windowStart(new Date())],
    );
    const truncated = rows.length > MAP_LIMIT;
    return {
      status: 200,
      body: {
        items: rows.slice(0, MAP_LIMIT).map((r) => ({ id: String(r.apartment_id), name: r.name, lat: Number(r.latitude), lng: Number(r.longitude), recent_count: Number(r.recent) })),
        truncated,
      },
      cacheSeconds: 300,
    };
  } catch {
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}

// GET /api/apartments/{id}: summary card (SCR-002). Only confirmed, non-cancelled deals count.
export async function getApartment(pool: pg.Pool, id: string | undefined, now: Date = new Date()): Promise<HandlerResult> {
  if (!id || !/^\d{1,18}$/.test(id)) return badRequest("invalid id");
  try {
    const apt = await pool.query("SELECT * FROM apartments WHERE apartment_id = $1", [id]);
    if (!apt.rows[0]) return { status: 404, body: { error: { code: "NOT_FOUND" } } };
    const from = windowStart(now);
    const stats = await pool.query(
      `SELECT trade_type, count(*)::int AS n FROM transactions
        WHERE apartment_id = $1 AND record_status = 'ACTIVE' AND contract_date >= $2 GROUP BY trade_type`,
      [id, from],
    );
    const latest = await pool.query(
      `SELECT DISTINCT ON (trade_type) trade_type, to_char(contract_date, 'YYYY-MM-DD') AS contract_date, area_m2, floor, sale_price, deposit, monthly_rent
         FROM transactions WHERE apartment_id = $1 AND record_status = 'ACTIVE' AND contract_date >= $2
        ORDER BY trade_type, contract_date DESC, transaction_id DESC`,
      [id, from],
    );
    const count = (t: string) => stats.rows.find((r) => r.trade_type === t)?.n ?? 0;
    const last = (t: string) => {
      const r = latest.rows.find((x) => x.trade_type === t);
      return r
        ? { contract_date: r.contract_date, area_m2: Number(r.area_m2), floor: r.floor, sale_price: r.sale_price === null ? null : Number(r.sale_price), deposit: r.deposit === null ? null : Number(r.deposit), monthly_rent: r.monthly_rent === null ? null : Number(r.monthly_rent) }
        : null;
    };
    const a = apt.rows[0];
    return {
      status: 200,
      body: {
        ...toItem(a),
        unit_count: a.unit_count,
        approved_on: a.approved_on ? new Date(a.approved_on).toISOString().slice(0, 10) : null,
        recent: { from, sale_count: count("sale"), rent_count: count("rent"), last_sale: last("sale"), last_rent: last("rent") },
        source: { reference: "한국부동산원 공동주택 단지 식별정보", transactions: "국토교통부 실거래가 공개시스템(공공데이터포털)", reference_as_of: a.source_updated_at },
      },
      cacheSeconds: 300,
    };
  } catch {
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}
