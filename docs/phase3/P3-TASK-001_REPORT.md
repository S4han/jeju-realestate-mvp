# P3-TASK-001 현행 코드·Phase 1·2 구조 실사 보고

작성 2026-10-25. **읽기 전용 실사 — Phase 1·2 파일·DB·배포 변경 0건, 외부 API 호출 0건, Secret 출력 0건.**
표기: ✅ 코드·문서로 확인 · ⬜ 미확인(운영 DB 조회 등 필요) · ⚠ Phase 3 문서 가정과 다름(결정 필요).

## 1. 현행 시스템 요약 (Phase 3에 필요한 부분)
| 영역 | 현행 | 근거 |
|---|---|---|
| 런타임 | Vite + React 19 SPA, Vercel Hobby 서버리스 함수(`api/`, ESM, Node 22, icn1), Supabase Free Postgres 17 | `vercel.json`, `package.json`, `docs/OPERATIONS.md` |
| 함수 수 | **9개**(Phase 1 8 + Phase 2 단일 함수 1). Hobby 배포당 12개 제한 | `api/**/*.ts` |
| 화면 진입 | 해시 라우팅 `#/`(대시보드) `#/map` `#/list` `#/apartments/{id}`. 헤더 탭은 `src/App.tsx`에 고정 | `src/App.tsx` |
| 지도 | 카카오맵 JS SDK, `src/kakao.ts`가 1회 로드(`libraries=clusterer`). 실패·키 없음 시 목록 대체 | `src/kakao.ts`, `MapView.tsx` |
| 단지 | `apartments.legal_dong_code CHAR(10)` = REB PNU 앞 10자리(법정동, 읍면 지역은 **리 단위**), `city_code` 50110/50130, 좌표 `VERIFIED_PARCEL`만 | `0001_init.sql`, `server/reference/reb.ts` |
| 거래 | `transactions`: `sgg_code`, `umd_code`(MOLIT umdCd 5자리=읍면동3+리2, 매매만), `umd_name`, `area_m2 NUMERIC(10,4)`(정밀), `sale_price` 원, `record_status` ACTIVE/CANCELLED/MISSING_FROM_SOURCE, `apartment_id`는 **CONFIRMED 매칭만** | `0001_init.sql`, `normalize.ts` |
| 거래 ID | `transaction_id BIGSERIAL` + 원천 식별 `(trade_type, natural_key, occurrence)` UNIQUE. 재수집 시 ID 유지 | `0001_init.sql`, `collect/store.ts` |
| 유효 거래(Phase 2) | `trade_type='sale' AND record_status='ACTIVE' AND apartment_id=? AND sale_price>0 AND area_m2>0` + 기간 반개구간 | `server/phase2/analysis.ts` `VALID` |
| 수집 완전성 | `sync_jobs`(MOLIT_SALE, **시 단위**·계약월별 최신 상태) → COMPLETE/PARTIAL/MISSING | `analysis.ts coverage()` |
| 일관성 | Phase 2는 사전 집계 없이 `REPEATABLE READ READ ONLY` 스냅샷에서 요청 시 계산, `dataVersion`=유효 거래+수집 상태 md5 지문, CDN `s-maxage=300` | `P2-TASK-002_DESIGN.md`(대안 B) |
| 플래그 | 서버 환경변수 문자열 `"true"`만 ON, OFF면 DB 접근 전 404. UI는 status API 200일 때만 노출 | `server/phase2/flag.ts`, `TransactionsPage.tsx` |
| 마이그레이션 | `db/migrations/*.sql` 파일명 순 적용(`scripts/migrate.ts`), 운영은 사용자 PC에서 실행. `0004`가 **고정 테이블 목록**에 RLS 적용 | `scripts/migrate.ts`, `0004_lock_down_public_api.sql` |
| 데이터 갱신 | ⚠ Vercel에 `CRON_SECRET`·`DATA_GO_KR_SERVICE_KEY` **미설정** → 서버 Cron은 401로 종료, 수집·매칭은 **사용자 PC에서 수동** 실행 | Vercel 환경변수 목록, `api/cron/collect-transactions.ts` |
| 데이터 규모 | 유효 매매 6,479건(2023-11~2026-10), 단지 1,153, DB 약 24MB | Phase 2 P2-TASK-001 보고서 |

