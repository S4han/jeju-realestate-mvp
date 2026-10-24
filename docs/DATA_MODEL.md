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

## 구현 반영 (TASK-002, db/migrations/0001_init.sql)
TASK-001 실측 결과를 반영해 설계를 아래처럼 구체화했다.
- `apartments`: `pnu`, `unit_count`, `approved_on`을 추가했다. `location_status`는 `VERIFIED_PARCEL`/`REVIEW`/`NONE` 세 값이다. 좌표는 제주 범위(위도 33~34, 경도 126~127)만 허용하고, 좌표가 없으면 VERIFIED 상태가 될 수 없다.
- `apartment_source_ids`: 출처별 공식 ID 매핑 테이블이다(`REB` complex_pk, `MOLIT_APTSEQ`, `KAPT`). (source, source_id)는 단지 하나에만 연결된다.
- `transactions`: 원천에 고유키가 없으므로 `(trade_type, natural_key, occurrence)`를 유일키로 쓴다. 해제 거래는 `record_status=CANCELLED` + `cancelled_on`으로 별도 행에 보관한다. 원천 위치 필드(`source_apt_seq`, `umd_code`, `jibun`, `apt_name_raw`)를 보존한다. 매매와 전월세의 금액 형태는 CHECK 제약으로 강제한다.
- `match_reviews`: `reason` 컬럼을 추가했다(예: `NOT_IN_REB`). CONFIRMED는 후보 단지가 있어야 한다.
- `sync_jobs`: `city_code`, `api_calls`, `error_message`(비밀값 금지)를 추가했다.
- `api_usage`: 출처별 일일 외부 호출 수(FR-020 예산 관리)를 기록한다.
- natural_key 구성과 occurrence 배정 규칙(해제 전환 시 안정성 포함)은 TASK-004에서 확정한다.
