# P2-TASK-001 결과 보고서 — 현행 구조·원천·비용 검증 (G1)

작성 2026-10-24, 갱신 2026-10-25. 범위: 코드·스키마 대조(A), 무료 한도 문서 확인(D), 운영 DB 읽기 전용 조회(B, 사용자 PC에서 실행, 8절). **data.go.kr 호출(C)은 승인 전이라 수행하지 않음.**
표기: ✅ 확인(근거 있음) · ⬜ 미확인 · ⚠ 설계와 차이(결정 필요).

## 1. Phase 1 실제 스키마 (근거: `db/migrations/0001~0004`, `server/collect/*`)
| 테이블 | Phase 2 설계의 가정 | 실제 | 판정 |
|---|---|---|---|
| apartments | `apartment_id` | `apartment_id BIGSERIAL PK`, `city_code CHAR(5)`(50110/50130) | ✅ |
| transactions | `transaction_id, apartment_id, trade_type, contract_date, area_m2, sale_price, record_status, source_key` | 모두 있음. 단 **`source_key` 없음** → `(trade_type, natural_key, occurrence)` UNIQUE. `area_m2 NUMERIC(10,4)`, `sale_price BIGINT`(원), `contract_date DATE`, `record_status ∈ {ACTIVE, CANCELLED, MISSING_FROM_SOURCE}`, `cancelled_on`, `first_seen_at/last_seen_at` | ⚠ 키 이름·구성 다름 |
| match_reviews | `match_status` | `match_status ∈ {CONFIRMED, PENDING, REJECTED}`, 매칭 실행마다 **전체 삭제 후 재계산**(`DELETE FROM match_reviews` → 재삽입, 한 트랜잭션). **CONFIRMED일 때만 `transactions.apartment_id`가 채워짐**(`server/match/run.ts`). Phase 2 영향: 매칭 재실행으로 거래의 단지가 바뀔 수 있으므로 단지별 데이터 버전 갱신 대상에 매칭 결과 변경도 포함해야 함 | ✅ |
| sync_jobs | `status, period` | `source_id`(MOLIT_SALE/RENT 등), `city_code`, `period CHAR(6)`, `status ∈ {RUNNING, SUCCESS, FAILED, PARTIAL}`, `record_count`, `api_calls`, `started_at`, `completed_at`, `error_code` | ✅ (재검증 구분 없음, 3절) |
| 인덱스 | — | `(apartment_id, contract_date DESC) WHERE apartment_id IS NOT NULL` 있음 → Phase 2 단지별 조회에 재사용 가능 | ✅ |
| RLS | — | 앱 테이블 전부 RLS ON + anon/authenticated 권한 회수(0004). **Phase 2 신규 테이블도 같은 처리 필요** | ✅ |

## 2. 원천 필드·해제/정정/중복 키 (근거: `docs/API_VERIFICATION.md` 실측, `server/collect/normalize.ts`)
- 매매 원천(상세 API): `aptNm, aptDong, aptSeq, buildYear, cdealDay, cdealType, dealAmount(만원·콤마), dealYear/Month/Day, excluUseAr, floor, jibun, rgstDate, sggCd, umdNm …` ✅
- **원천 고유 거래 ID 없음** ✅ → `natural_key = 유형|시군구|법정동|지번|단지명|aptSeq|면적|층|계약일|금액`, 같은 키 안의 순번이 `occurrence`.
- **해제**: 응답에서 빠지지 않고 `cdealType=O`+`cdealDay`로 남음 → 같은 키의 행을 `CANCELLED`로 갱신(행 ID 유지). 해제는 계약 수개월 뒤에도 발생(실측: 4월 계약이 9월에 해제) ✅
- **정정**: 금액·층 등이 바뀌면 natural_key가 달라져 **새 행이 생기고, 기존 행은 그 달을 다시 수집할 때 `MISSING_FROM_SOURCE`로 바뀜**. 원거래와 정정 거래를 잇는 키는 없음 ✅(코드) / 실제 정정 사례 ⬜
- **같은 조건 행**: 매매는 해제+재신고 쌍에서만 키 충돌(실측). 전월세는 모든 필드가 같은 행 12그룹 → 중복 신고인지 별개 계약인지 구별 불가, Phase 1은 **제거하지 않음** ✅
- 결론: Phase 2 "유효 거래" = `trade_type='sale' AND record_status='ACTIVE' AND apartment_id IS NOT NULL`(= CONFIRMED). 해제·사라진 행은 자동 제외. "중복 제외"는 원천에서 판별 불가 → **결정 필요(5절 D2)**.
- 운영 DB 실측(8절): 같은 조건 **유효 매매(ACTIVE) 2건 이상인 키 11개** — Phase 1 표본 실측("매매는 해제+재신고 쌍에서만 겹침")과 달리 해제되지 않은 같은 조건 매매가 실제로 존재.

