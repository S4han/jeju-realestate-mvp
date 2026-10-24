# TASK-009 배포·운영 검증

상태: 진행 중 · Supabase 마이그레이션·데이터 적재 완료(건수 대조 일치), Data API 차단 실제 확인 완료, Vercel 배포 대기 · 인계 메모 docs/TASK-009_HANDOFF.md

## 목적
무료 DB/호스팅/지도 실제 조건, GitHub 배포, 모니터링, 롤백, 운영 체크리스트

## 완료 기준
월 0원 조건 입증 전 공개 보류, 사용자 최종 승인

## 공통 지침
- docs/PRD.md 및 docs/SECURITY_COST.md 준수
- 외부 API 실제 호출 전 사용자 승인
- API Secret 노출 금지; 월 0원 운영 조건 위반 금지
- 테스트 결과·근거·미해결 사항 기록 후 다음 단계 승인 대기
