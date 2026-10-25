// Region of each valid sale (P3-D2): the confirmed apartment's legal dong code rolled up to its eup/myeon/dong
// in the given region set. Deals the region cannot be trusted for are isolated, never guessed:
//   UNMATCHED       — no confirmed apartment (counted only at city level, by the deal's own sgg_code)
//   CODE_NOT_IN_SET — the apartment's eup/myeon/dong is not in the region set
//   CODE_CONFLICT   — the deal's own MOLIT code points at a different eup/myeon/dong than the apartment
//   MAPPED          — usable for region statistics
import type pg from "pg";

export type MappingStatus = "MAPPED" | "UNMATCHED" | "CODE_NOT_IN_SET" | "CODE_CONFLICT";

// Phase 2's valid-sale definition (server/phase2/analysis.ts VALID) without the apartment filter,
// so unmatched sales can be counted per city. $2/$3 = [from, to) contract dates.
export const REGION_DEALS_SQL = `
  SELECT t.transaction_id, t.sgg_code AS deal_city, t.contract_date, t.sale_price, t.area_m2, t.apartment_id,
         r.region_code,
         CASE
           WHEN t.apartment_id IS NULL THEN 'UNMATCHED'
           WHEN r.region_code IS NULL THEN 'CODE_NOT_IN_SET'
           WHEN t.sgg_code || coalesce(left(t.umd_code, 3), substr(a.legal_dong_code, 6, 3)) <> left(a.legal_dong_code, 8) THEN 'CODE_CONFLICT'
           ELSE 'MAPPED'
         END AS mapping_status
    FROM transactions t
    LEFT JOIN apartments a ON a.apartment_id = t.apartment_id
    LEFT JOIN p3_regions r ON r.set_id = $1::bigint AND r.level = 'UMD' AND r.region_code = left(a.legal_dong_code, 8) || '00'
   WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.sale_price > 0 AND t.area_m2 > 0
     AND t.contract_date >= $2 AND t.contract_date < $3`;

export type MappingSummary = {
  byRegion: Map<string, number>;
  byCity: Map<string, Record<MappingStatus, number>>;
};

/** Counts of valid sales per region and per city/status — the basis of the city = regions + unmapped check. */
export async function summarizeMapping(c: pg.PoolClient | pg.Pool, setId: string, from: string, to: string): Promise<MappingSummary> {
  const { rows } = await c.query<{ deal_city: string; region_code: string | null; mapping_status: MappingStatus; n: number }>(
    `SELECT deal_city, region_code, mapping_status, count(*)::int AS n FROM (${REGION_DEALS_SQL}) d GROUP BY 1, 2, 3`,
    [setId, from, to],
  );
  const byRegion = new Map<string, number>();
  const byCity = new Map<string, Record<MappingStatus, number>>();
  for (const r of rows) {
    const city = byCity.get(r.deal_city) ?? { MAPPED: 0, UNMATCHED: 0, CODE_NOT_IN_SET: 0, CODE_CONFLICT: 0 };
    city[r.mapping_status] += r.n;
    byCity.set(r.deal_city, city);
    if (r.mapping_status === "MAPPED" && r.region_code) byRegion.set(r.region_code, (byRegion.get(r.region_code) ?? 0) + r.n);
  }
  return { byRegion, byCity };
}
