# Phase 2 분석 API 계약 v1.0

> 상태: 최종 승인 반영 설계 문서 / 실제 API·DB·요금제 검증 및 구현 미수행. Claude Code에서 현행 코드 확인 후 수행.
> 범위: Phase 2 신규 파일만 추가. Phase 1 파일 수정 금지. 기능 플래그 기본 OFF. 사용자 수동 공개 승인 필수.

## 공통
GET /api/v2/analysis/apartments/{id}/areas
GET /api/v2/analysis/apartments/{id}/summary?period=24&areaType=84
GET /api/v2/analysis/apartments/{id}/monthly?period=24&areaType=84
GET /api/v2/analysis/apartments/{id}/points?period=24&areaType=84
GET /api/v2/analysis/apartments/{id}/transactions?period=24&areaType=84&pageSize=20&cursor=...
GET /api/v2/analysis/apartments/{id}/status

입력: period ∈ {12,24,36}; areaType 양의 정수 또는 all; pageSize 1~100, 기본 20; 정렬 allowlist; 단지 ID 기존 형식. 존재하지 않는 단지 404, 입력 오류 400, 비활성화 404 또는 503 중 정책 확정 후 일관 적용, 내부 오류 안전한 5xx. 서버 파라미터 검증·쿼리 바인딩 필수.

## 기본 면적
확정 매칭 유효 거래 건수가 가장 많은 면적 유형, 동률 시 작은 유형 선택. all은 거래량만 제공하며 summary 가격 필드 null, comparison unavailable.

## 응답 예시 (가상 데이터)
```json
{
  "apartmentId":"example", "periodMonths":24, "areaTypeM2":84,
  "summary":{"tradeCount":27,"medianPriceWon":520000000,"minPriceWon":470000000,"maxPriceWon":610000000,"medianPricePerM2Won":6120000,"yearOverYearChangePct":4.0,"comparisonStatus":"AVAILABLE"},
  "monthly":[{"contractMonth":"202610","tradeCount":2,"medianPriceWon":null,"priceStatus":"INSUFFICIENT_SAMPLE","collectionStatus":"COMPLETE","isCurrentMonth":true}],
  "dataStatus":{"completeness":"COMPLETE","freshness":"FRESH","aggregation":"READY","lastSuccessfulSyncAt":"2026-10-24T10:00:00+09:00","missingMonths":[],"dataVersion":"3f9a1c0b7d2e4a65","provisionalCurrentMonth":true}
}
```

상태: AVAILABLE, INSUFFICIENT_SAMPLE, NO_TRADES, INCOMPLETE_DATA, UNAVAILABLE, ERROR. 수집 완전성/최신성/집계 상태는 독립 필드. 'COMPLETE'는 마지막 수집 작업 성공이지 최종 신고 확정 아님.

## 근거 거래 페이지
커서에 단지·면적·기간·정렬·데이터 버전·마지막 정렬 키를 포함(서명 또는 위변조 방지). 안정 정렬: contract_date DESC, transaction_id DESC. 페이지 중 버전 변경 시 409 DATA_VERSION_CHANGED, 처음부터 재조회. 결과의 tradeCount와 페이지 총합은 동일 유효 거래 모집단에서 도출. 표본 부족 월에도 유효 거래 목록 접근 가능.

## 캐시
(v1.5) 서버 측 캐시 저장소 없음. CDN `s-maxage`(예 300초)로 URL 단위 캐시, 응답·커서에 `dataVersion`(문자열 지문) 포함. 인스턴스 로컬 메모리 캐시 사용 금지. 동일 요청 중복 계산 억제, DB/캐시 실패 시 안전하게 응답.

## v1.1 변경 (PRD D12)
- `monthly`: 월별 **거래량·수집 상태** 전용. `medianPriceWon`·`priceStatus`는 제거하고 분기 배열을 함께 반환: `"quarterly":[{"quarter":"2026Q3","tradeCount":4,"medianPriceWon":530000000,"priceStatus":"AVAILABLE"}]` (3건 미만이면 `medianPriceWon:null`, `INSUFFICIENT_SAMPLE`).
- `points`(신규): 가격 그래프용 유효 거래 점 전체 `[{"transactionId","contractDate","priceWon","areaM2","floor"}]`. 선택 면적 유형 필수(`all` 불가), 상한 500건(초과 시 `truncated:true`), 데이터 버전 포함. 점 수는 같은 조건의 `summary.tradeCount`와 일치해야 한다.
- 함수 수(P2-TASK-001 D5): 분석 API는 하나의 함수에서 경로별로 처리한다.

## v1.3 변경 (PRD D2)
- 근거 거래와 `points` 항목에 `sameConditionCount`(정수, 기본 1) 추가: 같은 단지·면적·층·계약일·금액의 유효 거래 수. 2 이상이면 UI에 "같은 조건 신고 N건(원천 기준)" 표시. 집계에서는 각 거래를 모두 1건씩 센다.

## v1.5 변경 (P2-TASK-002 대안 B)
- `dataVersion`: 정수 → **문자열**(유효 거래 집합·수집 상태의 md5 지문 앞 16자). 같은 데이터면 같은 값, 무엇이든 바뀌면 다른 값.
- 모든 응답은 요청 시 원본에서 계산(사전 집계 없음). `dataStatus.aggregation`은 항상 `READY`(계산 실패 시 오류 응답).
