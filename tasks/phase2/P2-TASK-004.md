# P2-TASK-004 — 분석 API·캐시·근거 거래

> 상태: 최종 승인 반영 설계 문서 / 실제 API·DB·요금제 검증 및 구현 미수행. Claude Code에서 현행 코드 확인 후 수행.
> 범위: Phase 2 신규 파일만 추가. Phase 1 파일 수정 금지. 기능 플래그 기본 OFF. 사용자 수동 공개 승인 필수.

## 목표
areas/summary/monthly/points/transactions/status API(PRD v1.1, 단일 함수), 서버 검증, 버전 커서, 409, 캐시 무효화

## 참조 문서
docs/phase2/API_SPEC.md

## 수행 절차
1. 실제 저장소·스키마·API 계약 확인 후 설계와 차이 기록.
2. Phase 1 변경 없이 Phase 2 전용 작업으로 계획/구현(이후 Claude Code 수행).
3. 정상·경계·실패·회귀 테스트 증거 수집.
4. 다음 작업 진행 전 결과와 미해결 위험 보고.

## 완료 기준
요청/응답 계약, 400/404/409, 비밀 노출 방지, 페이지 무중복

## 제한
검증·개발은 Claude Code 담당. 이 문서 생성 시 실제 API 호출·DB 변경·코드 개발은 수행하지 않음. 기능 플래그 기본 OFF, 월 0원 목표, 비밀키 보호.

## 결과 (2026-10-25)
- 구현: `api/v2/analysis/apartments/[id]/[view].ts`(함수 1개), `server/phase2/handlers.ts`(입력 검증·view 분기), `server/phase2/cursor.ts`(HMAC 커서), `server/phase2/flag.ts`(OFF 기본, OFF 시 404·DB 미접근). Phase 1 변경은 D4 허용 범위인 `server/dev-server.ts` 경로 1줄뿐.
- 테스트: `tests/phase2/api.test.ts` 8개 — 플래그 판정·OFF 시 6개 view 모두 404(DB 미접근), 커서 위변조/다른 비밀값/형식 오류 거부, 입력 검증 400, 미존재 단지 404, 기본 면적·공통 dataVersion·캐시, `all`·points, 커서 페이지 무중복·필터 불일치 400·데이터 변경 409·비밀값 없음 503, DB 장애 503. 전체 125/125.
- 로컬 HTTP 확인(개발 서버, 합성 DB): 플래그 ON 6개 view 200, 잘못된 view 404, 잘못된 기간 400, 플래그 OFF 404, Phase 1 검색 200.
- 남은 일: Preview에서 경로 라우팅 확인(플래그 OFF 상태의 JSON 404로 판별), 운영 데이터로의 실제 확인은 플래그 ON 승인 후.
