# TASK-008 보안·비용·성능·장애 테스트

상태: 완료(사용자 승인 대기) · 2026-10-24 · 결과 docs/ACCEPTANCE_RESULTS.md

## 목적
Secret/입력검증, 공급자 과금 차단, 호출 예산, 성능 지표, 데이터 지연·지도 장애 E2E

## 완료 기준
docs/ACCEPTANCE_TESTS.md 전체 검증과 실패 증거 기록

## 공통 지침
- docs/PRD.md 및 docs/SECURITY_COST.md 준수
- 외부 API 실제 호출 전 사용자 승인
- API Secret 노출 금지; 월 0원 운영 조건 위반 금지
- 테스트 결과·근거·미해결 사항 기록 후 다음 단계 승인 대기
