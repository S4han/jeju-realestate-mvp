# TASK-003 아파트 기준정보 및 좌표 구축

상태: 완료(사용자 승인 대기) · 2026-10-24

## 목적
한국부동산원·K-APT 단지 통합, 주소 정규화, 좌표 생성/검증

## 완료 기준
단지 ID·주소·좌표 출처 추적, 불확실 좌표 미표시

## 공통 지침
- docs/PRD.md 및 docs/SECURITY_COST.md 준수
- 외부 API 실제 호출 전 사용자 승인
- API Secret 노출 금지; 월 0원 운영 조건 위반 금지
- 테스트 결과·근거·미해결 사항 기록 후 다음 단계 승인 대기

## 결과 (2026-10-24)
- 적재: 아파트 1,153개 단지(제주시 892, 서귀포시 261). REB ID 매핑 1,153건, 별칭 1,593건
- 좌표: VERIFIED_PARCEL 1,090 / REVIEW 61 / NONE 2. 출처는 `location_source=CADASTRAL:AL_D002_50_20261008:PARCEL_CENTROID`
- TypeScript 구현과 TASK-001 Python 산출 결과의 차이: 위치 최대 1.1cm, 면적 0㎡(1,151건 비교)
- 재실행 멱등성 확인(inserted 0 / updated 1,153). 테스트 35개 통과
- 미구현: REVIEW 단지의 수동 확정(재적재 후에도 유지되는 override), K-APT 코드 매핑(지번이 없어 확정 키 없음)
