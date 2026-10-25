# P2-TASK-007 — 비용·장애·출시 게이트

> 상태: 최종 승인 반영 설계 문서 / 실제 API·DB·요금제 검증 및 구현 미수행. Claude Code에서 현행 코드 확인 후 수행.
> 범위: Phase 2 신규 파일만 추가. Phase 1 파일 수정 금지. 기능 플래그 기본 OFF. 사용자 수동 공개 승인 필수.

## 목표
48시간 경고, 무료 한도/과금 차단, Fail-Closed, 장애 격리, 플래그 OFF/ON 복구, 공개 승인 요청

## 참조 문서
docs/phase2/SECURITY_COST.md, docs/phase2/IMPLEMENTATION_PLAN.md

## 수행 절차
1. 실제 저장소·스키마·API 계약 확인 후 설계와 차이 기록.
2. Phase 1 변경 없이 Phase 2 전용 작업으로 계획/구현(이후 Claude Code 수행).
3. 정상·경계·실패·회귀 테스트 증거 수집.
4. 공개 활성화 전에 사용자 수동 승인 요청.

## 완료 기준
비용 증거, 플래그·복구 결과, 최종 사용자 수동 공개 승인 기록

## 제한
검증·개발은 Claude Code 담당. 이 문서 생성 시 실제 API 호출·DB 변경·코드 개발은 수행하지 않음. 기능 플래그 기본 OFF, 월 0원 목표, 비밀키 보호.

## 결과 (2026-10-25)
게이트 문서: `docs/phase2/P2-TASK-007_GATE.md`. 비용 증거(외부 호출·스키마·Cron 추가 없음, 함수 9/12, CDN HIT, 청구 기록 없음), Fail-Closed 표, Preview 플래그 OFF(404·Phase 1 정상)→ON(200·버전 동일) 복구 실측. 미확인: Vercel 초과 시 동작, Supabase 결제/Spend Cap, 카카오 쿼터(사용자 계정 화면). Production 공개 승인 대기.
- 2026-10-25 사용자 공개 승인(A안) → Production 반영 완료(8d0925a, 플래그 ON). 상세: 게이트 문서 7절.
