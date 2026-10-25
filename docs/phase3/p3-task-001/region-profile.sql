-- P3-TASK-001 read-only profile of region data in the production DB (no writes; run with psql).
-- Answers: how apartments/deals spread over legal dong codes, how many sit at ri level (need roll-up
-- to eup/myeon/dong), and whether the deal's own MOLIT code agrees with the apartment's code.
-- Titles are English on purpose (Korean \echo text breaks on the Windows console).
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';

\echo '1) apartments per city: total, distinct 10-digit codes, distinct eup/myeon/dong (8 digits), ri-level codes'
SELECT city_code, count(*) AS apartments,
       count(DISTINCT legal_dong_code) AS codes10,
       count(DISTINCT left(legal_dong_code, 8)) AS umd8,
       count(*) FILTER (WHERE right(legal_dong_code, 2) <> '00') AS ri_level
  FROM apartments GROUP BY 1 ORDER BY 1;

\echo '2) confirmed ACTIVE sales in the last 24 contract months per eup/myeon/dong (code8 + 00)'
SELECT left(a.legal_dong_code, 8) || '00' AS umd_code10, a.city_code,
       count(*) AS sales, count(DISTINCT a.apartment_id) AS apartments
  FROM transactions t JOIN apartments a ON a.apartment_id = t.apartment_id
 WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE'
   AND t.contract_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - interval '23 months'
 GROUP BY 1, 2 ORDER BY 2, 3 DESC;

\echo '3) distribution: eup/myeon/dong with 0 / 1-2 / >=3 sales in 24 months (only areas that have apartments)'
WITH r AS (
  SELECT left(a.legal_dong_code, 8) AS umd8, a.city_code,
         count(t.transaction_id) FILTER (WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE'
           AND t.contract_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - interval '23 months') AS n
    FROM apartments a LEFT JOIN transactions t ON t.apartment_id = a.apartment_id
   GROUP BY 1, 2)
SELECT city_code, count(*) FILTER (WHERE n = 0) AS zero, count(*) FILTER (WHERE n BETWEEN 1 AND 2) AS one_two,
       count(*) FILTER (WHERE n >= 3) AS three_plus, count(*) AS areas
  FROM r GROUP BY 1 ORDER BY 1;

\echo '4) deal code vs apartment code (confirmed sales): same umd, different umd, deal code missing'
SELECT a.city_code,
       count(*) FILTER (WHERE t.umd_code IS NOT NULL AND t.sgg_code || left(t.umd_code, 3) = left(a.legal_dong_code, 8)) AS same_umd,
       count(*) FILTER (WHERE t.umd_code IS NOT NULL AND t.sgg_code || left(t.umd_code, 3) <> left(a.legal_dong_code, 8)) AS diff_umd,
       count(*) FILTER (WHERE t.umd_code IS NULL) AS no_deal_code
  FROM transactions t JOIN apartments a ON a.apartment_id = t.apartment_id
 WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE'
 GROUP BY 1 ORDER BY 1;

\echo '5) unmatched ACTIVE sales per city in the last 24 months (would be "unmapped")'
SELECT t.sgg_code, count(*) AS unmatched
  FROM transactions t
 WHERE t.trade_type = 'sale' AND t.record_status = 'ACTIVE' AND t.apartment_id IS NULL
   AND t.contract_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - interval '23 months'
 GROUP BY 1 ORDER BY 1;

\echo '6) PostGIS availability (informational)'
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'postgis';

COMMIT;