## 3. 수집 범위·완전성
| 항목 | 실제 | Phase 2 요구 | 판정 |
|---|---|---|---|
| 보유 기간 | 2025-11-01 ~ 2026-10-23(12개월), 원천·시별 12개월 모두 최신 상태 SUCCESS ✅(8절) | 24/36개월, 변화율은 24개월 필수 | ⚠ **과거 24개월(2023-11~2025-10) 추가 수집 필요** |
| 일일 갱신 | Cron이 최근 4개월만 재수집 ✅ | 과거 월 정정·해제 반영 | ⚠ 4개월보다 오래된 월은 해제·정정이 반영되지 않음 → 과거 월 정기 재검증 필요 |
| 월 완전성 판정 | `sync_jobs`의 (원천, 시, 월)별 최근 SUCCESS/PARTIAL/FAILED와 완료 시각으로 판정 가능 ✅. PARTIAL = 일부 행 읽기 실패(기존 행을 사라짐 처리하지 않음) | 성공/실패/재검증 구분 | ⚠ "재검증"을 따로 기록하지 않음. 정기 재수집도 같은 SUCCESS로 남음 → Phase 2 전용 보기(view) 또는 테이블 제안(P2-TASK-002) |
| 최신성 경고 | 36시간 | 48시간 | ⚠ 두 화면 기준 다름 |
| 수집 0건 vs 미수집 | `totalCount=0`이면 SUCCESS+0건, 실패는 FAILED로 구분 ✅ | AC-007 | ✅ |

**추가 수집 규모(추정)**: Phase 2는 매매만 필요 → 2개 시 × 24개월 = **48호출**(월 매매 100건대라 페이지 1장, 실측 `numOfRows=1000`). 행 수 약 3천 건, 용량 수 MB. 과거 월 재검증을 월 1회 36개월로 하면 월 72호출. 현재 상한(실행 30·일 300호출) 안. ⬜ 과거 월(2023~2024) 실제 응답 여부는 C 단계 표본 호출로 확인 필요.
⬜ 과거 거래의 매칭률: 단지 기준정보(한국부동산원)는 2026-09 기준이라 2023~2024 거래의 단지명 변경 등으로 보류 비율이 올라갈 수 있음.

## 4. 집계 규칙 검증 (로컬 PostgreSQL 16 실험)
- 면적 유형 `floor(area_m2 + 0.5)`를 NUMERIC으로 계산: 84.49→84, 84.50→85, 84.91→85, 84.9999→85 ✅(AC-003). **JS 부동소수점으로 계산하면 경계값 오차 위험** → DB(NUMERIC)에서 계산 권장.
- Phase 1 상세 화면 면적 칩은 `floor(area_m2)`(버림) ⚠ → 같은 단지가 탭마다 다른 ㎡로 보임(84.91㎡: Phase 1 칩 84, Phase 2 85). 운영 DB 실측: **유효 매매 1,867건 중 1,280건(69%)이 두 방식의 유형이 다름**. **결정 필요(D3)**.
- 중위값 `percentile_cont(0.5)`: 짝수 표본은 가운데 두 값의 평균(예 4.7·5.0·5.2·6.1억 → 5.1억) ✅. 결과 형식은 double이지만 원천이 만원 단위라 금액 정확도 문제 없음. 반올림 규칙(원 단위)은 P2-TASK-003에서 확정.
- ㎡당 가격 = 거래금액 ÷ 원본 면적의 중앙값(AC-010): NUMERIC 나눗셈 후 원 단위 반올림 제안.

