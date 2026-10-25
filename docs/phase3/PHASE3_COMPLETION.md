# Phase 3 지도 기반 지역 분석 — 완료 기록

**상태: 완료(2026-10-25, 사용자 휴대폰 Production 확인 후 승인).** Production `jeju-realestate-mvp.vercel.app` 대시보드 "지역 분석 →"(`#/regions`)에서 시·읍면동별 ㎡당 중위가격·거래량 지도, 지역 상세, 두 지역 비교 제공(사이트는 Vercel 인증 보호로 비공개 유지).

## 작업별 결과
| 작업 | 결과 | 근거 |
|---|---|---|
| P3-TASK-001 현행 분석 | Phase 1·2 구조·문서 차이 식별, 결정 P3-D1~D5 | `P3-TASK-001_REPORT.md` |
| P3-TASK-002 공식 코드·경계 원천 | 법정동 코드(15063424, 2026-06-30), 경계 LSMD_ADM_SECT_UMD_50_202610, 74/74 일치 | `P3-TASK-002_REPORT.md` |
| P3-TASK-003 데이터 모델·적재 | `0005_p3_regions.sql`, 지역 세트 1 ACTIVE, 단지 1,090/1,090 경계 일치 | `P3-TASK-003_REPORT.md` |
| P3-TASK-004 통계 | 요청 시 읽기 전용 스냅샷 계산, 5분위(동률 유지) | `server/phase3/statistics.ts` |
| P3-TASK-005 API | 단일 함수 `api/v3/regions/[view].ts`(함수 10/12), 플래그 OFF 404, 409 버전 혼합 차단, 서명 커서 | `P3-TASK-005_REPORT.md` |
| P3-TASK-006 모바일 UI | 카카오 폴리곤 지도·범례·표 대체·상세·비교, Phase 1 수정은 `App.tsx`·`dev-server.ts`만 | `P3-TASK-006_REPORT.md` |
| P3-TASK-007 테스트·대사·성능 | 필수 40 TC, 전체 230/230, 운영 대사 불일치 0, 로컬 p95 26~176ms | `P3-TASK-007_REPORT.md` |
| P3-TASK-008 비용·장애·출시 | 월 0원, OFF/ON 복구 실측, 변화율 안내 문구 후 Production 공개 | `P3-TASK-008_GATE.md` |

## 운영 정보
- 코드: Production 배포 `dpl_AhZS2nsL…`(117381d, 플래그 ON), 브랜치 `claude/jeju-realestate-mvp-analysis-6suje9`(= `claude/phase3-region-analysis`).
- 환경 변수(Production): `PHASE3_REGION_ANALYSIS_ENABLED=true`, `P3_CURSOR_SECRET`(sensitive). Preview는 Phase 3 브랜치 한정 별도 값.
- 운영 DB: 지역 세트 1 ACTIVE(2026-10-25), p3 테이블 약 240kB. 경계 원본 파일은 저장소에 넣지 않음.
- 끄기: 플래그 `false` + 재배포(약 1분). 전체 롤백: `dpl_HJojQPWE…`(d203298, Phase 2까지). 지역 테이블 제거: `scripts/phase3/windows/regions.ps1 -Step rollback`.
- 비용: Vercel Hobby, Supabase Free(지출 한도), 카카오맵 무료 쿼터. Phase 3는 외부 API 호출·Cron·앱 DB 쓰기 없음.
- 지역 세트 갱신(법정동 변경 시): PC에서 `regions.ps1` check → load → activate. 검증 실패 세트는 REJECTED, 기존 세트 계속 제공.

## 공개 확인 (2026-10-25)
- Production API: status·statistics·list·detail·apartments 200, snapshot `1-3659bf993805d395`, 시별 수치가 운영 대사와 일치(제주시 2,962건·4,335,501원/㎡, 서귀포시 1,122건·3,867,879원/㎡).
- 사용자 휴대폰 Production 화면 확인 완료.
- 화면 상세 확인(사용자 휴대폰, 2026-10-25): 제주시 단계 노형동 선택 — 지도에 제주시 읍면동만 채색·선택 테두리, 범례 5단계(대상 29곳, 227~315 ~ 616~725만원/㎡)·표본 부족·아파트 없음 표시. 상세 24개월: ㎡당 714만원(평당 2,362만원, 최상위 단계와 일치), 527건, 1년 전 대비 −0.2% + 변화율 안내 문구, 데이터 정상·이번 달(26.10) 잠정, 월별 24개 막대(최대 38건, 이번 달 흐림), 거래 단지 목록 → Phase 1 상세 연결.

## 남은 항목(후속, 필수 아님)
1. Production·Preview `P3_CURSOR_SECRET`(및 Phase 2 커서 비밀값) 대시보드에서 새 값으로 교체(작업 기록에 1회 노출).
2. 배포 환경 응답 시간 실측(PC에서 `scripts/phase3/perf.mjs`).
3. 실기기 스크린리더 확인(지역 표가 키보드·스크린리더 경로).
4. 요청량 제한(429) — 공개 범위 확대 시 검토.
5. 브이월드 이용조건 화면 기록, 카카오 쿼터 초과 시 동작 확인.
6. 수집 누락·지연 상태 화면 실기기 확인(해당 상황 발생 시).
