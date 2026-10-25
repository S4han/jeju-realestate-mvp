# Phase 3 — 지역 분석 API 계약 초안

> 상태: STEP 6 최종 승인 반영 / 문서 확정. 실제 API·DB·공급자 요금·경계 라이선스 검증 및 개발·테스트는 **미수행**이며 Claude Code 책임 작업.
> 변경 경계: **docs/phase3/** 및 **tasks/phase3/** 신규 파일만. Phase 1·2 기존 파일·API·데이터 변경 금지. 기능 플래그 기본 OFF, 공개 전 사용자 수동 승인.
> 기준: 한국시간(Asia/Seoul), 아파트 **매매** 계약일 기준. 샘플 숫자는 실거래 아님.

## 1. 엔드포인트 (구현 전 기존 라우팅 충돌 확인)
| Method | Path | 기능 |
|---|---|---|
| GET | /api/v3/regions | 계층 목록 |
| GET | /api/v3/regions/boundaries | 검증된 경계 GeoJSON, 버전 |
| GET | /api/v3/regions/statistics | 지도 가격/거래량·분위·범례 |
| GET | /api/v3/regions/{id} | 지역 상세 |
| GET | /api/v3/regions/{id}/apartments | 기간 거래 단지 우선 목록 |
| GET | /api/v3/regions/compare | 두 지역 비교 |
| GET | /api/v3/regions/{id}/trend | 12개월 대비 변화율 |
| GET | /api/v3/regions/status | 공개 버전·완전성·최신성 |

## 2. 입력
level=city|legal_dong, parentRegionId=공식 검증 ID, period=12|24|36(기본24), metric=price_per_m2|trade_count(기본 price_per_m2), regionIds=서로 다른 2개, pageSize=1..100(기본20), cursor=서명/검증된 버전·정렬 키. 미지원 기간·코드·상위관계·지표는 400. 입력 최대 길이·요청량 제한.

## 3. 응답 불변식
모든 통계 응답에 snapshotId, boundaryVersion, contractPeriod(startInclusive,endExclusive), generatedAt, lastSuccessfulSyncAt, staleAfterHours=48, completeness, provisionalCurrentMonth, sampleCount, priceStatus, unmappedCount, legend(method, boundaries, effectiveClassCount, eligibleRegionCount, unit)를 해당되는 범위에 포함. 가격 금액 단위는 **원/㎡** 정수 또는 명시적 소수 규칙, UI에서 만원/㎡로 변환. 미확인·표본 부족은 가격을 null로 반환, 0으로 대체 금지.

## 4. 예시 (가상 데이터)
```json
{
  "snapshotId":"example-snapshot-1",
  "regionId":"EXAMPLE_A",
  "periodMonths":24,
  "metric":"price_per_m2",
  "statistics":{"tradeCount":3,"medianPricePerM2Won":6000000,"priceStatus":"AVAILABLE","changePct":null,"changeStatus":"INSUFFICIENT_SAMPLE"},
  "dataStatus":{"completeness":"COMPLETE","provisionalCurrentMonth":true,"lastSuccessfulSyncAt":"2026-10-24T10:00:00+09:00"},
  "boundaryVersion":"example-boundary-1"
}
```

## 5. 상태·오류·일관성
400 INVALID_ARGUMENT, 404 UNKNOWN_REGION, 409 SNAPSHOT_MISMATCH, 422 UNVERIFIED_REGION, 429 RATE_LIMITED, 503 FEATURE_DISABLED/NO_VERIFIED_SNAPSHOT. 실패 응답에 민감 내부 경로나 Secret 노출 금지. 클라이언트는 단일 snapshotId를 후속 카드·비교·목록 요청에 전달하고 서버는 활성 버전 또는 보존된 일관 스냅샷만 제공; 혼합 버전 금지. 경계는 GeoJSON 크기/단순화/좌표계 검증 후 압축·캐시, ETag는 버전 연동. API 형식은 실제 백엔드 확인 후 Claude Code가 검증·확정.
