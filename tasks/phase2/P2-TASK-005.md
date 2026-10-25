# P2-TASK-005 — 가격 분석 모바일 UI

> 상태: 최종 승인 반영 설계 문서 / 실제 API·DB·요금제 검증 및 구현 미수행. Claude Code에서 현행 코드 확인 후 수행.
> 범위: Phase 2 신규 파일만 추가. Phase 1 파일 수정 금지(예외: IMPLEMENTATION_PLAN의 'Phase 1 연결 부위 예외' 지정 파일). 기능 플래그 기본 OFF. 사용자 수동 공개 승인 필수.

## 목표
Phase 1 단지 상세 유지, 분석 탭·기간/면적·차트·표·근거 거래·표본/지연/오류 안내, 플래그 OFF

## 참조 문서
docs/phase2/PRD.md

## 수행 절차
1. 실제 저장소·스키마·API 계약 확인 후 설계와 차이 기록.
2. Phase 2 전용 파일로 구현. Phase 1은 `TransactionsPage.tsx`(플래그로 감싼 탭 연결)·`server/dev-server.ts`(개발 경로)만 최소 수정(D4).
3. 정상·경계·실패·회귀 테스트 증거 수집.
4. 다음 작업 진행 전 결과와 미해결 위험 보고.

## 완료 기준
모바일 접근성, all 가격 미표시, Phase 1 화면 회귀; 플래그 OFF 시 탭 미표시·v2 데이터 API 미호출 테스트; Phase 1 파일 diff 첨부

## 제한
검증·개발은 Claude Code 담당. 이 문서 생성 시 실제 API 호출·DB 변경·코드 개발은 수행하지 않음. 기능 플래그 기본 OFF, 월 0원 목표, 비밀키 보호.

## 결과 (2026-10-25)
- 신규: `src/phase2/api.ts`(v2 클라이언트, status 200일 때만 탭), `src/phase2/PriceAnalysis.tsx`(기간 12/24/36·면적 유형 칩·요약 카드·가격 그래프(개별 거래 점 + 분기 중위 보조선, 분기 사이 공백은 끊김)·월별 거래량(미수집 빗금, 이번 달/일부 수집 흐림)·근거 거래 커서 더 보기·409 시 처음부터 다시 보기·표로 보기·툴팁), `tests/e2e/phase2.e2e.mjs`.
- 한 화면의 모든 응답은 같은 `dataVersion`이어야 표시(다르면 1회 재조회 후 오류 안내).
- 차트 색: 범주 슬롯 1·2(#2a78d6, #eb6834) — dataviz 검증 스크립트 라이트/다크 모두 통과. 앱이 라이트 전용이라 다크 모드는 미적용.
- Phase 1 수정: `src/components/TransactionsPage.tsx`만(D4) — status 조회, 3번째 탭, 분석 중 기존 필터·목록 숨김.
- 테스트: 단위·DB 125/125 통과. E2E(합성 운영 규모 DB `p2_design`, 390px) 17/17 통과 — 플래그 OFF: 탭 2개·v2 요청은 status 1건(404)뿐·전월세 탭 정상 / ON: 카드·그래프·툴팁·근거 페이징·가로 넘침 없음·all 가격 미표시·all에서 points/transactions 미호출.
- 실행: `DATABASE_URL=... E2E_APARTMENT_ID=1 node tests/e2e/phase2.e2e.mjs`
- 미검증: 미수집·표본 부족·STALE 화면(합성 DB에 해당 상태 없음, API 판정은 DB 테스트로 검증), 실데이터 화면(Preview 플래그 ON 필요), 스크린리더 실기기 확인. 기존 지도 E2E(`map.e2e.mjs`)는 로컬 UI DB 문제로 변경 전 코드에서도 같은 실패 — 이번 변경과 무관.
