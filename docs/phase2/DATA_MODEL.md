# Phase 2 데이터 모델·마이그레이션 설계

> 상태: 최종 승인 반영 설계 문서 / 실제 API·DB·요금제 검증 및 구현 미수행. Claude Code에서 현행 코드 확인 후 수행.
> 범위: Phase 2 신규 파일만 추가. Phase 1 파일 수정 금지. 기능 플래그 기본 OFF. 사용자 수동 공개 승인 필수.

## Phase 1 참조 (실제 존재 여부 미검증)
설계상 apartments(apartment_id), transactions(transaction_id, apartment_id, trade_type, contract_date, area_m2, sale_price, record_status, source_key), match_reviews(match_status), sync_jobs(status, period). 실제 스키마/자료형/키를 Claude Code가 먼저 확인하고 불일치 시 제안만 작성.

## 신규 모델
### p2_monthly_price_stats
(apartment_id, area_type_m2, contract_month) 복합 PK 후보; trade_count int NOT NULL; median_price_won numeric nullable; min_price_won numeric nullable; max_price_won numeric nullable; median_price_per_m2_won numeric nullable; data_version bigint; calculated_at timestamptz; completeness_status. 표본 3 미만이면 median 필드 NULL. 원화는 정확한 NUMERIC/정수로 보존. **전체 면적 월별 거래량**은 별도 합계 쿼리 또는 area_type NULL을 지원하는 별도 키 설계; NULL 포함 복합 PK는 그대로 사용 금지.
### p2_analysis_versions
apartment_id PK, data_version bigint monotonic, source_watermark, status(READY/UPDATING/ERROR), updated_at. 단지별 버전이 원본 거래·집계·근거 목록·커버리지 스냅샷을 일관되게 참조하도록 설계.
### p2_analysis_runs
run_id PK, apartment_id, target_month, status(STARTED/COMPLETED/FAILED), source_version, processed_count, started_at, completed_at, error_code. 실행 이력 최소 보존 및 용량 제한.
### 수집 커버리지
Phase 1 sync_jobs에서 **원천·시군·계약월·최종 성공/실패/재검증**을 신뢰성 있게 판정 가능한지 먼저 확인. 부족하면 Phase 2 전용 coverage 모델 제안. 성공 시점까지의 잠정 수집과 계약월 최종 확정을 구분.

## 트랜잭션/무결성
재집계 결과와 버전 전환은 원자적 커밋. 버전이 증가한 이후 구버전 캐시/페이지 커서 사용 금지. 단순히 테이블의 최신 상태와 과거 버전을 섞어 반환하지 않도록 스냅샷/락/버전 재검증 전략을 설계하고 테스트. 소스 변경·수집 상태 변경이 영향받는 월/단지를 재집계하도록 연결.

## 마이그레이션
Phase 1 기존 컬럼/테이블 무단 변경 금지. Phase 2 신규 테이블·인덱스는 별도 순방향/롤백 SQL로 제안, EXPLAIN과 저장용량 측정 후 승인. 개인정보 및 원천 데이터 보관/재배포 조건 검증.
