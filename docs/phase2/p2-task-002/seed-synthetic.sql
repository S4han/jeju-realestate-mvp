-- 로컬 측정용 합성 데이터(운영 규모 근사): 단지 1,153, 36개월 매매 약 6,900건(해제 약 6.6%), 거래가 일부 단지에 몰리는 분포.
-- 운영 DB에서 실행하지 않는다.
INSERT INTO apartments (name, city_code, legal_dong_code, lot_address, location_status)
SELECT 'APT' || g, CASE WHEN g % 4 = 0 THEN '50130' ELSE '50110' END, '5011010100', 'lot ' || g, 'NONE'
  FROM generate_series(1, 1153) g;
INSERT INTO transactions (trade_type, natural_key, occurrence, apartment_id, sgg_code, umd_name, apt_name_raw, contract_date,
                          area_m2, floor, sale_price, record_status, cancelled_on)
SELECT 'sale', 'k' || s.g, 1, a.apartment_id, a.city_code, 'dong', a.name,
       DATE '2023-11-01' + (random() * 1087)::int,
       (ARRAY[59.98, 84.97, 84.42, 74.95, 101.9, 125.66])[1 + (s.g % 6)],
       1 + (s.g % 20),
       ((300 + random() * 900)::int) * 1000000,
       CASE WHEN s.g % 15 = 0 THEN 'CANCELLED' ELSE 'ACTIVE' END,
       CASE WHEN s.g % 15 = 0 THEN DATE '2026-01-01' END
  FROM (SELECT g, 1 + floor(power(random(), 2.2) * 1153)::int AS aid FROM generate_series(1, 6938) g) s
  JOIN apartments a ON a.apartment_id = s.aid;
INSERT INTO sync_jobs (source_id, city_code, period, status, completed_at, started_at)
SELECT 'MOLIT_SALE', c, to_char(m, 'YYYYMM'), 'SUCCESS', now() - interval '1 day', now() - interval '1 day'
  FROM generate_series(DATE '2023-11-01', DATE '2026-10-01', interval '1 month') m, unnest(ARRAY['50110','50130']) c;
ANALYZE;
