# TASK-009 진행 메모 (세션 인계용)

새 세션에서 이 문서와 docs/ACCEPTANCE_RESULTS.md, tasks/TASK-009.md를 먼저 읽는다. 모든 외부 실행 전에 사용자 승인을 받는다(CLAUDE.md).

## 현재 상태 (2026-10-24)
- TASK-001~008 완료(사용자 승인). TASK-009 승인됨, 단계별 승인 진행 중
- 사용자 결정: 완전 비상업 / 신축 단지는 보류(A안) / 지도는 PAW_MAP 앱 키 공유(비즈월렛 미연결) / Vercel Hobby + Supabase Free
- Supabase: 사용자가 **서울(ap-northeast-2)** 프로젝트를 생성함(뭄바이 프로젝트는 리전 문제로 다시 만듦). 무료 유료 추가 기능인 IPv4 add-on은 사용하지 않음
  - 접속: Shared pooler, transaction mode, `aws-0-ap-northeast-2.pooler.supabase.com:6543`
  - 사용자가 환경 변수 `SUPABASE_DATABASE_URL`(비밀번호 포함)을 등록하고, 허용 도메인에 pooler 호스트를 추가함
  - 로컬 개발 DB(`DATABASE_URL`, .env)와 섞이지 않도록 이름을 따로 씀

## 다음 단계 (각각 실행 전에 사용자 승인)
1. 환경 변수 확인(값 출력 금지): 존재 여부, 호스트, 포트 6543, 비밀번호 자리표시자 제거 여부
2. 연결 확인: `SELECT version()` (SSL 필요, `DATABASE_SSL=require`)
3. 마이그레이션: `DATABASE_URL="$SUPABASE_DATABASE_URL" DATABASE_SSL=require node --import tsx scripts/migrate.ts` → 0001~0004
4. 데이터 이전: 로컬 DB가 있으면 `SOURCE_DATABASE_URL=<로컬> TARGET_DATABASE_URL="$SUPABASE_DATABASE_URL" scripts/copy-to-remote.sh`(건수 대조)
   - 새 컨테이너에는 로컬 DB 데이터가 없다. **1순위: 데이터 백업 파일 복원**(API 재호출 없음)
     - 파일: `jeju_data_20261024.dump`(pg_dump custom 형식, 데이터만, 487KB, 7개 테이블: 단지 1,153 / 거래 7,068 / 확정 매칭 6,920). 사용자 승인 시 사용자 구글 드라이브에 업로드
     - 복원: 마이그레이션한 빈 DB에 `pg_restore --data-only --no-owner --single-transaction -d "$SUPABASE_DATABASE_URL?sslmode=require" jeju_data_20261024.dump` (로컬에서 복원 시험 완료)
   - 2순위(백업이 없을 때): 원격에 직접 다시 적재한다: `npm run import:reference`(한국부동산원 JSON과 지적도 SHP는 사용자 파일, 구글 드라이브 `AL_D002_50_20261008.zip`) + `npm run collect -- --mode initial --max-calls 60`(실거래 API 호출이므로 **별도 승인 필요**) + `npm run match`
   - pg_dump/psql의 sslmode: 접속 문자열에 `?sslmode=require`를 붙여 사용
5. 공개 Data API 차단 확인(anon key로 REST 조회 시 데이터가 안 보여야 함, 0004 RLS)
6. Vercel(Hobby): 프로젝트 생성·GitHub 연결, 환경변수(`DATABASE_URL`=Supabase pooler, `DATABASE_SSL=require`, `DATA_GO_KR_SERVICE_KEY`, `CRON_SECRET`, `VITE_KAKAO_MAP_JS_KEY`), 리전 icn1 허용 여부, Cron 1회 실행, 보안 헤더 확인
7. 카카오: PAW_MAP 앱 Web 플랫폼에 배포 도메인 등록, 실제 지도 확인, 쿼터 화면 확인
8. 배포 환경 성능 재측정(`API_BASE=<배포 URL> node scripts/perf.mjs`), 무료 운영 체크리스트·롤백 절차 문서화, 공개 여부는 사용자가 최종 결정
