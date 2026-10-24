# TASK-009 진행 메모 (세션 인계용)

새 세션에서 이 문서와 docs/ACCEPTANCE_RESULTS.md, tasks/TASK-009.md를 먼저 읽는다. 모든 외부 실행 전에 사용자 승인을 받는다(CLAUDE.md).

## 현재 상태 (2026-10-24)
- TASK-001~008 완료(사용자 승인). TASK-009 승인됨, 단계별 승인 진행 중 — Supabase 적재·Data API 차단 확인 완료, 다음은 Vercel 배포
- 사용자 결정: 완전 비상업 / 신축 단지는 보류(A안) / 지도는 PAW_MAP 앱 키 공유(비즈월렛 미연결) / Vercel Hobby + Supabase Free
- Supabase: 사용자가 **서울(ap-northeast-2)** 프로젝트를 생성함(뭄바이 프로젝트는 리전 문제로 다시 만듦). 무료 유료 추가 기능인 IPv4 add-on은 사용하지 않음
  - 접속: Shared pooler, transaction mode, `aws-0-ap-northeast-2.pooler.supabase.com:6543`
  - 사용자가 환경 변수 `SUPABASE_DATABASE_URL`(비밀번호 포함)을 등록하고, 허용 도메인에 pooler 호스트를 추가함
  - 로컬 개발 DB(`DATABASE_URL`, .env)와 섞이지 않도록 이름을 따로 씀
  - 2026-10-24 점검: 비밀번호에 URL 예약문자(`?`)가 인코딩 없이 들어 있어 접속 문자열 해석이 깨짐 → 사용자가 **영문·숫자만으로 비밀번호 재설정 후 환경 변수 재등록**하기로 결정(A안). 환경 변수 변경은 새 세션부터 반영되므로 새 세션에서 1단계(형식 점검)부터 다시 확인
  - 2026-10-24 재점검: 비밀번호 재설정 후 형식 정상(호스트·포트 6543·자리표시자 없음·예약문자 없음·urlsplit 해석 정상)
- **클라우드 컨테이너는 DB에 직접 접속할 수 없다.** 외부 통신이 HTTPS 프록시로만 나가고 raw TCP(PostgreSQL)는 지원하지 않는다(`psql` 6543 접속 시 TCP 시간 초과). 허용 도메인 추가로도 해결되지 않는다. 배포된 Vercel 함수 → Supabase 접속에는 해당하지 않는다
- **2026-10-24 Supabase 초기 적재 완료(사용자 Windows PC에서 실행)**: `scripts/windows/supabase-setup.ps1` (단계 check → migrate → restore → verify, Session pooler 5432, `sslmode=require`)
  - 서버 PostgreSQL 17.11, PC 클라이언트 psql/pg_restore 18.6
  - 마이그레이션 0001~0004 적용(`schema_migrations` 4건)
  - 백업 `jeju_data_20261024.dump` 복원: 크기 486,829바이트 일치, SHA-256 `ED66BAA8A9A15A7BEE387451FC88BC877FA65728FCE35824E1F377488451F1B7`, 단일 트랜잭션
  - 건수 대조(`scripts/windows/supabase-verify.sql`): 단지 1,153 / 거래 7,068 / 확정 매칭 6,920 / 매칭 검토 전체 7,068(보류 148 = TASK-008과 같음) / 원천 ID 1,981 / 별칭 1,593 / sync_jobs 71 / api_usage 2 — 기대값 모두 일치
  - 공개 API 차단(DB 내부 확인): 앱 테이블 8개 모두 RLS 켜짐, `anon`·`authenticated` SELECT 권한 없음
  - 공개 API 차단(실제 REST 확인, 사용자 PC): publishable 키로 `/rest/v1/{apartments,transactions,match_reviews}?select=*&limit=1` 조회 → 세 테이블 모두 HTTP 401 `42501 permission denied`. 컨테이너에서는 `<ref>.supabase.co`가 네트워크 정책으로 차단됨(프록시 403)

## 주의
- 저장소가 **공개(public)**다. 데이터 덤프·원본 응답·지적도 파일은 커밋하지 않는다(재배포 조건 미확인).

