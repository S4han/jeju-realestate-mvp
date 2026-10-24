# 데이터 모델 v1.0 (설계 확정, 스키마 구현 전)

## apartments
apartment_id(PK), name, city_code, legal_dong_code, road_address, lot_address, latitude, longitude, location_status, source_updated_at. 공식 단지 ID는 출처별 별도 매핑으로 관리.

## transactions
transaction_id(PK), apartment_id(nullable FK), trade_type(sale/rent), contract_date, area_m2, floor, sale_price, deposit, monthly_rent, source_key, record_status, source_updated_at. 금액은 원 단위 정수, 면적은 decimal. 확정 매칭만 apartment_id 설정.

## apartment_aliases
alias_id(PK), apartment_id(FK), alias_name, source, verified_at.

## match_reviews
review_id(PK), transaction_id(FK), candidate_apartment_id(nullable), match_rule, match_status(CONFIRMED/PENDING/REJECTED), evidence, reviewed_at.

## sync_jobs
job_id(PK), source_id, period, status, record_count, started_at, completed_at, error_code.

## 필수 제약
- 원천 ID가 없을 때 중복 판정 키는 실제 응답 확인 후 설계.
- 정정/취소가 원본 레코드와 연결되는 방식은 API 검증 후 확정.
- 단지명만 같은 거래는 자동 연결하지 않음.
- 지도 영역 조회를 위한 좌표 인덱스, 거래 조회용 apartment_id/contract_date 인덱스, 이름 검색 인덱스 검토.
- 원천 데이터 보존/재배포 약관 확인 후 원본 보관 범위 결정.
