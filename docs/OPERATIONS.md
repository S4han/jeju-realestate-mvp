# 운영 체크리스트·롤백 절차 (TASK-009)

작성: 2026-10-24. 표시 기준 — ✅ 실제로 확인함 · ⬜ 미확인(공개 전 확인 필요) · ⏸ 보류(사용자 결정).
"미확인"은 문서·추정으로 사실을 단정하지 않는다는 뜻이다. 확인하면 근거(날짜·화면·로그)와 함께 갱신한다.

## 1. 구성
| 구성 | 서비스·플랜 | 위치 |
|---|---|---|
| 웹·API·Cron | Vercel Hobby, 팀 `splendid3`, 프로젝트 `jeju-realestate-mvp` | 함수 리전 icn1(서울), Node 22.x |
| DB | Supabase Free, 프로젝트 `jeju-realestate` | ap-northeast-2(서울), Transaction pooler 6543 |
| 지도 | 카카오맵 JavaScript SDK, PAW_MAP 앱 키 공유 | 브라우저 |
| 실거래 원천 | data.go.kr 국토교통부 실거래가 API | Cron에서만 호출 |

빌드 생략(Ignored Build Step, 2026-10-24): `git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)tasks' ':(exclude)*.md'` — 문서(`docs/`, `tasks/`, `*.md`)만 바뀐 커밋은 빌드하지 않는다(종료 코드 0 = 생략). 계기: Production 브랜치 `main`에 문서만 있어 Phase 2 문서 커밋마다 Production 빌드가 실패(`npm ci`)하고 실패 메일이 옴. 실패 배포는 Production 주소를 바꾸지 않았음.

환경 변수(Vercel, Production·Preview): `DATABASE_URL`(Sensitive), `DATABASE_SSL=require`, `VITE_KAKAO_MAP_JS_KEY`, (Cron 승인 후) `CRON_SECRET`, `DATA_GO_KR_SERVICE_KEY`. 값은 저장소·로그·문서에 남기지 않는다.

## 2. 월 0원 체크리스트
| 항목 | 상태 | 근거·비고 |
|---|---|---|
| Vercel Hobby 사용(유료 플랜 아님) | ✅ | 관측 지표 조회가 "Pro 필요"(402)로 거부됨 |
| Vercel 한도 도달 시 동작(정지 vs 과금) | ⬜ | Hobby는 결제수단 없이 쓰는 플랜으로 알려져 있으나 이 계정에서 미확인. Usage 화면·약관으로 확인 |
| Vercel 런타임 로그 보존(검색어가 URL에 포함, FR-026) | ⬜ | Hobby 보존 기간 미확인 |
| Supabase Free, 유료 add-on(IPv4 등) 미사용 | ✅ | 사용자 결정, Shared pooler로 접속 |
| Supabase 결제수단 연결 여부·한도 초과 시 동작 | ⬜ | 조직 Billing 화면 확인 필요 |
| Supabase 7일 비활성 일시정지 | ⬜ | 일일 Cron이 DB를 쓰므로 방지될 것으로 보나 **Cron이 아직 동작하지 않음**. 공개 전 Cron 가동 또는 정지 시 복구 절차 확인 |
| 카카오 월 쿼터 여유 | ✅ | 월 3,000,000 중 4,371 사용(2026-10-24, PAW_MAP 합산) |
| 카카오 쿼터 초과 시 차단 vs 과금, 비즈월렛 연결 여부 | ⬜ | **공개 전 필수**. 브라우저 SDK라 서버에서 호출을 막을 수 없음 |
| data.go.kr 호출 예산 | ✅ | 실행당 30회·일 300회 상한, 도달 시 호출 전 중단(`collect.db.test.ts`) |
| 공개 Data API(Supabase REST) 차단 | ✅ | publishable 키 조회 → 401 `42501`(3개 테이블) |
| 배포 접근 보호 | ✅ | Vercel 인증 `all_except_custom_domains`, `x-robots-tag: noindex` |

## 3. 일상 점검 (공개 후, 주 1회 권장)
1. 화면 상단 "최신 데이터 기준" 시각이 하루 이내인지, 지연 배너가 없는지
2. Vercel → Logs: `error` 레벨 로그(설정 오류는 `Invalid server environment: <변수명>`으로 남음)
3. Vercel Cron 실행 기록, `sync_jobs` 최근 상태(`/api/system/data-status`)
4. Vercel·Supabase Usage, 카카오 쿼터 사용률

## 4. 장애·롤백 절차
### 4.1 배포 후 화면·API 이상
- 직전 정상 배포로 되돌린다: Vercel → Deployments → 정상 배포 `⋯` → **Promote to Production**(또는 Instant Rollback). 코드 되돌림은 그다음에 git으로 한다.
- API가 503 `DB_UNAVAILABLE`이면 먼저 Logs에서 `Invalid server environment` 여부를 본다. 있으면 환경 변수 값(앞뒤 공백·따옴표·빈 값)을 고치고 **재배포**(환경 변수는 새 배포부터 반영).

