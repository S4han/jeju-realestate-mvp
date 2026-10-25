# P3-TASK-003 Phase 3 전용 데이터 모델·지역 매핑

작성 2026-10-25. 결정: P3-D1 B(참조 데이터만 저장, 통계는 요청 시 계산), P3-D2(단지 코드 상향), 경계 파일 저장소 밖 보관(B).
**운영 DB 변경 없음** — 로컬 PostgreSQL 16에서만 마이그레이션·적재 리허설. Phase 1·2 파일 수정 0건.

## 1. 데이터 모델 (`db/migrations/0005_p3_regions.sql`)
| 테이블 | 내용 | 핵심 제약 |
|---|---|---|
| `p3_region_sets` | 코드표·경계 원천/기준일/sha256, 원본 좌표계, 단순화 허용오차, 상태(LOADING·VERIFIED·ACTIVE·REJECTED·RETIRED), 검증 결과(jsonb) | **ACTIVE는 DB가 1개만 허용**(부분 유일 인덱스), VERIFIED 이상은 `verified_at` 필수 |
| `p3_regions` | 시 2 + 법정 읍면동 74(세트별) | 코드 형식 `50(110|130)xxx00`, 레벨·시 코드 일관성 CHECK |
| `p3_region_boundaries` | 읍면동 경계(WGS84 GeoJSON MultiPolygon), bbox, 정점 수, 원본 면적 | 지역 FK, MultiPolygon만 |
- 기존 0004의 RLS 목록은 고정이므로 0005가 새 테이블에 **RLS 활성화 + Supabase API 역할 권한 회수**를 직접 수행(테스트로 확인).
- 문서의 월별 집계·스냅샷·runs 테이블은 만들지 않음(P3-D1 B). 거래 → 지역 매핑도 테이블 없이 조회 시 계산(`server/phase3/mapping.ts`).
- 되돌리기: `DROP TABLE p3_region_boundaries, p3_regions, p3_region_sets` + `schema_migrations`에서 0005 삭제(로컬에서 확인, Phase 1·2 데이터 그대로).

## 2. 코드 (모두 신규 파일)
| 파일 | 역할 |
|---|---|
| `server/phase3/regionCode.ts` | 리 → 읍면 상향, 거래 코드·단지 코드 일치 판정 |
| `server/phase3/geo/tm5186.ts` | EPSG:5186 ↔ WGS84 변환(외부 패키지 없음) |
| `server/phase3/geo/shapefile.ts` | .shp 폴리곤·.dbf 속성(EUC-KR) 읽기, 면적, 점 포함 |
| `server/phase3/geo/simplify.ts` | **공유 경계선 단순화**: 이웃 지역이 같은 단순화 선을 공유 → 틈·겹침 없음 |
| `server/phase3/regionSet.ts` | 코드표+경계로 세트 구성·검증(누락/추가/중복/이름/좌표계/빈 형상/구멍), 단지 좌표 포함 검사, 저장(VERIFIED/REJECTED), **원자적 활성화** |
| `server/phase3/mapping.ts` | 유효 매매(Phase 2와 같은 정의) → 읍면동. 격리 상태 UNMATCHED / CODE_NOT_IN_SET / CODE_CONFLICT |
| `scripts/phase3/load-regions.ts` | 적재 CLI(검증만 / `--save` / `--activate`) |
| `scripts/phase3/windows/regions.ps1` | 운영 적재 PC 키트: check(읽기) → migrate → load → activate → status, rollback. 쓰기 단계는 확인 문구 입력 필요 |
| `tests/phase3/geo.test.ts`, `tests/phase3/regions.db.test.ts`, `tests/helpers/shapefileFixture.ts` | 테스트(가상 경계·코드) |

## 3. 테스트
- 명령: `TEST_DATABASE_URL=postgres://jeju:<pw>@localhost:5432/jeju_test npm test` → **22 파일, 168/168 통과**(Phase 1·2 155건 회귀 포함, Phase 3 13건 신규). `tsc --noEmit` 통과, 번들 비밀 노출 검사 통과.
| 검증 | 대응 TC |
|---|---|
| EPSG:5186 원점·왕복 오차 < 1cm, 다른 좌표계 .prj 거부 | TC-004 기반 |
| SHP/DBF 읽기(여러 고리, EUC-KR) | — |
| 공유 경계 단순화: 이웃 경계 정점 동일, 작은 섬 제거, 허용오차 0이면 원본 | TC-008 기반 |
| 리 → 읍면 상향, 비제주·시 코드 거부 | TC-004 |
| 세트 검증: 누락·추가·중복·이름 불일치·빈 폴리곤·좌표계 → 오류 | TC-008, P3-FR-021 |
| 단지 좌표가 자기 읍면동 밖이면 보고, 세트에 없는 코드 분리 | TC-005, TC-007 |
| 새 테이블 RLS 활성화 | 보안 |
| VERIFIED만 활성화, REJECTED는 행 없이 기록·활성화 불가, 기존 ACTIVE 유지, DB가 ACTIVE 2개 거부 | TC-034 유사(원자적 교체) |
| 매핑: 동·리 상향·거래 코드 누락 시 단지 코드 신뢰·충돌 격리·세트에 없는 코드 격리·미매칭은 시 단위만·취소/기간 밖 제외 | TC-004, 007, 021, 024, 025 |
| **시 = 하위 읍면동 합 + 격리분(미매칭·충돌·세트 외)**, 거래 1건은 정확히 1번 | TC-017 |

## 4. 실제 파일 리허설 (로컬 DB, 합성 Phase 1 데이터 복제본)
- 마이그레이션 0005 적용 → 적재(`--save`) → VERIFIED(set 1) → 활성화 → ACTIVE.
- 결과: 지역 76(시 2 + 읍면동 74), 경계 74, 정점 12,311(20m, 공유선 498개 재사용), 면적 1,848.1㎢, 오류 0, **경계 테이블 240kB**, GeoJSON 약 259KB.
- 단지 좌표 포함 검사는 합성 DB에 검증 좌표가 없어 0건 → **운영 적재(check 단계)에서 실측**.

## 5. 운영 반영 절차(승인 필요, 아직 실행 안 함)
1. `regions.ps1 -Step check` — 읽기만: 대기 마이그레이션 확인(0005만), 파일 검증, **운영 단지 좌표 → 읍면동 포함 전수 검사**
2. `-Step migrate` — p3_* 테이블 생성(MIGRATE 입력)
3. `-Step load` — 세트 저장(LOAD 입력), 결과 세트 번호 확인
4. `-Step activate -SetId N` — 활성화(ACTIVATE 입력)
5. `-Step status` — 확인. 문제 시 `-Step rollback`(ROLLBACK 입력)
- Phase 3 API·화면이 아직 없으므로 적재해도 사용자 화면 변화 없음. 기능 플래그 OFF 유지.

## 6. 미검증·위험
- 운영 단지 좌표 포함 검사 결과(경계 근처 단지가 이웃 지역으로 판정될 수 있음 → 매핑은 코드 기준이라 통계 영향 없음, 보고만).
- 브이월드 이용조건 화면 캡처 미수령.
- 운영 Postgres 17 + Supabase에서의 마이그레이션은 미실행(로컬 16에서만 확인).
