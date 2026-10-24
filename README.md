# 제주 부동산 실거래 통합 검색 모바일 웹

상태: PRD v1.0 확정 (제품 요구사항); 외부 API·지도·무료 운영 조건은 개발 검증 전.

제주시·서귀포시 아파트를 지도와 이름 자동완성으로 검색하고 최근 12개월 매매·전월세 실거래를 확인하는 모바일 웹.

- [PRD](docs/PRD.md) · [개발계획](IMPLEMENTATION_PLAN.md) · [API 목록](docs/API_CATALOG.md)
- [데이터 모델](docs/DATA_MODEL.md) · [아키텍처](docs/ARCHITECTURE.md) · [보안/비용](docs/SECURITY_COST.md)
- [수용 테스트](docs/ACCEPTANCE_TESTS.md) · [API 검증](docs/API_VERIFICATION.md)
- [Claude Code 지침](CLAUDE.md) · [Codex 지침](AGENTS.md)

**개발 순서:** TASK-001부터 승인 후 순차 진행. 실제 API 호출, 키·쿼터·가격·응답 필드 확인은 개발 단계에서만 수행. Secret을 저장소에 커밋하지 않는다.
