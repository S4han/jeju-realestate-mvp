# MVP 수용 테스트 결과 (TASK-008)

- 실행일: 2026-10-24
- 환경: Claude Code 클라우드 컨테이너(Linux 6.18, 4 vCPU, 15GB RAM), Node 22.22.0, PostgreSQL 16.15(같은 호스트), Chromium 153(Playwright), 휴대폰 화면 390×780
- 데이터: 실거래 2025-11 ~ 2026-10(매매 2,041 / 전월세 5,027), 한국부동산원 아파트 1,153개 단지, 연속지적도 AL_D002_50_20261008
- 지도: **가짜 카카오 SDK**(tests/e2e/fake-kakao-sdk.js)로 검증. 실제 카카오맵은 미검증(TASK-009에서 키·허용 도메인 등록 후 확인)

## 결과 요약
| 구분 | 결과 |
|---|---|
| 단위·통합 테스트 (`npm test`) | 96/96 통과 (14개 파일, DB 통합 포함) |
| E2E 지도·검색·상세 (`npm run test:e2e`) | 17/17 항목 통과 |
| E2E 장애 (`node tests/e2e/outage.e2e.mjs`) | 6/6 항목 통과 |
| 비밀값 누출 점검 (`npm run check:secrets`) | 누출 0. 빌드 결과물·추적 파일·전체 git 이력·sync_jobs를 검사했고, 검사기가 실제 누출을 잡는지 음성 대조 시험도 함 |
| 의존성 취약점 (`npm audit`) | 0 |
| 타입 검사·빌드·브라우저 env 노출 점검 | 통과 |

## AT별 결과
| ID | 테스트 | 결과 | 증거 |
|---|---|---|---|
| AT-001 | 제주시 단지명 부분검색 | PASS | `apartments.db.test.ts` 띄어쓰기를 무시한 이름·별칭 검색, E2E "노형뜨란" 검색 |
| AT-002 | 서귀포시 단지명 검색 | PASS | `apartments.db.test.ts` city_code 필터(해당 시 결과만) |
| AT-003 | 동명 단지 검색 | PASS | E2E 남양맨션 3건이 서로 다른 주소(도로명+지번)로 표시됨, `format.test.ts`, 매칭 엔진의 동명 단지 분리 테스트 |
| AT-004 | 자동완성 후보 선택 → 지도 이동 | PASS (가짜 SDK) | E2E: 선택 후 지도 중심 33.4875, 레벨 4 |
| AT-005 | 지도 화면 이동 → 영역 마커 갱신 | PASS (가짜 SDK) | E2E: 화면 범위(bbox) 요청, 중심 이동·시 필터 변경 시 재조회 |
| AT-006 | 좌표 없는 단지 → 허위 마커 없음 | PASS | 지도 API는 VERIFIED_PARCEL만 반환하고 검색 API는 미검증 좌표를 숨김(`apartments.db.test.ts`), REVIEW/NONE 63개 단지 미표시 |
| AT-007 | 마커 선택 → 단지 요약 카드 | PASS (가짜 SDK) | E2E 마커 클릭 → 요약 카드 |
| AT-008 | 단지 상세 → 확정 거래만 | PASS | `transactions.db.test.ts`(해제·MISSING·미매칭 제외, 단건 404) |
| AT-009 | 매매 상세 금액·면적·층·계약일 | PASS | `transactions.db.test.ts`, E2E 행 펼치기 |
| AT-010 | 전월세 보증금·월세 분리 | PASS | `transactions.db.test.ts`, `collect.unit.test.ts`(정규화), 화면 "보증금 X / 월 Y", "전세 X" |
| AT-011 | 최근 12개월(현재 월 포함) | PASS | `collect.unit.test.ts` recentMonths(KST 경계 포함), 상세 API는 기간이 창 밖이면 400 |
| AT-012 | 거래 필터/정렬 | PASS | `transactions.db.test.ts`(면적·기간·정렬·페이지), E2E 면적 칩·정렬 |
| AT-013 | 미매칭/복수 후보 → 자동 연결 차단 | PASS | `match.unit.test.ts` 11개, 실데이터 보류 148건(사유 기록, 주소 충돌 0) |
| AT-014 | 거래 없음 → 정상 빈 결과 | PASS | E2E 거래 없는 단지 "확인된 매매 거래가 없습니다"(오류 문구 아님) |
| AT-015 | 수집 실패/누락 → 마지막 정상 데이터·안내 | PASS | `collect.db.test.ts`(실패 시 기존 데이터 유지, PARTIAL은 사라짐 처리 안 함), outage E2E(누락 월·지연 배너 + 목록 유지), data-status 누락 월 |
| AT-016 | 지도 장애 → 목록 대체 | PASS (SDK 차단·키 없음) | E2E SDK 차단 → 안내 + 목록 검색 → 요약 카드. 실제 카카오 쿼터 초과 응답은 미검증 |
| AT-017 | API/비용 한도 → 외부 호출 중단·안내 | **부분 PASS** | data.go.kr: 실행·일일 예산 도달 시 호출 전에 중단하고 FAILED(BUDGET_*) 기록(`collect.db.test.ts`). **카카오맵 무료 한도 초과 시 차단 동작과 Vercel·Supabase 한도 동작은 실서비스에서만 확인 가능 → TASK-009** |
| AT-018 | 모바일/보안 | PASS (배포 전 범위) | 390px 가로 넘침 없음, 비밀값 누출 0, 악성 입력 19종 × 모든 API에서 500/503·내부 정보 노출 없음(`security.test.ts`), Cron 인증 401(비밀값 없음/불일치/형식 오류), 보안 헤더 설정(실제 적용은 배포 후 확인) |

