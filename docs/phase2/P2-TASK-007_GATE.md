# P2-TASK-007 비용·장애·출시 게이트 (G5)

작성 2026-10-25. ✅ 확인(근거 있음) · ⬜ 미확인(사용자 계정 화면 필요) · ⚠ 주의.

## 1. 비용 (월 0원)
| 항목 | 상태 | 근거 |
|---|---|---|
| Phase 2가 외부 유료 API를 호출하지 않음 | ✅ | v2 코드는 DB 읽기만. data.go.kr·카카오 서버 호출 없음, 새 Cron 없음(`vercel.json` 변경 없음) |
| 추가 수집 비용 | ✅ | 과거 2년 매매 백필은 1회 완료(D1). 이후 Phase 1 일일 Cron만 사용 |
| DB 용량·스키마 | ✅ | 새 테이블·인덱스·마이그레이션 없음(대안 B). DB 약 24MB / Supabase Free 500MB |
| DB 부하 | ✅ | 요청당 쿼리 수 ms(로컬 p95 13~24ms), 읽기 전용 트랜잭션 + 2초 타임아웃 |
| Vercel 함수 수 | ✅ | 9개(Phase 2는 단일 함수 1개 추가, D5). Hobby 배포당 12개 제한 이내 |
| CDN 캐시로 함수 호출 감소 | ✅ | `s-maxage=300`, Preview에서 같은 URL 두 번째 요청 `x-vercel-cache: HIT` 확인 |
| Vercel 청구 내역 | ✅(간접) | 청구 API 조회(2026-09-25~10-25) 결과 "costs_not_found" — 청구 기록 없음 |
| Vercel 한도 초과 시 정지 vs 과금 | ✅ | 2026-10-25 사용자 계정 Billing 화면: **Hobby Plan Active**, 사용량 추가 과금("on-demand usage")·Spend Management는 Pro 업그레이드 시에만 제공 → Hobby는 초과분 자동 과금 경로 없음. 청구 API도 기록 없음. ⚠ 초과 시 과금 대신 기능 제한(서비스 중단 가능) — 비용이 아닌 가용성 위험. Pro 업그레이드 버튼은 누르지 말 것 |
| Supabase 결제수단·Spend Cap | ✅ | 2026-10-25 사용자 조직 청구 화면: **무료 플랜**, "포함된 사용량에 의해 제한", **지출 한도(Spend Cap) 활성화** — "사용량에 따라 추가 요금이 부과되지 않음". ⚠ 할당량 초과 시 프로젝트 무응답·읽기 전용 전환 가능(가용성 위험). '구독 플랜 변경'·'지출 한도 변경'은 누르지 말 것 |
| 카카오 지도 쿼터 초과 시 동작 | ⬜ | Phase 2는 지도 호출을 늘리지 않음. 다만 공개 자체의 전제(Phase 1 미해결) |
| data.go.kr 일일 한도 | ⬜ | Phase 2 추가 호출 없음. Phase 1 미해결 항목 |

## 2. 장애·Fail-Closed
| 상황 | 동작 | 근거 |
|---|---|---|
| 플래그 미설정/`true` 외 값 | 모든 v2 경로 404, DB 접근 없음, 탭 미표시 | `api.test.ts`, E2E OFF, Preview 실측 |
| 커서 비밀값 없음/짧음 | 근거 거래만 503, 나머지 정상 | `api.test.ts` |
| DB 장애·타임아웃 | 503 일반 메시지, 내부 정보 없음, Phase 1 계속 동작 | TC-025 |
| 데이터 버전 혼합 | 화면이 1회 재조회 후 오류 안내, 커서는 409 | TC-029/030, UI 코드 |
| 수집 실패 | 미수집 월은 0건이 아닌 "미수집", 통계 차단 | TC-016/020 |
| 48시간 초과 미갱신 | STALE 경고 + 마지막 정상 데이터 표시 | `analysis.db.test.ts`, UI 안내 |
| 분석 탭 오류 | 탭 안에서 오류·다시 시도, 매매/전월세 탭 그대로 | UI 코드, E2E |
| Phase 2 코드의 DB 쓰기 | 읽기 전용 트랜잭션이 거부 | TC-026 |

## 3. 플래그 OFF/ON 복구 (Preview, 2026-10-25 실측)
1. `PHASE2_PRICE_ANALYSIS_ENABLED=false` → 재배포 `dpl_6Bu8prLn…`: 분석 `summary` **404** `{"error":{"code":"NOT_FOUND"}}`, Phase 1 거래 목록 **200**(28건).
2. `true`로 복구 → 재배포 `dpl_FvLPuuDK…`: `summary` **200**, dataVersion `59642817e751869f`(OFF 전과 동일), 데이터 변화 없음.
3. 소요: 환경 변수 변경 + 재배포 약 1분. 코드·DB 변경 불필요.

## 4. 출시(공개) 절차 — 사용자 수동 승인 필요, 아직 수행 안 함
현재: Production(`jeju-realestate-mvp.vercel.app`)에는 Phase 2 코드가 없음(v2 경로 404). 사이트는 Vercel 인증 보호(비공개) 유지 중.

권장 순서:
1. ⬜ 계정 화면 확인(1절 ⬜ 1건 남음: 카카오 쿼터. Vercel·Supabase는 확인 완료) — **과금 차단 불확실 시 공개 보류**(PRD).
2. Phase 2 브랜치를 Production 배포 브랜치에 병합 → **플래그 OFF로** Production 배포 → Phase 1 회귀 확인(지도·검색·상세·대시보드).
3. Production 환경 변수 `P2_CURSOR_SECRET`(새 값, Preview와 다르게) 설정, `PHASE2_PRICE_ANALYSIS_ENABLED=true` → 재배포 → 실데이터 확인.
4. 문제 시 즉시 플래그 `false` + 재배포(3절, 약 1분).

## 5. 잔여 위험
- 배포 환경 p95 미측정(로컬 DB 시간은 충분, 네트워크·콜드스타트가 지배적일 것).
- 운영 DB EXPLAIN 미확인(사용자 PC).
- Phase 1 지도 E2E 로컬 환경 미복구.
- Preview 커서 비밀값은 작업 기록에 1회 노출 → Production에는 새 값 사용, Preview 값도 교체 권장.
- 요청률 제한은 Phase 1과 동일하게 별도 없음(Vercel·CDN 캐시 의존). 공개 범위 확대 시 재검토.
- 공용 DB(Phase 1과 공유) 장애 시 두 기능 모두 영향.

## 6. 사용자 승인 기록
- 2026-10-25: Preview 전용 플래그 ON 승인·실시, 휴대폰 확인 완료.
- Production 공개 승인: **대기**.
