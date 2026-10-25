-- P3-TASK-007 read-only reconciliation of Phase 3 region statistics on the production DB (run with psql).
-- Recomputes, in plain SQL independent of the app code, what /api/v3/regions/statistics returns for
-- 24 months (2024-11-01 ≤ contract_date < 2026-11-01 for October 2026), so the two can be compared.
-- Each query repeats the same CTE "v" (temp views are not allowed in a read-only transaction).
-- Titles are English on purpose (Korean \echo text breaks on the Windows console).
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';

\echo '1) active region set'
SELECT set_id, status, code_as_of, boundary_as_of, (SELECT count(*) FROM p3_regions p WHERE p.set_id = s.set_id) AS regions
  FROM p3_region_sets s ORDER BY set_id;

\echo '2) per city: valid sales, placed in a region, unmatched, code conflict, code not in set, check (must be 0)'
WITH v AS (
  SELECT t.transaction_id, t.sgg_code, t.contract_date, t.sale_price, t.area_m2, t.umd_code,
         a.legal_dong_code, left(a.legal_dong_code, 8) || '00' AS umd10,
         r.region_code
    FROM transactions t
    LEFT JOIN apartments a ON a.apartment_id = t.apartment_id
    LEFT JOIN p3_regions r ON r.set_id = (SELECT set_id FROM p3_region_sets WHERE status = 'ACTIVE')
                           AND r.level = 'UMD' AND r.region_code = left(a.legal_dong_code, 8) || '00'
   WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.sale_price > 0 AND t.area_m2 > 0
     AND t.contract_date >= DATE '2024-11-01' AND t.contract_date < DATE '2026-11-01'
)
SELECT sgg_code,
       count(*) AS total,
       count(*) FILTER (WHERE legal_dong_code IS NOT NULL AND region_code IS NOT NULL
                        AND sgg_code || coalesce(left(umd_code, 3), substr(legal_dong_code, 6, 3)) = left(legal_dong_code, 8)) AS mapped,
       count(*) FILTER (WHERE legal_dong_code IS NULL) AS unmatched,
       count(*) FILTER (WHERE legal_dong_code IS NOT NULL AND region_code IS NOT NULL
                        AND sgg_code || coalesce(left(umd_code, 3), substr(legal_dong_code, 6, 3)) <> left(legal_dong_code, 8)) AS conflict,
       count(*) FILTER (WHERE legal_dong_code IS NOT NULL AND region_code IS NULL) AS not_in_set,
       count(*) - count(DISTINCT transaction_id) AS duplicated_rows
  FROM v GROUP BY 1 ORDER BY 1;

\echo '3) per eup/myeon/dong (mapped only): sales and median won per m2 (rounded) — compare with the API'
WITH v AS (
  SELECT t.transaction_id, t.sgg_code, t.contract_date, t.sale_price, t.area_m2, t.umd_code,
         a.legal_dong_code, left(a.legal_dong_code, 8) || '00' AS umd10,
         r.region_code
    FROM transactions t
    LEFT JOIN apartments a ON a.apartment_id = t.apartment_id
    LEFT JOIN p3_regions r ON r.set_id = (SELECT set_id FROM p3_region_sets WHERE status = 'ACTIVE')
                           AND r.level = 'UMD' AND r.region_code = left(a.legal_dong_code, 8) || '00'
   WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.sale_price > 0 AND t.area_m2 > 0
     AND t.contract_date >= DATE '2024-11-01' AND t.contract_date < DATE '2026-11-01'
)
SELECT region_code, count(*) AS sales,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price / area_m2)) AS median_won_per_m2
  FROM v
 WHERE region_code IS NOT NULL AND sgg_code || coalesce(left(umd_code, 3), substr(legal_dong_code, 6, 3)) = left(legal_dong_code, 8)
 GROUP BY 1 ORDER BY 1;

\echo '4) per city (mapped only): sales and median won per m2'
WITH v AS (
  SELECT t.transaction_id, t.sgg_code, t.contract_date, t.sale_price, t.area_m2, t.umd_code,
         a.legal_dong_code, left(a.legal_dong_code, 8) || '00' AS umd10,
         r.region_code
    FROM transactions t
    LEFT JOIN apartments a ON a.apartment_id = t.apartment_id
    LEFT JOIN p3_regions r ON r.set_id = (SELECT set_id FROM p3_region_sets WHERE status = 'ACTIVE')
                           AND r.level = 'UMD' AND r.region_code = left(a.legal_dong_code, 8) || '00'
   WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.sale_price > 0 AND t.area_m2 > 0
     AND t.contract_date >= DATE '2024-11-01' AND t.contract_date < DATE '2026-11-01'
)
SELECT left(region_code, 5) AS city, count(*) AS sales,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price / area_m2)) AS median_won_per_m2
  FROM v
 WHERE region_code IS NOT NULL AND sgg_code || coalesce(left(umd_code, 3), substr(legal_dong_code, 6, 3)) = left(legal_dong_code, 8)
 GROUP BY 1 ORDER BY 1;

\echo '5) regions of the active set with apartments but no sales in the window, and regions without apartments'
WITH v AS (
  SELECT t.transaction_id, t.sgg_code, t.contract_date, t.sale_price, t.area_m2, t.umd_code,
         a.legal_dong_code, left(a.legal_dong_code, 8) || '00' AS umd10,
         r.region_code
    FROM transactions t
    LEFT JOIN apartments a ON a.apartment_id = t.apartment_id
    LEFT JOIN p3_regions r ON r.set_id = (SELECT set_id FROM p3_region_sets WHERE status = 'ACTIVE')
                           AND r.level = 'UMD' AND r.region_code = left(a.legal_dong_code, 8) || '00'
   WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.sale_price > 0 AND t.area_m2 > 0
     AND t.contract_date >= DATE '2024-11-01' AND t.contract_date < DATE '2026-11-01'
)
SELECT r.city_code,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM apartments a WHERE left(a.legal_dong_code, 8) = left(r.region_code, 8))
                        AND NOT EXISTS (SELECT 1 FROM v WHERE v.region_code = r.region_code)) AS apartments_no_sales,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM apartments a WHERE left(a.legal_dong_code, 8) = left(r.region_code, 8))) AS no_apartments
  FROM p3_regions r WHERE r.set_id = (SELECT set_id FROM p3_region_sets WHERE status = 'ACTIVE') AND r.level = 'UMD'
 GROUP BY 1 ORDER BY 1;

ROLLBACK;