## 2. 문서 가정과 실제의 차이 (결정 필요 ⚠)
| # | Phase 3 문서 가정 | 실제 | 영향·제안 |
|---|---|---|---|
| G1 | 월별 거래량 **사전 집계 테이블** + immutable snapshot + ACTIVE 포인터 + runs 테이블(DATA_MODEL·ARCHITECTURE) | Phase 2는 같은 문제를 **요청 시 계산 + 지문 버전**으로 해결(쓰기 0, 마이그레이션 0). 서버 측 정기 작업이 없음(수집도 수동) | 사전 집계를 하려면 **집계 실행 주체**(PC 스크립트 또는 새 Cron)와 쓰기 경로·실패 롤백이 필요. 데이터 6.5천 건 규모에선 Phase 2 방식으로 시 전체 지역 통계도 수 ms 예상 → **결정 P3-D1** |
| G2 | 거래별 "공식 법정코드 지역 매핑" 테이블(`p3_apartment_region_map`) | 지역 근거가 이미 두 곳: 단지 `legal_dong_code`(REB PNU 기반)와 거래 `sgg_code+umd_code`(MOLIT). 둘이 다를 수 있음(미측정) | 단지 코드 기준 + 거래 코드 교차검증, 불일치는 격리(MAPPING_UNVERIFIED) 제안 → **P3-D2**. 불일치 건수는 운영 DB 조회로 확인(5절) |
| G3 | 법정리·하위 법정동을 공식 계층표로 상향 매핑 | 읍·면 지역 단지 코드는 **리 단위 10자리**(끝 2자리≠00). 법정동코드 구조상 앞 8자리 + `00` = 읍면동 | 구조적 상향은 단순하나 "공식 계층표·이력"(폐지·변경 코드, TC-005) 원천은 아직 없음 → P3-TASK-002 |
| G4 | 공식 경계 폴리곤 DB 저장 후 API 제공 | 저장소에 경계 데이터·공간 확장 없음. 로컬 PostgreSQL에 PostGIS 미설치, Supabase PostGIS 사용 여부 ⬜. 카카오맵은 경계를 제공하지 않음(폴리곤 그리기만 가능) | 원천(예: 국가 공간정보의 법정구역 경계)·라이선스·좌표계 변환·단순화는 P3-TASK-002. PostGIS 없이 **사전 단순화한 GeoJSON을 jsonb로 저장**하는 안을 우선 검토(새 확장 불필요) |
| G5 | `/api/v3/regions/...` 8개 엔드포인트 | Hobby 함수 12개 제한, 현재 9개 → 8개를 각각 만들면 17개로 **배포 실패** | Phase 2처럼 **단일 함수**(`api/v3/regions/[[...path]].ts` 등)로 라우팅 → **P3-D4** |
| G6 | 지역 분석 진입점은 Phase 1과 분리, OFF면 숨김 | 진입 탭은 `src/App.tsx`(Phase 1)에 하드코딩. Phase 1 수정 없이 새 진입점을 만들 방법이 없음(멀티 페이지는 `vite.config.ts` 수정 필요) | Phase 2의 D4처럼 **최소 예외**(App.tsx에 status API로 감싼 탭 1개 + `server/dev-server.ts` 개발 경로) 승인 필요 → **P3-D3** |
| G7 | Phase 2 분석 "링크" | Phase 2 탭은 URL 상태가 없어 `#/apartments/{id}`로만 연결 가능(분석 탭 직접 열기 불가) | 상세로 연결 + "가격 분석 탭에서 확인" 안내(추가 수정 없음) 제안 → P3-D5 |
| G8 | 429 RATE_LIMITED 요청량 제한 | Phase 1·2에 요청량 제한 없음. 무료로 쓸 수 있는 Vercel 방화벽 규칙 범위 ⬜ | CDN 캐시 + 입력 상한 + 쿼리 타임아웃으로 대체하고 429는 "미제공"으로 문서화 제안(유료 기능 사용 안 함) |
| G9 | "같은 지도 범위" 5분위 | 시 레벨은 지역이 2개뿐 → 분위 의미 없음 | 시 레벨은 값·건수만 표시(색 2단계 이하), 5분위는 읍면동 레벨에서만(문서의 "가능한 등급만"과 일치) |
| G10 | 48시간 최신성 경고 | 수집이 수동이라 사용자가 이틀 이상 PC 수집을 안 하면 **Phase 2·3 모두 STALE 경고** | Phase 3 이전의 운영 위험. 자동 수집(Cron 키 설정)은 data.go.kr 일일 한도 확인 후 별도 결정 |
| G11 | 새 `p3_*` 테이블 | `0004`의 RLS·권한 회수는 고정 목록 → 새 테이블은 자동 보호 안 됨 | Phase 3 마이그레이션에 **자체 RLS·권한 회수** 포함(Phase 1 파일 수정 없이 새 파일로) |
| G12 | 변화율·완전성 | Phase 2와 동일 규칙(각 12개월 3건, 두 기간 완전성) 이미 구현 | 계산 코드 패턴 재사용 가능(Phase 2 파일은 import만, 수정 없음) |

