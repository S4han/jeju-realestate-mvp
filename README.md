# 제주 부동산 실거래 통합 검색 모바일 웹

상태: PRD v1.0 확정 (제품 요구사항); 외부 API·지도·무료 운영 조건은 개발 검증 전.

제주시·서귀포시 아파트를 지도와 이름 자동완성으로 검색하고 최근 12개월 매매·전월세 실거래를 확인하는 모바일 웹.

- [PRD](docs/PRD.md) · [개발계획](IMPLEMENTATION_PLAN.md) · [API 목록](docs/API_CATALOG.md)
- [데이터 모델](docs/DATA_MODEL.md) · [아키텍처](docs/ARCHITECTURE.md) · [보안/비용](docs/SECURITY_COST.md)
- [수용 테스트](docs/ACCEPTANCE_TESTS.md) · [API 검증](docs/API_VERIFICATION.md)
- [Claude Code 지침](CLAUDE.md) · [Codex 지침](AGENTS.md)

**개발 순서:** TASK-001부터 승인 후 순차 진행. 실제 API 호출, 키·쿼터·가격·응답 필드 확인은 개발 단계에서만 수행. Secret을 저장소에 커밋하지 않는다.

## 로컬 개발 (TASK-002)

요구사항: Node 20+, PostgreSQL 16

```bash
npm install
cp .env.example .env          # 값 채우기. .env는 커밋 금지
npm run db:migrate            # db/migrations/*.sql 순서 적용
npm run dev                   # web: http://localhost:5173, api: http://localhost:3001
npm test                      # TEST_DATABASE_URL DB는 테스트가 초기화함
npm run build                 # 타입 검사 + 브라우저 env 노출 검사 + 번들
```

- 구조: `src/`(React 화면), `api/`(Vercel API Routes), `server/`(핸들러·DB·설정), `db/migrations/`(SQL), `scripts/`(마이그레이션·점검), `tests/`
- 서버 전용 값(`DATABASE_URL`, `DATA_GO_KR_SERVICE_KEY`)에는 `VITE_` 접두어를 붙이지 않는다. `npm run check:env-exposure`가 `src/`의 허용되지 않은 env 참조를 막는다.

## 단지 기준정보·좌표 적재 (TASK-003)

```bash
npm run import:reference -- \
  --reb <getAptInfo 응답 page1.json> --reb <page2.json> \
  --cadastral <연속지적도 경로(확장자 제외), 예: data/AL_D002_50_20261008> \
  --reb-as-of 2026-09-01 [--dry-run]
```

- 입력은 로컬 파일만 사용한다(네트워크 호출 없음). 원본 데이터 파일은 저장소에 커밋하지 않는다.
- 한국부동산원 `COMPLEX_PK` 기준으로 upsert하며, 다시 실행해도 결과가 같다. 한 행이라도 실패하면 전체를 롤백한다.
- 좌표는 PNU 필지 중심점이다(EPSG:5186 → WGS84). 의심 필지는 `REVIEW`, 필지가 없으면 `NONE`이며 둘 다 마커를 만들지 않는다. 대상 목록: docs/LOCATION_REVIEW.md

## 실거래 수집 (TASK-004)

```bash
npm run collect -- --mode initial --max-calls 60       # 현재 월 포함 최근 12개월(KST)
npm run collect -- --mode incremental --max-calls 20   # 최근 4개월 재수집(정정·해제 반영)
npm run collect -- --months 202608,202609 --max-calls 10
```

- 매매는 상세 API(`RTMSDataSvcAptTradeDev`, 1,000행/페이지), 전월세는 `RTMSDataSvcAptRent`(400행/페이지)를 쓴다.
- `--max-calls`는 필수다(이번 실행의 외부 호출 상한). 출처별 일일 상한은 `API_DAILY_CALL_LIMIT`(기본 300)이고 `api_usage`에 기록한다.
- 한 달 치는 모든 페이지를 받았을 때만 반영한다. 실패하면 그 달의 기존 데이터를 그대로 둔다. 읽을 수 없는 행이 있으면 PARTIAL로 기록하고, 기존 행을 사라진 것으로 처리하지 않는다.
- 해제 거래는 `CANCELLED`로 보존한다. 같은 내용의 행은 `occurrence`로 구분한다. 원천에서 사라진 행은 `MISSING_FROM_SOURCE`로 표시하며 삭제하지 않는다.
- 운영: `api/cron/collect-transactions.ts`(Vercel Cron, 매일 03:00 KST, `CRON_SECRET` 필요, 1회 최대 30호출)
- 이 클라우드 환경에서는 `NODE_USE_ENV_PROXY=1`로 프록시를 쓴다(스크립트에 포함).

## 단지·거래 매칭 (TASK-005)

```bash
npm run match   # DB에 있는 데이터로 매칭 전체를 재계산(네트워크 호출 없음, 멱등)
```

- 원천 단지(`aptSeq`) 단위로 판정하고, 그 단지의 모든 거래가 판정을 따른다.
  - 매매가 있는 단지: 매매 상세 API로 만든 PNU가 기준 단지 **하나**에만 맞고, 원천 단지명이 **모두** 기준 단지명(별칭 포함)과 정규화 후 일치하면 확정
  - 전월세만 있는 단지: 지번주소가 기준 단지 하나와 정확히 일치하고 이름도 일치하면 확정
- 후보가 없거나 여러 개, 이름 불일치, 한 필지를 원천 단지 여럿이 쓰는 경우, 거래 행의 주소가 단지 주소와 다른 경우는 모두 보류하고 `match_reviews.reason`에 사유를 기록한다. 이름만으로는 연결하지 않는다.
- 확정된 거래에만 `transactions.apartment_id`가 설정된다. 보류 목록: docs/MATCH_REVIEW.md
- 매일 수집(Cron) 뒤 자동으로 실행된다.

## 검색·지도 화면 (TASK-006)

- API: `GET /api/apartments/search?q=&city_code=&limit=`, `GET /api/apartments/map?bbox=minLng,minLat,maxLng,maxLat&city_code=`, `GET /api/apartments/{id}`
- 지도: 카카오맵 JS SDK(`VITE_KAKAO_MAP_JS_KEY`, PAW_MAP 앱 키 공유). 키가 없거나 SDK 로드에 실패하거나 8초 안에 응답이 없으면 목록 검색으로 자동 전환한다.
- 마커: `VERIFIED_PARCEL` 단지만, 현재 지도 범위만(이동·확대 후 300ms 디바운스로 재조회). 클러스터러로 밀집을 처리한다.
- `npm run test:e2e`: 가짜 SDK로 지도·마커·검색·요약 카드 흐름과, SDK 차단 시 목록 대체를 390px 폭에서 검증한다(개발 DB 데이터 필요).