## 5. 설계와의 차이·위험·결정 필요
| # | 항목 | 내용 | 제안 |
|---|---|---|---|
| D1 | **과거 데이터** | 24개월 추가 수집(48호출) + 과거 월 정기 재검증 | C 단계 표본 호출 → 승인 후 일괄 수집(별도 승인) |
| D2 | 같은 조건 거래 | 원천에서 중복 판별 불가. 운영 DB에 같은 조건 유효 매매 키 11개 | 제거하지 않고 별개 거래로 집계 + 화면에 "신고 기준" 안내(Phase 1과 동일 규칙) |
| D3 | 면적 표시 불일치 | Phase 1 버림 vs Phase 2 반올림 — 유효 매매의 69%가 탭마다 다른 ㎡로 표시됨 | Phase 1은 그대로, 분석 탭에 "전용면적 반올림 기준" 문구. 또는 Phase 1 칩을 반올림으로 통일(Phase 1 수정) |
| D4 | **Phase 1 파일 수정 금지** vs 탭 추가 | 상세 화면에 탭을 붙이려면 `TransactionsPage.tsx`·`dev-server.ts`·환경변수 노출 검사 허용목록 등 최소 수정이 불가피 | "연결 부위 최소 수정"을 명시적으로 허용, 변경 목록을 사전 승인 |
| D5 | 함수 개수 | Vercel API 파일 현재 8개. Phase 2 API 5개를 각각 만들면 13개. Hobby "배포당 12개" 제한은 커뮤니티 보고만 있고 공식 문서 확인 ⬜ | **분석 API 5개를 함수 1개(`api/v2/analysis/[...path].ts`)로** 처리 → 9개 |
| D6 | 캐시 | 무료 구성에 공유 캐시 없음 | 주소에 데이터 버전을 넣은 CDN 캐시 + DB 조회. 외부 캐시(새 공급자) 사용 안 함 |
| D7 | 요청 빈도 제한 | Phase 1에도 없음. Vercel Firewall `checkRateLimit`은 제공되나 Hobby 사용 가능 범위·과금 ⬜ | 우선 CDN 캐시 + 입력 제한, 빈도 제한은 비용 확인 후 |
| D8 | 근거 거래 커서 서명 | 서명용 비밀값 필요 | 새 서버 환경변수(`P2_CURSOR_SECRET`) — 등록은 승인 후 |
| D9 | 기능 플래그 | 없음 | 서버 `PHASE2_PRICE_ANALYSIS_ENABLED`(기본 false), UI는 서버 상태 API로 판정(빌드 변수 추가 회피) |
| D10 | 성능 | 배포 측정 p50 약 0.9초, 원인 미확정(OPERATIONS.md 6절) | Phase 2 목표(p95 0.8초) 판단 전에 원인 분리 측정 필요 |
| **D12** | **표본 부족** | 12개월 기준 단지×면적 묶음 838개 중 3건 이상 175개(21%), 묶음당 중간값 1건. 단지×면적×월 1,540칸에 1,867건(칸당 약 1.2건) → "월 3건 이상"(AC-005) 월별 가격은 대부분 미표시. 36개월로 늘려도 월별 칸은 크게 개선되지 않음 **결정(2026-10-25, 사용자 승인): D안** — 가격 그래프는 개별 거래 점 + 분기 중위 보조선(분기 3건↑), 숫자는 기간 전체 통계(3건↑). 월별 중위 표시 제거. PRD v1.1 및 관련 문서 반영 |
| D11 | 브랜치 | 이 세션은 `claude/jeju-realestate-mvp-analysis-6suje9`에만 푸시. Vercel Production 브랜치는 문서뿐인 `main` | Phase 2 전용 브랜치 사용 여부 결정. Production은 계속 수동 배포 |

