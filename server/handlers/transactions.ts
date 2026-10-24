import type pg from "pg";
import { z } from "zod";
import { recentMonths } from "../collect/months.js";
import { serviceUnavailable, type HandlerResult } from "../http.js";

type Query = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const badRequest = (message: string): HandlerResult => ({ status: 400, body: { error: { code: "BAD_REQUEST", message } } });
const notFound: HandlerResult = { status: 404, body: { error: { code: "NOT_FOUND" } } };

const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "use YYYY-MM");
const SORTS = {
  date_desc: "contract_date DESC, transaction_id DESC",
  date_asc: "contract_date ASC, transaction_id ASC",
  price_desc: "coalesce(sale_price, deposit) DESC, monthly_rent DESC NULLS LAST, contract_date DESC",
  price_asc: "coalesce(sale_price, deposit) ASC, monthly_rent ASC NULLS FIRST, contract_date DESC",
  area_desc: "area_m2 DESC, contract_date DESC",
  area_asc: "area_m2 ASC, contract_date DESC",
} as const;

const listSchema = z.object({
  type: z.enum(["sale", "rent"]).default("sale"),
  from: ym.optional(),
  to: ym.optional(),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS, ...(keyof typeof SORTS)[]]).default("date_desc"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(20),
  area_min: z.coerce.number().min(0).max(1000).optional(),
  area_max: z.coerce.number().min(0).max(1000).optional(),
});

const SOURCE_BY_TYPE = { sale: "MOLIT_SALE", rent: "MOLIT_RENT" } as const;
const STALE_AFTER_MS = 36 * 3_600_000;

const toDeal = (r: Record<string, any>) => ({
  id: String(r.transaction_id),
  trade_type: r.trade_type,
  contract_date: r.contract_date,
  area_m2: Number(r.area_m2),
  floor: r.floor,
  sale_price: r.sale_price === null ? null : Number(r.sale_price),
  deposit: r.deposit === null ? null : Number(r.deposit),
  monthly_rent: r.monthly_rent === null ? null : Number(r.monthly_rent),
  contract_type: r.contract_type,
  contract_term: r.contract_term,
  apt_dong: r.apt_dong,
  registered_on: r.registered_on,
});

const DEAL_COLUMNS = `transaction_id, trade_type, to_char(contract_date,'YYYY-MM-DD') AS contract_date, area_m2, floor, sale_price, deposit,
  monthly_rent, contract_type, contract_term, apt_dong, to_char(registered_on,'YYYY-MM-DD') AS registered_on`;