### 4.2 수집(Cron) 문제·외부 호출 즉시 중단
- `CRON_SECRET`을 지우거나 바꾸고 재배포 → Cron 요청이 401로 끝나 data.go.kr을 호출하지 않는다.
- 수집이 실패해도 화면은 마지막 정상 데이터와 지연 안내를 보여 준다(AT-015).

### 4.3 지도 장애·쿼터 소진
- 화면이 자동으로 목록 검색으로 전환된다(AT-016). 장기화되면 공개를 보류하거나 지도를 끈다(`VITE_KAKAO_MAP_JS_KEY` 제거 후 재배포 → 목록 모드).

### 4.4 DB 데이터 손상·초기화
- 백업 `jeju_data_20261024.dump`(486,829바이트, SHA-256 `ED66BAA8A9A15A7BEE387451FC88BC877FA65728FCE35824E1F377488451F1B7`, 사용자 구글 드라이브)로 복원한다.
- 클라우드 작업 환경은 DB에 직접 접속할 수 없으므로 사용자 PC에서 `scripts/windows/supabase-setup.ps1`(check → migrate → restore → verify)로 실행한다. restore는 빈 DB에서만 동작하므로, 기존 데이터를 비우는 단계는 사용자 승인 후 별도로 한다.
- 백업 이후 Cron으로 쌓인 데이터는 복원 후 다음 Cron(최근 4개월 재수집)과 매칭으로 다시 채워진다. 그보다 오래된 변경분은 수집 재실행이 필요하다(data.go.kr 호출 → 승인 필요).
- ⬜ Supabase Free 자체 백업 제공 범위는 미확인. 정기 백업(PC에서 `pg_dump`)을 운영 절차에 넣을지 결정 필요.

### 4.5 비밀값 노출 의심
| 대상 | 조치 |
|---|---|
| DB 비밀번호 | Supabase → Database → Reset password(영문·숫자만) → Vercel `DATABASE_URL` 수정 → 재배포 |
| data.go.kr 키 | 공공데이터포털에서 재발급 → Vercel `DATA_GO_KR_SERVICE_KEY` 수정 → 재배포 |
| `CRON_SECRET` | 새 임의값으로 교체 → 재배포 |
| 카카오 JS 키 | 공개 식별자. 허용 도메인 목록을 점검하고 불필요한 도메인 제거 |
| Vercel 공유 링크 | Deployment Protection에서 공유 링크 취소 |

## 5. 공개 전 남은 결정
- [ ] 위 ⬜ 항목(특히 카카오·Vercel·Supabase의 한도 초과 시 동작) 확인
- [ ] Cron 가동(별도 승인, data.go.kr 호출)
- [x] Production을 현재 브랜치 코드로 배포(2026-10-24, `5882caf`, `dpl_GHoGj…`). 접근 보호 유지(비공개). 주의: 프로덕션 브랜치 설정은 main이라 브랜치 push는 Preview로만 배포되고, Production 갱신은 수동 배포가 필요
- [x] 카카오 허용 도메인에 Production 도메인 `https://jeju-realestate-mvp.vercel.app` 추가(사용자, 2026-10-24) — 휴대폰에서 Production 지도 표시 확인(사용자). Production 응답에는 Vercel이 `noindex`를 붙이지 않지만 로그인 보호로 크롤링 불가
- [ ] 접근 보호 해제 여부(공개 범위) — 사용자 최종 결정
- [ ] 배포 환경 성능: **목표 미달로 측정됨, 원인 분석 중**(아래 6절)

## 6. 배포 환경 성능 측정 기록
2026-10-24, 사용자 PC(한국, Windows PowerShell 5.1 `Invoke-WebRequest`, 순차 30회) → Vercel Preview(icn1, Node 24 시점 배포) → Supabase 서울. 오류 0.
| API | 첫 요청 | p50 | p95 | 최대 | 목표 p95 |
|---|---|---|---|---|---|
| 검색 | 1,081ms | 877ms | 1,142ms | 1,155ms | 500ms |
| 지도 | 945ms | 905ms | 1,090ms | 1,909ms | 800ms |
| 상세 | 1,079ms | 951ms | 1,486ms | 3,886ms | 800ms |

- 첫 요청과 이후 요청이 비슷하게 약 0.9초라 요청마다 고정 지연이 붙는 형태다. 로컬 서버 처리 시간(p95 7~22ms)과 차이가 커서 측정 도구·네트워크·보호 계층·함수/DB 중 어디서 생기는지 분리 측정 중이다. 원인 확정 전까지 결과를 서버 성능으로 단정하지 않는다.
