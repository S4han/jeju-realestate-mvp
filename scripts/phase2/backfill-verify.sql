-- Phase 2 과거 매매 수집(2023-11~2025-10) 검증. 읽기 전용, 집계 값만 출력.
SET default_transaction_read_only = on;
BEGIN READ ONLY;
\pset footer off
\echo '== 1. sync_jobs: MOLIT_SALE 과거 월 최신 상태 (월×시 48칸이 모두 SUCCESS면 정상)'
WITH latest AS (
  SELECT DISTINCT ON (city_code, period) city_code, period, status, record_count, error_code
    FROM sync_jobs WHERE source_id = 'MOLIT_SALE' AND period BETWEEN '202311' AND '202510'
   ORDER BY city_code, period, started_at DESC)
SELECT city_code, count(*) AS months, count(*) FILTER (WHERE status = 'SUCCESS') AS success,
       count(*) FILTER (WHERE status = 'PARTIAL') AS partial, count(*) FILTER (WHERE status = 'FAILED') AS failed,
       sum(record_count) AS records
  FROM latest GROUP BY 1 ORDER BY 1;

\echo '== 2. 과거 월 매매 건수와 매칭 (월별)'
SELECT to_char(contract_date, 'YYYYMM') AS month,
       count(*) FILTER (WHERE record_status = 'ACTIVE') AS active,
       count(*) FILTER (WHERE record_status = 'CANCELLED') AS cancelled,
       count(*) FILTER (WHERE record_status = 'ACTIVE' AND apartment_id IS NOT NULL) AS active_confirmed
  FROM transactions
 WHERE trade_type = 'sale' AND contract_date >= '2023-11-01' AND contract_date < '2025-11-01'
 GROUP BY 1 ORDER BY 1;

\echo '== 3. 기간별 확정 매칭률 (유효 매매)'
SELECT CASE WHEN contract_date < '2025-11-01' THEN 'backfill 2023-11~2025-10' ELSE 'phase1 2025-11~' END AS span,
       count(*) AS active, count(*) FILTER (WHERE apartment_id IS NOT NULL) AS confirmed,
       round(100.0 * count(*) FILTER (WHERE apartment_id IS NOT NULL) / nullif(count(*), 0), 1) AS confirmed_pct
  FROM transactions WHERE trade_type = 'sale' AND record_status = 'ACTIVE'
 GROUP BY 1 ORDER BY 1;

\echo '== 4. 전체 상태와 용량'
SELECT trade_type, record_status, count(*) AS n, min(contract_date) AS min_date, max(contract_date) AS max_date
  FROM transactions GROUP BY 1, 2 ORDER BY 1, 2;
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
ROLLBACK;
