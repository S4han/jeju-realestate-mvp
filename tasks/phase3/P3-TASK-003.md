# P3-TASK-003 — Phase 3 전용 데이터 모델·매핑

> 상태: STEP 6 최종 승인 반영 / 문서 확정. 실제 API·DB·공급자 요금·경계 라이선스 검증 및 개발·테스트는 **미수행**이며 Claude Code 책임 작업.
> 변경 경계: **docs/phase3/** 및 **tasks/phase3/** 신규 파일만. Phase 1·2 기존 파일·API·데이터 변경 금지. 기능 플래그 기본 OFF, 공개 전 사용자 수동 승인.
> 기준: 한국시간(Asia/Seoul), 아파트 **매매** 계약일 기준. 샘플 숫자는 실거래 아님.

## 목적
p3_regions, boundaries, apartment_region_map, monthly_stats, versions, runs 설계·마이그레이션 초안. 계약일 코드 이력/상위 매핑/중복 방지/격리. 기존 Phase 1·2 DB 변경 금지, 필요 시 사용자 승인 요청.

## 선행 조건
P3-TASK-002 검증 결과 및 사용자 확인.

## 수행 절차
1. docs/phase3/PRD.md 및 관련 상세 문서를 읽고 현행 코드와 차이점을 정리한다.
2. p3_regions, boundaries, apartment_region_map, monthly_stats, versions, runs 설계·마이그레이션 초안. 계약일 코드 이력/상위 매핑/중복 방지/격리. 기존 Phase 1·2 DB 변경 금지, 필요 시 사용자 승인 요청.
3. 성공·실패·예외 fixture와 보안·비용·Phase 1·2 영향 여부를 점검한다.
4. 변경 파일 목록, 테스트 명령, 기대·실제 결과, 미검증 항목을 보고하고 다음 TASK 진행 전 확인을 받는다.

## 완료 기준
- 해당 요구사항·수용 기준의 증거와 실행 결과가 기록됨.
- 기존 Phase 1·2 파일 무단 수정 0건, Secret 노출 0건.
- 외부 API 검증·개발·배포는 Claude Code에서 사용자 승인 범위로 수행; 이 문서는 수행 완료 증거가 아님.
- 최종 공개는 전체 40건 및 추가 검증 통과와 사용자 수동 승인 후에만 가능.
