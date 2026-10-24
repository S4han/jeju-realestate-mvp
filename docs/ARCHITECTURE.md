# 기술 아키텍처

React + TypeScript + Vite + Tailwind 모바일 웹 → TypeScript API Routes → PostgreSQL 무료 DB 후보.
지도는 카카오맵 JavaScript SDK 우선 검토. 브라우저는 서버 전용 API 키를 알 수 없어야 함.

## 내부 API
- GET /api/apartments/search?q=&city_code=&limit=
- GET /api/apartments/map?bbox=&zoom=&city_code=
- GET /api/apartments/{id}
- GET /api/apartments/{id}/transactions?type=&from=&to=&sort=&page=&page_size=
- GET /api/transactions/{id}
- GET /api/system/data-status

## 수집 경로
예약 배치 → API 호출 예산 검증 → 외부 API 수집 → XML/CSV 파싱 → 정규화 → 단지 매칭 → DB 반영 → sync_jobs 갱신. 사용자 지도 조작 시 외부 국토교통부 API 직접 호출 금지.

## 프론트 UX
검색 자동완성 → 단지 선택 시 지도 이동; 지도 영역(bounds) 변경 시 디바운스 후 마커 재조회; 마커 선택 시 요약 카드; 상세에서 확정 매칭 거래만 표시. 지도 실패 시 목록 검색 대체.

## 호스팅
Vercel 무료 플랜 우선 검토하되 이용조건·상업적 사용·제한·과금 검증 전 확정하지 않음.
