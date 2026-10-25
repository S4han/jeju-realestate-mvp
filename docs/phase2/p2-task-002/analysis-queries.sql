-- P2-TASK-002 측정용 프로토타입: 사전 집계 없이 원본 거래에서 바로 계산(대안 B).
-- psql 변수: :apt(단지 ID) :area(면적 유형, 정수부) :from(기간 시작일) :to(기간 끝 다음날)
-- 유효 거래 정의(PRD v1.3): 매매, ACTIVE, 확정 매칭(apartment_id 있음), 계약일 [from, to).
\set QUIET on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;   -- 한 응답 안의 모든 값이 같은 스냅샷

-- 1) 데이터 버전: 이 단지 유효 거래 집합 + 해당 시 수집 상태의 지문. 하나라도 바뀌면 값이 바뀐다.
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT md5(coalesce((SELECT string_agg(t.transaction_id || ':' || t.sale_price || ':' || t.area_m2 || ':' || t.contract_date, ',' ORDER BY t.transaction_id)
                       FROM transactions t
                      WHERE t.apartment_id = :apt AND t.trade_type = 'sale' AND t.record_status = 'ACTIVE'
                        AND t.contract_date >= :'from' AND t.contract_date < :'to'), '')
        || '|' ||
        coalesce((SELECT string_agg(j.period || j.status || coalesce(j.completed_at::text, ''), ',' ORDER BY j.period)
                    FROM (SELECT DISTINCT ON (period) period, status, completed_at FROM sync_jobs
                           WHERE source_id = 'MOLIT_SALE' AND city_code = (SELECT city_code FROM apartments WHERE apartment_id = :apt)
                             AND period >= to_char(:'from'::date, 'YYYYMM') AND period < to_char(:'to'::date, 'YYYYMM')
                           ORDER BY period, started_at DESC) j), '')) AS data_version;

-- 2) 면적 유형 목록(areas): 유형별 건수, 기본 유형 = 건수 최다(동률 시 작은 유형)
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT floor(area_m2)::int AS area_type, count(*) AS trade_count
  FROM transactions
 WHERE apartment_id = :apt AND trade_type = 'sale' AND record_status = 'ACTIVE' AND contract_date >= :'from' AND contract_date < :'to'
 GROUP BY 1 ORDER BY 2 DESC, 1;

-- 3) 기간 요약(summary): 건수·중위·최저·최고·㎡당 중위
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT count(*) AS trade_count,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) AS median_price,
       min(sale_price), max(sale_price),
       percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price / area_m2) AS median_per_m2
  FROM transactions
 WHERE apartment_id = :apt AND trade_type = 'sale' AND record_status = 'ACTIVE' AND floor(area_m2) = :area
   AND contract_date >= :'from' AND contract_date < :'to';

-- 4) 분기 보조선 + 월별 거래량(monthly)
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT to_char(contract_date, 'YYYY"Q"Q') AS quarter, count(*) AS n,
       CASE WHEN count(*) >= 3 THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY sale_price) END AS median_price
  FROM transactions
 WHERE apartment_id = :apt AND trade_type = 'sale' AND record_status = 'ACTIVE' AND floor(area_m2) = :area
   AND contract_date >= :'from' AND contract_date < :'to'
 GROUP BY 1 ORDER BY 1;

-- 5) 그래프 점(points) + 같은 조건 건수(sameConditionCount)
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT transaction_id, contract_date, sale_price, area_m2, floor,
       count(*) OVER (PARTITION BY contract_date, area_m2, floor, sale_price) AS same_condition_count
  FROM transactions
 WHERE apartment_id = :apt AND trade_type = 'sale' AND record_status = 'ACTIVE' AND floor(area_m2) = :area
   AND contract_date >= :'from' AND contract_date < :'to'
 ORDER BY contract_date DESC, transaction_id DESC LIMIT 500;

-- 6) 근거 거래 페이지(keyset): 커서 = (마지막 contract_date, transaction_id)
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON)
SELECT transaction_id, contract_date, sale_price, area_m2, floor
  FROM transactions
 WHERE apartment_id = :apt AND trade_type = 'sale' AND record_status = 'ACTIVE' AND floor(area_m2) = :area
   AND contract_date >= :'from' AND contract_date < :'to'
   AND (contract_date, transaction_id) < (DATE '2025-06-01', 999999999)
 ORDER BY contract_date DESC, transaction_id DESC LIMIT 20;
ROLLBACK;
