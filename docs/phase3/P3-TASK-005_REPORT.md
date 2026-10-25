# P3-TASK-005 지역·경계·통계·비교 API

작성 2026-10-25. **운영 DB 변경·배포 플래그 ON 없음.** 로컬 테스트·로컬 DB(실제 지역 세트 + 합성 거래)에서만 실행.

## 1. 라우팅 — 문서와 차이(⚠ 확정 필요 없음, 기록)
- API_SPEC 초안: `/api/v3/regions`, `/regions/{id}`, `/regions/{id}/apartments` 등 깊이가 다른 8개 경로.
- 구현: **함수 1개** `api/v3/regions/[view].ts` → `/api/v3/regions/{view}?…`(view = status·list·boundaries·statistics·detail·apartments·compare·trend), 지역은 `regionId` 쿼리.
- 이유: Hobby 함수 수 제한(P3-D4), 깊이가 다른 catch-all 경로는 Vite+일반 함수 환경에서 동작이 문서로 확인되지 않음, 경로 재작성은 `vercel.json`(Phase 1) 수정 필요. Phase 2에서 검증된 동적 경로 방식 재사용. **배포 함수 총 10개**.
- Phase 1 예외(P3-D3): `server/dev-server.ts`에 v3 개발 경로 1줄 추가(아래 diff).

## 2. 동작
| view | 입력 | 응답 요점 |
|---|---|---|
| status | — | 활성 지역 세트(코드·경계 출처·기준일·단순화), dataStatus |
| list | — | 시 2 → 읍면동(아파트 유무) |
| boundaries | level=city·legal_dong(+parentRegionId) | GeoJSON FeatureCollection(WGS84), boundaryVersion |
| statistics | level, parentRegionId, period, metric | 지역별 통계·등급(class)·범례(방법, 실제 최소·최대, 대상 지역 수, 단위), 시별 격리 건수 |
| detail | regionId, period | 지역 통계 + 월별 거래량(누락 월 null) + 시면 격리 건수 |
| apartments | regionId, period, pageSize, cursor | 기간 거래 단지(최근 계약일↓, ID↓), Phase 1 링크·Phase 2 플래그 ON일 때 분석 링크, 서명 커서 |
| compare | regionIds=a,b | 두 지역 같은 스냅샷·기간 |
| trend | regionId | 최근 12 vs 직전 12개월 변화 + 24개월 월별 |
- 공통: `snapshotId`, `boundaryVersion`, `periodMonths`, `generatedAt`, `staleAfterHours=48`, CDN `s-maxage=300`. 클라이언트가 `snapshotId`를 보내면 불일치 시 **409 SNAPSHOT_MISMATCH**(화면 혼합 버전 차단).
- 5분위(`quantiles.ts`): 같은 화면·기간·지표의 **유효 지역만**, 같은 값은 같은 등급, 유효 지역·고유값이 적으면 등급 축소, 가격 지표는 AVAILABLE만, 거래량 지표는 아파트 있고 수집 완전한 지역만(0건 포함).
- 오류: 400 INVALID_ARGUMENT, 404 NOT_FOUND/UNKNOWN_REGION, 409 SNAPSHOT_MISMATCH, 503 NO_VERIFIED_SNAPSHOT·DB_UNAVAILABLE·ANALYSIS_MISCONFIGURED(커서 비밀값 없음), 플래그 OFF는 DB 접근 전 404. 오류 본문에 내부 정보 없음.
- 문서와 차이: 422 UNVERIFIED_REGION 대신 활성 세트에 없는 지역은 404 UNKNOWN_REGION. 429 요청량 제한은 미제공(G8, 무료 범위 수단 없음 — CDN 캐시·입력 상한·쿼리 타임아웃 2초로 대체). ETag는 미사용(CDN 캐시 + 응답의 boundaryVersion).
- 새 서버 환경 변수(아직 미설정): `PHASE3_REGION_ANALYSIS_ENABLED`(기본 OFF), `P3_CURSOR_SECRET`(32자 이상, 단지 목록용).

## 3. 테스트
- `tests/phase3/api.test.ts` 12건: 5분위(10개 5등급, 동률 유지, 소수 지역 축소, 0개) TC-026~028; 플래그 OFF 8개 view 404·DB 미접근 TC-039; 400 입력 14종 TC-037; 활성 세트 없음 503; status·list·boundaries; 지표 전환·기간 변경·표본 부족 등급 제외 TC-009/010/029/030; 같은 스냅샷 동일·409 TC-031/035; 비교 같은 스냅샷 TC-036; detail·trend; 단지 목록 정렬·커서 무누락·위조 400·변경 409; DB 장애 503 일반 메시지.
- 전체: **24 파일, 190/190 통과**, `tsc` 통과, ESM 상대경로 검사·번들 비밀 노출 검사 통과.

## 4. 로컬 실행 확인(실제 지역 세트 74 + 합성 거래, 개발 서버, 플래그 ON 로컬만)
| 요청 | 크기 | 시간 |
|---|---|---|
| status / list | 0.6KB / 6.9KB | 0.13s / 0.10s |
| boundaries 전체 / 서귀포시 | 273KB / 122KB(무압축) | 0.02s |
| statistics 제주시 읍면동 | 18KB | 0.06s |
| detail / apartments / compare / trend | 3KB / 0.8KB / 1.4KB / 2.9KB | 0.02~0.11s |
- 경계는 Vercel CDN이 자동 압축(약 60KB 예상, 배포 후 확인).

## 5. Phase 1 파일 diff (승인된 예외)
```diff
   { pattern: /^\/api\/v2\/analysis\/apartments\/(?<id>[^/]+)\/(?<view>[^/]+)$/, load: () => import("../api/v2/analysis/apartments/[id]/[view].js") },
+  // Phase 3 region analysis (P3-D3 exception): the single v3 function, flag-guarded inside.
+  { pattern: /^\/api\/v3\/regions\/(?<view>[^/]+)$/, load: () => import("../api/v3/regions/[view].js") },
 ];
```

## 6. 미검증
- Vercel 배포 환경에서 `[view]` 경로·압축·응답 시간(Preview 플래그 ON 필요, 승인 후).
- 운영 데이터 기준 통계·대사(운영 적재 후).