## 6. 무료 운영(월 0원) 검증
| 공급자 | 확인 내용 | 판정 |
|---|---|---|
| Vercel Hobby | 월 함수 호출 100만 회 포함, Cron 하루 1회·최대 실행 300초, 비상업 개인용([Hobby 문서](https://vercel.com/docs/plans/hobby), [Cron 요금](https://vercel.com/docs/cron-jobs/usage-and-pricing), [함수 요금](https://vercel.com/docs/functions/usage-and-pricing)). 관측 지표는 Pro 전용(실측 402) | ✅(검색 요약 기준) |
| Vercel Hobby | 한도 초과 시 정지인지 과금인지 | ⬜ 계정 Usage 화면 확인 필요 |
| Vercel Hobby | 배포당 함수 12개 제한([커뮤니티 보고](https://community.vercel.com/t/error-no-more-than-12-serverless-functions-can-be-added-to-a-deployment-on-the-hobby-plan-create-a-team-pro-plan-to-deploy-more-learn-more-https-vercel-link-function-count-limit/410)) | ⬜ 공식 문서 미확인 → D5로 회피 |
| Supabase Free | DB 500MB/프로젝트, 디스크 2GB 고정·95%에서 읽기 전용, 1주 비활성 시 일시정지, 지출 상한은 Pro 전용([요금](https://supabase.com/pricing), [과금](https://supabase.com/docs/guides/platform/billing-on-supabase), [DB 크기](https://supabase.com/docs/guides/platform/database-size), [비용 통제](https://supabase.com/docs/guides/platform/cost-control)) | ✅(문서). 결제수단 연결 여부 ⬜ |
| Supabase 용량 | 실측 DB 18MB(거래 4.5MB, 7,068행). 월별 집계 예상 행 수 현재 1,540(12개월) → 36개월 약 5천 행 | ✅ 무료 500MB 대비 3.6%, Phase 2 추가 후에도 수십 MB 이하 예상 |
| data.go.kr | 개발계정 일일 트래픽 한도 | ⬜ 마이페이지 확인 필요(Phase 1부터 미확인). 필요 호출량은 3절 참고 |
| 카카오 | Phase 2에서 추가 사용 없음 | — |

## 7. 다음 단계 제안
1. 사용자 결정: D1~D12(특히 **D12 표본 부족에 따른 PRD 집계 단위**, D1 과거 수집, D3 면적 표시, D4 Phase 1 연결 부위 수정, D11 브랜치)
2. 승인 시 C(2023-11 등 과거 월 매매 2~4호출) 수행 후 이 보고서 갱신
3. 사용자 확인: Vercel Usage(초과 시 동작), Supabase Billing(결제수단), data.go.kr 일일 한도
4. G1 통과 후 P2-TASK-002(데이터 모델·마이그레이션 설계, 실행 없음)

## 8. 운영 DB 읽기 전용 조회 결과 (B, 2026-10-25 02:05 UTC)
사용자 PC에서 `default_transaction_read_only=on` + `BEGIN READ ONLY … ROLLBACK`으로 실행, 집계 값만 출력. 서버 PostgreSQL 17.11.

| 항목 | 결과 |
|---|---|
| 거래 상태 | 매매 ACTIVE 1,953 / CANCELLED 88, 전월세 ACTIVE 5,027. `MISSING_FROM_SOURCE` 0 |
| 계약일 범위 | 2025-11-01 ~ 2026-10-23 |
| 유효 매매(확정·ACTIVE) | 1,867건(제주시 1,396 / 서귀포시 471). 월별 제주시 55~163, 서귀포시 25~56 |
| 확정 매칭 일관성 | 확정 없이 연결된 거래 0, 확정인데 미연결 0, 거래당 검토 2건 이상 0 → AC-015는 `apartment_id IS NOT NULL` 규칙 + 회귀 테스트로 보증 가능 |
| 매매 매칭 상태 | CONFIRMED 1,950 / PENDING 91 |
| 면적 유형 차이 | 1,867건 중 1,280건(69%)이 버림≠반올림 |
| 단지×면적 묶음(12개월) | 838개, 3건 이상 175개, 최대 49건, 중간값 1건, 단지 585개 |
| 월별 집계 예상 행 | 1,540(12개월 기준) |
| 같은 조건 유효 매매 | 2건 이상인 키 11개 |
| 수집 이력 | MOLIT_SALE·MOLIT_RENT × 2개 시 × 12개월 모두 최신 SUCCESS, PARTIAL/FAILED/RUNNING 0. 원천별 작업 32회 / 24 (시,월) → 재수집 흔적 있음(재검증 구분 기록은 없음) |
| 마지막 수집 완료 | 2026-10-24 04:57 UTC → Cron 미가동이라 36시간(Phase 1 기준) 경과 후 화면에 갱신 지연 안내 표시 예정 |
| 용량 | DB 18MB, transactions 4.5MB, match_reviews 1.3MB, apartments 0.7MB |
