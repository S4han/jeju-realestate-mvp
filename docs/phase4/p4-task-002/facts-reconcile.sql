-- P4-TASK-002 read-only reconciliation of the AI summary facts (run with psql, then compare with
-- `npx tsx scripts/phase4/facts.ts --json`). Independent of the app code: no REGION_DEALS_SQL, no GROUPING SETS.
-- Window for "now" in October 2026: previous 2024-11-01..2025-10-31, recent 2025-11-01..2026-10-31.
-- Each query repeats the CTE "v" (temp views are not allowed in a read-only transaction). English titles on purpose.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

\echo '1) per region: recent / previous sales and median won per m2 (mapped deals) — movers, volume, small samples'
WITH v AS (
  SELECT t.apartment_id, t.contract_date, t.sale_price / t.area_m2 AS ppm, r.region_code
    FROM transactions t
    JOIN apartments a ON a.apartment_id = t.apartment_id
    JOIN p3_regions r ON r.set_id = (SELECT set_id FROM p3_region_sets WHERE status = 'ACTIVE')
                     AND r.level = 'UMD' AND r.region_code = left(a.legal_dong_code, 8) || '00'
   WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.sale_price > 0 AND t.area_m2 > 0
     AND t.contract_date >= DATE '2024-11-01' AND t.contract_date < DATE '2026-11-01'
     AND t.sgg_code || coalesce(left(t.umd_code, 3), substr(a.legal_dong_code, 6, 3)) = left(a.legal_dong_code, 8)
)
SELECT region_code,
       count(*) FILTER (WHERE contract_date >= DATE '2025-11-01') AS recent_n,
       count(*) FILTER (WHERE contract_date < DATE '2025-11-01') AS previous_n,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ppm) FILTER (WHERE contract_date >= DATE '2025-11-01')) AS recent_median,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ppm) FILTER (WHERE contract_date < DATE '2025-11-01')) AS previous_median
  FROM v GROUP BY 1 ORDER BY 1;

\echo '2) same-apartment comparison per region: apartments with >= 3 sales on both sides, median of their ratios'
WITH v AS (
  SELECT t.apartment_id, t.contract_date, t.sale_price / t.area_m2 AS ppm, r.region_code
    FROM transactions t
    JOIN apartments a ON a.apartment_id = t.apartment_id
    JOIN p3_regions r ON r.set_id = (SELECT set_id FROM p3_region_sets WHERE status = 'ACTIVE')
                     AND r.level = 'UMD' AND r.region_code = left(a.legal_dong_code, 8) || '00'
   WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.sale_price > 0 AND t.area_m2 > 0
     AND t.contract_date >= DATE '2024-11-01' AND t.contract_date < DATE '2026-11-01'
     AND t.sgg_code || coalesce(left(t.umd_code, 3), substr(a.legal_dong_code, 6, 3)) = left(a.legal_dong_code, 8)
), r AS (
  SELECT region_code, apartment_id, ppm, contract_date >= DATE '2025-11-01' AS recent FROM v
), m AS (
  SELECT region_code, apartment_id,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ppm) FILTER (WHERE recent) AS rm,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ppm) FILTER (WHERE NOT recent) AS pm
    FROM r GROUP BY 1, 2
  HAVING count(*) FILTER (WHERE recent) >= 3 AND count(*) FILTER (WHERE NOT recent) >= 3
)
SELECT region_code, count(*) AS apartments, round(((percentile_cont(0.5) WITHIN GROUP (ORDER BY rm / pm)) - 1)::numeric * 100, 1) AS change_pct
  FROM m GROUP BY 1 ORDER BY 1;

\echo '3) same-apartment comparison per city'
WITH v AS (
  SELECT t.apartment_id, t.contract_date, t.sale_price / t.area_m2 AS ppm, r.region_code
    FROM transactions t
    JOIN apartments a ON a.apartment_id = t.apartment_id
    JOIN p3_regions r ON r.set_id = (SELECT set_id FROM p3_region_sets WHERE status = 'ACTIVE')
                     AND r.level = 'UMD' AND r.region_code = left(a.legal_dong_code, 8) || '00'
   WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.sale_price > 0 AND t.area_m2 > 0
     AND t.contract_date >= DATE '2024-11-01' AND t.contract_date < DATE '2026-11-01'
     AND t.sgg_code || coalesce(left(t.umd_code, 3), substr(a.legal_dong_code, 6, 3)) = left(a.legal_dong_code, 8)
), m AS (
  SELECT left(region_code, 5) AS city, apartment_id,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ppm) FILTER (WHERE contract_date >= DATE '2025-11-01') AS rm,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ppm) FILTER (WHERE contract_date < DATE '2025-11-01') AS pm
    FROM v GROUP BY 1, 2
  HAVING count(*) FILTER (WHERE contract_date >= DATE '2025-11-01') >= 3 AND count(*) FILTER (WHERE contract_date < DATE '2025-11-01') >= 3
)
SELECT city, count(*) AS apartments, round(((percentile_cont(0.5) WITHIN GROUP (ORDER BY rm / pm)) - 1)::numeric * 100, 1) AS change_pct
  FROM m GROUP BY 1 ORDER BY 1;

ROLLBACK;
