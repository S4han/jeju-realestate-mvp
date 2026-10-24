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