## 다음 단계 (각각 실행 전에 사용자 승인)
- 1~4단계는 완료(위 기록). DB 작업이 다시 필요하면 컨테이너가 아니라 사용자 PC에서 `scripts/windows/supabase-setup.ps1`로 실행한다
- 미검증: Transaction pooler(6543)로의 앱 조회는 Vercel 배포 후 확인
1. (완료) 환경 변수 확인(값 출력 금지): 존재 여부, 호스트, 포트 6543, 비밀번호 자리표시자 제거 여부
2. (완료, PC에서) 연결 확인: `SELECT version()` (SSL 필요, `DATABASE_SSL=require`)
3. (완료, PC에서) 마이그레이션: `DATABASE_URL="$SUPABASE_DATABASE_URL" DATABASE_SSL=require node --import tsx scripts/migrate.ts` → 0001~0004
4. (완료, PC에서 백업 복원) 데이터 이전: 로컬 DB가 있으면 `SOURCE_DATABASE_URL=<로컬> TARGET_DATABASE_URL="$SUPABASE_DATABASE_URL" scripts/copy-to-remote.sh`(건수 대조)
   - 새 컨테이너에는 로컬 DB 데이터가 없다. **1순위: 데이터 백업 파일 복원**(API 재호출 없음)
     - 파일: `jeju_data_20261024.dump`(pg_dump custom 형식, 데이터만, 487KB, 7개 테이블: 단지 1,153 / 거래 7,068 / 확정 매칭 6,920). 사용자에게 파일로 전달했고, 사용자가 본인 구글 드라이브에 업로드함. 새 세션에서는 사용자가 잠시 링크 공유를 켜면 `drive.usercontent.google.com`(허용 도메인 필요)에서 curl로 받고, 받은 뒤 공유를 해제한다(드라이브 MCP는 큰 파일을 받을 수 없음)
     - 복원: 마이그레이션한 빈 DB에 `pg_restore --data-only --no-owner --single-transaction -d "$SUPABASE_DATABASE_URL?sslmode=require" jeju_data_20261024.dump` (로컬에서 복원 시험 완료)
   - 2순위(백업이 없을 때): 원격에 직접 다시 적재한다: `npm run import:reference`(한국부동산원 JSON과 지적도 SHP는 사용자 파일, 구글 드라이브 `AL_D002_50_20261008.zip`) + `npm run collect -- --mode initial --max-calls 60`(실거래 API 호출이므로 **별도 승인 필요**) + `npm run match`
   - pg_dump/psql의 sslmode: 접속 문자열에 `?sslmode=require`를 붙여 사용
5. (완료, PC에서) 공개 Data API 차단 확인(anon key로 REST 조회 시 데이터가 안 보여야 함, 0004 RLS)
- **2026-10-24 Vercel 배포(진행 중)**: 팀 splendid(`splendid3`), 프로젝트 `jeju-realestate-mvp`(GitHub 연결, 프로덕션 브랜치 main). Vercel 인증 보호 `all_except_custom_domains`(로그인 필요), Node 22.x
  - 환경 변수(Production·Preview): `DATABASE_URL`(Sensitive, 6543), `DATABASE_SSL=require`, `VITE_KAKAO_MAP_JS_KEY`. **`CRON_SECRET`·`DATA_GO_KR_SERVICE_KEY`는 미등록**(Cron은 401로 끝나 실거래 API 미호출) — Cron 실행 승인 시 등록
  - 첫 배포가 프로젝트 첫 배포 규칙으로 Production이 됨(`dpl_7vzR1…`, ESM 결함이 있는 이전 커밋). Production Cron이 등록됐지만 위 이유로 외부 호출 없음
  - 결함 1: 확장자 없는 상대 import → Vercel 네이티브 ESM에서 `ERR_MODULE_NOT_FOUND`(모든 API 500). `6a690a8`에서 `.js` 확장자 추가 + `tests/esmImports.test.ts`
  - 결함 2: `DATABASE_SSL` 값이 대시보드 편집 중 빈 값이 됨 → ConfigError로 함수 중단. `require`로 복구. → `b343bbd`에서 설정 오류 시 함수 중단 대신 503(`DB_UNAVAILABLE`, Cron은 `COLLECTOR_MISCONFIGURED`) + 로그에 변수 이름만 남기도록 개선, Preview `dpl_Ao8Hy…`에서 정상 응답 회귀 확인
  - Preview `dpl_ETVA1…`에서 확인: data-status·검색·상세·거래 API 200(Supabase 6543 경유), 함수 리전 icn1, 보안 헤더 5종 + HSTS + `x-robots-tag: noindex`
  - 카카오 지도(사용자 브라우저, Preview 브랜치 도메인 등록 후): 실제 지도 표시, 클러스터 합계 1,090 = VERIFIED_PARCEL 단지 수(1,153 − 위치 미확인 63)와 일치. 마커 클릭 → 요약 카드 정상(거래 0건은 빈 결과 문구, 보증금/월세 분리, ㎡·평 환산)
  - 카카오 쿼터(PAW_MAP 공유): 월 3,000,000 / 이번 달 4,371 사용(0%). **한도 초과 시 차단·과금 여부와 비즈월렛 연결 여부는 미확인**
  - 컨테이너에서 `*.vercel.app`·`<ref>.supabase.co`는 네트워크 정책으로 차단 → 배포 점검은 Vercel MCP(`web_fetch_vercel_url`, 23시간 공유 링크 생성)로 함
6. **다음 차례** Vercel(Hobby): 프로젝트 생성·GitHub 연결, 환경변수(`DATABASE_URL`=Supabase pooler, `DATABASE_SSL=require`, `DATA_GO_KR_SERVICE_KEY`, `CRON_SECRET`, `VITE_KAKAO_MAP_JS_KEY`), 리전 icn1 허용 여부, Cron 1회 실행, 보안 헤더 확인
7. 카카오: PAW_MAP 앱 Web 플랫폼에 배포 도메인 등록, 실제 지도 확인, 쿼터 화면 확인
8. 배포 환경 성능 재측정(`API_BASE=<배포 URL> node scripts/perf.mjs`), 무료 운영 체크리스트·롤백 절차 문서화, 공개 여부는 사용자가 최종 결정