## 성능 (로컬, 잠정 목표 대비)
측정: `node scripts/perf.mjs 200 4`(엔드포인트별 200회, 동시 4개, 개발 API 서버 + 같은 호스트의 DB)

| API | p50 | p95 | 목표 p95 | 결과 |
|---|---|---|---|---|
| 자동완성 `/api/apartments/search` | 9.1ms | 14.1ms | 500ms | PASS |
| 지도 마커 `/api/apartments/map` | 12.0ms | 22.3ms | 800ms | PASS |
| 단지 상세 `/api/apartments/{id}` | 4.6ms | 7.7ms | 800ms | PASS |
| 거래 목록 `/api/apartments/{id}/transactions` | 6.2ms | 11.0ms | 1,000ms | PASS |

LCP: `node tests/e2e/lcp.mjs`(운영 빌드, 390×780, CPU 4배 감속, RTT 150ms, 1.6Mbps) 5회 측정 996 / 1,008 / **1,036(중앙값)** / 1,040 / 1,060ms. 목표 p75 2.5초 대비 PASS. 단, 카카오 SDK가 없는 상태(목록 모드)다.
- 한계: 같은 호스트 DB·서버리스 콜드스타트 없음·CDN 없음 조건이라 실제보다 낙관적이다. 배포 환경(Vercel 리전 ↔ Supabase 리전)에서 재측정이 필요하다(TASK-009).
- 매칭 전체 재계산은 약 0.8초(프로세스 시작 포함)다. Cron 1회 예상 시간은 증분 16호출(~1초씩) + 매칭으로 약 20초이며, `maxDuration` 60초로 설정했다(Hobby 허용 범위는 배포 시 확인).

## TASK-008에서 발견해 수정한 결함
1. 검색어에 NUL 등 제어 문자가 있으면 PostgreSQL 오류가 503(장애)으로 보이던 문제 → 400(입력 오류)으로 처리(`security.test.ts`로 발견)

## 미검증·잔여 위험 (TASK-009로 이월)
- 실제 카카오맵: 키·허용 도메인, 실제 마커 1,090개 렌더링 성능, **비즈월렛 미연결 상태에서 무료 한도 초과 시 차단(과금 아님) 여부**, PAW_MAP과 쿼터를 나눠 쓸 때의 사용량
- Vercel Hobby: Cron 실제 실행 시간 제한, 함수 호출·전송량 한도에 도달했을 때의 동작(정지 vs 과금), 보안 헤더 적용, 배포 리전 성능
- Supabase Free: 결제수단 없이 생성 가능한지, 7일 비활성 정지(일일 Cron으로 방지), SSL 접속
- 요청 빈도 제한 없음: 공개 API에 IP별 제한이 없다. 완화책은 CDN 캐시(s-maxage=300)와 무료 플랜 한도 도달 시 정지(과금 아님, 확인 필요)
- 호스팅 로그: 검색어가 URL 쿼리에 들어가므로 Vercel 런타임 로그 보존 정책을 확인해야 한다(FR-026)
- CSP는 최소 설정(frame-ancestors/object-src/base-uri)만 적용. 카카오 SDK 도메인을 실제로 확인한 뒤 script-src 강화를 검토

## 재현 절차
```bash
service postgresql start            # 로컬 DB
npm ci && npm run db:migrate
npm test                            # 단위·통합(TEST_DATABASE_URL은 초기화됨)
npm run build && npm run check:secrets
npm run test:e2e                    # 개발 DB에 수집 데이터 필요
node tests/e2e/outage.e2e.mjs
npm run dev:api & node scripts/perf.mjs 200 4; node tests/e2e/lcp.mjs
```
