# Phase 2 가격 분석 — 완료 기록

**상태: 완료(2026-10-25, 사용자 휴대폰 확인 후 승인).** Production `jeju-realestate-mvp.vercel.app`에서 단지 상세 "가격 분석" 탭 제공(사이트는 Vercel 인증 보호로 비공개 유지).

## 작업별 결과
| 작업 | 결과 | 근거 |
|---|---|---|
| P2-TASK-001 현행 확인(G1) | 완료 | `P2-TASK-001_REPORT.md`, D1~D12 결정 |
| 과거 매매 백필(2023-11~2025-10) | 완료 | `BACKFILL_RUNBOOK.md` |
| P2-TASK-002 데이터 모델(G2) | 대안 B: 새 테이블·마이그레이션 없음 | `P2-TASK-002_DESIGN.md` |
| P2-TASK-003 계산 로직(G3) | 읽기 전용 스냅샷·dataVersion | `server/phase2/analysis.ts` |
| P2-TASK-004 API | 단일 함수, 플래그 OFF 404, 서명 커서 | `api/v2/analysis/apartments/[id]/[view].ts` |
| P2-TASK-005 모바일 UI(G4) | 탭·카드·가격/거래량 그래프·근거 거래 | `src/phase2/`, Phase 1 수정은 `TransactionsPage.tsx`만 |
| P2-TASK-006 테스트·성능 | 필수 30 TC 통과, 전체 155/155, 로컬 p95 13~24ms | `P2-TASK-006_REPORT.md` |
| P2-TASK-007 비용·장애·출시(G5) | 과금 차단 확인, OFF/ON 복구, Production 반영 | `P2-TASK-007_GATE.md` |

## 운영 정보
- 코드: Production 배포 `dpl_5cNew7XB…`(8d0925a), 브랜치 `claude/jeju-realestate-mvp-analysis-6suje9`(= `claude/phase2-price-analysis`).
- 환경 변수(Production): `PHASE2_PRICE_ANALYSIS_ENABLED=true`, `P2_CURSOR_SECRET`(sensitive). Preview는 Phase 2 브랜치 한정으로 별도 값.
- 끄기: 플래그 `false` + 재배포(약 1분). 전체 롤백: `dpl_89EQW5ZA…`(22578e5).
- 비용: Vercel Hobby(초과 과금 경로 없음), Supabase Free(지출 한도 활성), 카카오맵 무료 쿼터. Phase 2는 외부 API 호출·Cron·DB 쓰기 없음.

## 남은 항목(후속, 필수 아님)
1. 배포 환경 p95 실측(PC에서 `scripts/phase2/perf.mjs`).
2. 운영 DB EXPLAIN(읽기 전용, PC).
3. 카카오 쿼터 초과 시 동작·비즈월렛 연결 여부 확인.
4. Preview `P2_CURSOR_SECRET` 교체(작업 기록에 1회 노출). Production 값도 같은 이유로 교체 권장.
5. Phase 1 지도 E2E 로컬 환경 복구.
6. 수집 누락·표본 부족·지연 상태 화면 실기기 확인(해당 데이터 발생 시).
7. `scripts/phase2/backfill-verify.sql`의 한글 \echo 제목을 영어로(Windows 콘솔 깨짐).