## 3. 재사용 가능한 Phase 1·2 자산 (import만, 수정 없음)
`server/withPool.ts`(503 처리), `server/http.ts`, `server/db.ts`, `server/collect/months.ts`(KST 계약월), `server/phase2/analysis.ts`의 `withSnapshot`·`periodWindow` 패턴, `server/phase2/cursor.ts`(HMAC 커서), `src/kakao.ts`(SDK 로더; 폴리곤 타입은 Phase 3 파일에서 확장), `src/format.ts`, `src/api.ts`(`ApiError`).

## 4. 변경 금지 파일(Phase 1·2) — Phase 3에서 수정하지 않음
- Phase 1: `api/apartments/**`, `api/cron/**`, `api/dashboard/**`, `api/system/**`, `api/transactions/**`, `server/**`(phase2·phase3 제외), `src/**`(phase2·phase3 제외), `db/migrations/0001~0004`, `scripts/*`(phase2·phase3 제외), `vercel.json`, `vite.config.ts`, `package.json`, `tests/*`(phase2·phase3 제외)
- Phase 2: `api/v2/**`, `server/phase2/**`, `src/phase2/**`, `tests/phase2/**`, `tests/e2e/phase2.e2e.mjs`, `scripts/phase2/**`
- **예외 후보(승인 필요, P3-D3)**: `src/App.tsx`(플래그로 감싼 진입 탭), `server/dev-server.ts`(개발 경로 1줄)

## 5. 운영 DB 확인이 필요한 사실 (읽기 전용 SQL 준비, 실행은 승인 후)
`docs/phase3/p3-task-001/region-profile.sql` — READ ONLY 트랜잭션, 10초 타임아웃. 로컬 합성 DB에서 문법 검증 완료.
1) 시별 단지 수·법정동(10자리)·읍면동(8자리) 수·리 단위 코드 수, 2) 최근 24개월 읍면동별 유효 매매·단지 수, 3) 읍면동별 0 / 1~2 / 3건 이상 분포(가격 표시 가능 지역 비율), 4) 거래 코드 vs 단지 코드 일치/불일치/누락, 5) 시별 미매칭 거래, 6) PostGIS 사용 가능 여부.

