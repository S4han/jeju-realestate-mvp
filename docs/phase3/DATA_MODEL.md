# Phase 3 — 지역 데이터 모델 및 마이그레이션

> 상태: STEP 6 최종 승인 반영 / 문서 확정. 실제 API·DB·공급자 요금·경계 라이선스 검증 및 개발·테스트는 **미수행**이며 Claude Code 책임 작업.
> 변경 경계: **docs/phase3/** 및 **tasks/phase3/** 신규 파일만. Phase 1·2 기존 파일·API·데이터 변경 금지. 기능 플래그 기본 OFF, 공개 전 사용자 수동 승인.
> 기준: 한국시간(Asia/Seoul), 아파트 **매매** 계약일 기준. 샘플 숫자는 실거래 아님.

## 1. 논리 엔터티 (실제 DB 확인 전 가설)
| 엔터티 | 핵심 필드 | 제약 |
|---|---|---|
| p3_regions | region_id PK, official_code, name, level(CITY/LEGAL_DONG), parent_id, valid_from/to | 코드 유효기간·계층 검증, 중복 금지 |
| p3_region_boundaries | region_id, boundary_version, geometry, crs, source, license, checksum, verified_at | (region_id,boundary_version) 유일; 유효 GeoJSON/geometry |
| p3_apartment_region_map | apartment_id, region_id, mapping_status, valid_from/to, source_code, verified_at | 계약일 기준 유일한 확정 지역; 충돌은 보류 |
| p3_region_monthly_stats | snapshot_id, region_id, contract_month, trade_count, unmapped_count | 월별 거래량만 신뢰할 사전 집계; 복합 유일 키 |
| p3_region_analysis_versions | snapshot_id, source_watermark, boundary_version, validation_status, published_at | ACTIVE는 단일 포인터로 관리 |
| p3_region_analysis_runs | run_id, snapshot_id, scope, started_at, ended_at, status, errors | 실패·재시도·근거 기록 |

## 2. 설계 주의
실제 Phase 1·2 DB 테이블/컬럼·키·거래 식별자·면적 단위는 Claude Code에서 읽기 전용 확인 후 매핑. 기존 테이블 수정 금지. p3_* 전용 테이블·인덱스 추가도 별도 마이그레이션 승인과 백업/롤백 검토 필요. 시와 읍면동 간 공식 부모 관계 및 계약일 코드 이력을 확인. 좌표계(CRS)·폴리곤 유효성·중첩·누락·위상 검증; 원본 경계와 렌더링용 단순화 경계 버전 연결.

## 3. 정합성 불변식
- 거래 1건은 같은 레벨의 확정 지역에 최대 1번만 포함.
- 시 전체 거래량 = 하위 확정 읍면동 거래량 합 + 해당 시 하위 미매핑 거래량. 시 자체 미매핑 거래는 별도 격리해 전체 범위 정의를 명확히 함.
- 기간 월별 거래량 합과 원본 유효 거래 수 대사; 정정·취소 후 재계산.
- 공개 스냅샷은 거래·매핑·월별 집계·가격 계산 입력·경계·범례의 일관된 참조를 보유.
- 가격 계산 시 원본 정밀 면적 보존; Phase 2 면적 유형 반올림값을 분모로 사용 금지.

## 4. 마이그레이션/롤백
신규 스키마 준비→검증된 경계·코드 로드→매핑 검증→별도 스냅샷 집계→대사→ACTIVE 포인터 전환. 오류 시 포인터 유지, 신규 스냅샷 격리. 롤백은 플래그 OFF 및 이전 정상 스냅샷 포인터 복구; 기존 Phase 1·2 데이터 불변.