// GET /api/apartments/{id}/transactions (SCR-003, FR-014~019). Only CONFIRMED + ACTIVE deals are listed:
// cancelled, vanished and unmatched rows never appear. Collection coverage is returned alongside so
// the UI can tell "no deals" from "data missing or delayed".
export async function listTransactions(pool: pg.Pool, id: string | undefined, query: Query, now: Date = new Date()): Promise<HandlerResult> {
  if (!id || !/^\d{1,18}$/.test(id)) return badRequest("invalid id");
  const parsed = listSchema.safeParse(Object.fromEntries(Object.entries(query).map(([k, v]) => [k, one(v) || undefined])));
  if (!parsed.success) return badRequest(parsed.error.issues[0]!.message);
  const p = parsed.data;
  const window = recentMonths(12, now).map((m) => `${m.slice(0, 4)}-${m.slice(4)}`);
  const from = p.from ?? window[0]!;
  const to = p.to ?? window.at(-1)!;
  if (from > to) return badRequest("from must not be after to");
  if (from < window[0]! || to > window.at(-1)!) return badRequest(`period must be within ${window[0]}..${window.at(-1)}`);
  if (p.area_min !== undefined && p.area_max !== undefined && p.area_min > p.area_max) return badRequest("area_min must not exceed area_max");
  const start = `${from}-01`;
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  const end = tm === 12 ? `${ty + 1}-01-01` : `${ty}-${String(tm + 1).padStart(2, "0")}-01`;

  try {
    const apt = await pool.query("SELECT apartment_id, name, city_code FROM apartments WHERE apartment_id = $1", [id]);
    if (!apt.rows[0]) return notFound;
    const cityCode: string = apt.rows[0].city_code;
    const where = `apartment_id = $1 AND trade_type = $2 AND record_status = 'ACTIVE' AND contract_date >= $3 AND contract_date < $4
      AND ($5::numeric IS NULL OR area_m2 >= $5) AND ($6::numeric IS NULL OR area_m2 <= $6)`;
    const args = [id, p.type, start, end, p.area_min ?? null, p.area_max ?? null];
    const total = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM transactions WHERE ${where}`, args);
    const rows = await pool.query(
      `SELECT ${DEAL_COLUMNS} FROM transactions WHERE ${where} ORDER BY ${SORTS[p.sort]} LIMIT $7 OFFSET $8`,
      [...args, p.page_size, (p.page - 1) * p.page_size],
    );
    // Area groups (whole ㎡) for filter chips, independent of the area filter itself.
    const areas = await pool.query<{ m2: number; n: number }>(
      `SELECT floor(area_m2)::int AS m2, count(*)::int AS n FROM transactions
        WHERE apartment_id = $1 AND trade_type = $2 AND record_status = 'ACTIVE' AND contract_date >= $3 AND contract_date < $4
        GROUP BY 1 ORDER BY 1`,
      [id, p.type, start, end],
    );
    const coverage = await pool.query<{ period: string; ok: boolean }>(
      `SELECT period, bool_or(status IN ('SUCCESS','PARTIAL')) AS ok FROM sync_jobs
        WHERE source_id = $1 AND city_code = $2 AND period = ANY($3) GROUP BY period`,
      [SOURCE_BY_TYPE[p.type], cityCode, window.filter((m) => m >= from && m <= to).map((m) => m.replace("-", ""))],
    );
    const lastSuccess = await pool.query<{ at: Date | null }>(
      "SELECT max(completed_at) AS at FROM sync_jobs WHERE source_id = $1 AND city_code = $2 AND status IN ('SUCCESS','PARTIAL')",
      [SOURCE_BY_TYPE[p.type], cityCode],
    );
    const okPeriods = new Set(coverage.rows.filter((r) => r.ok).map((r) => r.period));
    const missing = window.filter((m) => m >= from && m <= to && !okPeriods.has(m.replace("-", "")));
    const lastAt = lastSuccess.rows[0]?.at ?? null;
    return {
      status: 200,
      body: {
        apartment: { id: String(apt.rows[0].apartment_id), name: apt.rows[0].name, city_code: cityCode },
        filter: { type: p.type, from, to, sort: p.sort, area_min: p.area_min ?? null, area_max: p.area_max ?? null },
        page: { page: p.page, page_size: p.page_size, total: total.rows[0]!.n },
        items: rows.rows.map(toDeal),
        area_groups: areas.rows,
        data: {
          missing_months: missing,
          last_success_at: lastAt?.toISOString() ?? null,
          delayed: !lastAt || now.getTime() - lastAt.getTime() > STALE_AFTER_MS,
          source: "국토교통부 실거래가 공개시스템(공공데이터포털)",
        },
      },
      cacheSeconds: 300,
    };
  } catch {
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}

// GET /api/transactions/{id}: one deal, only if it is shown publicly (confirmed and active).
export async function getTransaction(pool: pg.Pool, id: string | undefined): Promise<HandlerResult> {
  if (!id || !/^\d{1,18}$/.test(id)) return badRequest("invalid id");
  try {
    const { rows } = await pool.query(
      `SELECT ${DEAL_COLUMNS}, t.apartment_id, a.name AS apartment_name
         FROM transactions t JOIN apartments a USING (apartment_id)
        WHERE t.transaction_id = $1 AND t.record_status = 'ACTIVE'`,
      [id],
    );
    if (!rows[0]) return notFound;
    return {
      status: 200,
      body: { ...toDeal(rows[0]), apartment: { id: String(rows[0].apartment_id), name: rows[0].apartment_name }, source: "국토교통부 실거래가 공개시스템(공공데이터포털)" },
      cacheSeconds: 300,
    };
  } catch {
    return serviceUnavailable("DB_UNAVAILABLE");
  }
}