## 6. 위험
| 위험 | 수준 | 대응 |
|---|---|---|
| 경계 데이터 라이선스·크기(모바일 성능) | 높음 | P3-TASK-002에서 원천·이용조건 확인, 사전 단순화·압축, 확인 전 공개 금지 |
| 읍면동 대부분 표본 3건 미만 → 지도 다수 무채색 | 중간 | 5절 SQL 3)으로 실측 후 기본 기간(24개월) 타당성 재검토 |
| 거래 코드·단지 코드 불일치 | 중간 | 격리·건수 표시, 시 = 하위 + 미매핑 대사 테스트 |
| 함수 수 제한 초과 | 높음(설계로 회피) | 단일 함수 라우팅 |
| 새 테이블 RLS 누락으로 Supabase Data API 노출 | 높음 | Phase 3 마이그레이션에 RLS·권한 회수, 테스트로 확인 |
| 수동 수집으로 STALE 상시화 | 중간 | 경고는 정상 동작, 자동 수집은 별도 결정 |
| Phase 1 파일 예외 수정 | 낮음 | 2파일·플래그로 감싼 최소 변경, OFF 시 기존과 동일 테스트 |
| 카카오 폴리곤 다수 렌더링 성능 | 중간 | 시 선택 후 해당 시 읍면동만 그리기, 단순화 경계 |

## 7. 예상 작업 파일 (모두 신규, 예외 2개 제외)
- 문서: `docs/phase3/P3-TASK-00N_*.md`, `docs/phase3/p3-task-00N/*`
- DB: `db/migrations/0005_p3_regions.sql`(지역·경계 참조 테이블 + RLS; P3-D1 결정에 따라 집계·버전 테이블 포함 여부 결정)
- 경계 준비: `scripts/phase3/prepare-boundaries.ts`(원본 변환·단순화·검증), `scripts/phase3/load-regions.ts`, `scripts/phase3/windows/*.ps1`(PC 실행)
- 서버: `server/phase3/flag.ts`, `regions.ts`(계층·매핑), `statistics.ts`(거래량·원/㎡ 중위·변화율·대사), `quantiles.ts`(동률 보존 5분위), `handlers.ts`, `api/v3/regions/[[...path]].ts`(단일 함수)
- 화면: `src/phase3/api.ts`, `RegionAnalysis.tsx`, `RegionMap.tsx`(카카오 폴리곤), `RegionCard.tsx`, `RegionCompare.tsx`, `RegionApartments.tsx`, `RegionTable.tsx`(지도 대체)
- 테스트: `tests/phase3/*.test.ts`(P3-TC-001~040), `tests/e2e/phase3.e2e.mjs`, `scripts/phase3/perf.mjs`
- 예외(승인 시): `src/App.tsx`, `server/dev-server.ts`

## 8. 결정 요청
- **P3-D1 집계 방식**: (A) 문서안 — 월별 사전 집계·스냅샷·ACTIVE 포인터·runs 테이블 + 집계 실행 주체 필요 / (B, 추천) Phase 2 방식 — 지역·경계 **참조 테이블만** 추가하고 통계는 읽기 전용 스냅샷에서 요청 시 계산, `snapshotId`=유효 거래·매핑·수집 상태·경계 버전 지문. 원자적 교체는 "경계·지역 참조 버전"에만 적용.
- **P3-D2 지역 매핑 근거**: 단지 `legal_dong_code` 상향(8자리+00) 기준, 거래 `umd_code`와 불일치 시 격리(추천).
- **P3-D3 Phase 1 예외**: `src/App.tsx` 진입 탭(플래그·status API로 감쌈), `server/dev-server.ts` 개발 경로.
- **P3-D4 함수 구조**: v3 전체를 단일 함수 1개로(추천, 총 10개).
- **P3-D5 Phase 2 연결**: 단지 상세(`#/apartments/{id}`) 링크 + 안내(추천, 추가 수정 없음).
- **브랜치**: `claude/phase3-region-analysis`(Production 브랜치 최신 + Phase 3 문서)에서 개발.
- **운영 DB 읽기 전용 조회**(5절 SQL) 실행 여부 — 사용자 PC, 결과로 P3-D1·D2와 기본 기간 타당성 확정.
