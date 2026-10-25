# Phase 2 데이터 모델·마이그레이션 설계

> 상태: 최종 승인 반영 설계 문서 / 실제 API·DB·요금제 검증 및 구현 미수행. Claude Code에서 현행 코드 확인 후 수행.
> 범위: Phase 2 신규 파일만 추가. Phase 1 파일 수정 금지. 기능 플래그 기본 OFF. 사용자 수동 공개 승인 필수.

## Phase 1 참조 (실제 존재 여부 미검증)
설계상 apartments(apartment_id), transactions(transaction_id, apartment_id, trade_type, contract_date, area_m2, sale_price, record_status, source_key), match_reviews(match_status), sync_jobs(status, period). 실제 스키마/자료형/키를 Claude Code가 먼저 확인하고 불일치 시 제안만 작성.

## 신규 모델 (v1.5: 없음)
P2-TASK-002 결정(대안 B, PRD v1.5)으로 **Phase 2 신규 테이블을 만들지 않는다.** 아래 원안은 기록용이며 사용하지 않는다.
- (미사용) `p2_monthly_price_stats`, `p2_quarterly_price_stats`, `p2_analysis_versions`, `p2_analysis_runs`
- 대신: 유효 거래·면적 유형·기간·완전성·최신성은 Phase 1 테이블(`transactions`, `apartments`, `sync_jobs`)을 읽기 전용으로 조회해 요청 시 계산. 데이터 버전 = 유효 거래 (id, 금액, 면적, 계약일) 정렬 목록과 해당 시·기간 `sync_jobs` 최신 (월, 상태, 완료 시각)의 md5 지문(문자열).
- 수집 커버리지: `sync_jobs`(MOLIT_SALE)의 계약월별 최신 상태로 판정(SUCCESS=COMPLETE, PARTIAL=잠정, FAILED/없음=INCOMPLETE). 별도 coverage 테이블 없음.
- 사전 집계 전환 기준(재검토 조건): 단지당 유효 거래 수천 건 또는 분석 DB 시간 p95 100ms 초과. 그때 이 원안을 다시 설계한다(API 계약 동일).

## 트랜잭션/무결성 (v1.5)
한 응답의 모든 값은 `REPEATABLE READ READ ONLY` 트랜잭션 하나에서 계산해 구버전 혼합이 구조적으로 불가능하다. 근거 거래 커서는 데이터 버전을 포함하고, 다음 페이지에서 버전을 재계산해 다르면 409. Phase 2 코드는 DB에 쓰지 않는다.

## 마이그레이션
Phase 1 기존 컬럼/테이블 무단 변경 금지. **v1.5: Phase 2 마이그레이션 없음**(Phase 1 기존 인덱스 `transactions_apartment_date_idx`로 충분, EXPLAIN 근거는 P2-TASK-002_DESIGN.md). 롤백 = 기능 플래그 OFF. 개인정보 및 원천 데이터 보관/재배포 조건 검증.
