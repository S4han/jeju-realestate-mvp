# P3-TASK-008 비용·장애·복구·출시 승인 패키지 (Phase 3)

작성 2026-10-25. ✅ 확인 · ⬜ 미확인 · ⚠ 주의. **2026-10-25 사용자 A안 승인 → Production 공개 완료(8절).**

## 1. 비용 (월 0원)
| 항목 | 상태 | 근거 |
|---|---|---|
| 외부 유료 API·새 Cron | ✅ 없음 | v3는 DB 읽기만. 코드·경계는 1회 수동 적재(공공 무료 파일), 앱 실행 중 외부 호출 0 |
| Vercel 함수 수 | ✅ 10/12 | v3 단일 함수 1개 추가(P3-D4) |
| DB 용량 | ✅ +약 240kB | p3 테이블 3개(경계 240kB), Supabase Free 500MB 중 전체 약 25MB |
| DB 부하 | ✅ | 읽기 전용 트랜잭션 + 2초 타임아웃, 로컬 p95 26~176ms |
| CDN 캐시·압축 | ✅ | Preview 같은 URL 두 번째 요청 `x-vercel-cache: HIT`, 응답 Brotli(`content-encoding: br`), 경계 원본 273KB |
| Vercel 청구 | ✅ | Hobby(초과 과금 경로 없음, Phase 2 G5 계정 화면), 청구 API "costs_not_found"(2026-09-25~10-25) |
| Supabase | ✅ | Free + 지출 한도 활성(Phase 2 G5 계정 화면) |
| 카카오맵 | ✅(부분) | 무료 쿼터·사용 0%(Phase 2 G5). 지역 지도는 기존 지도 SDK 로드 1회 + 폴리곤(추가 API 호출 아님). ⬜ 초과 시 동작 문구 |
| 경계·코드 원천 | ✅ | 공공데이터포털 "이용허락범위 제한 없음". ⬜ 브이월드 이용조건 화면 캡처 미수령 |

## 2. 장애·Fail-Closed (증거)
| 상황 | 동작 | 근거 |
|---|---|---|
| 플래그 OFF/미설정 | v3 모든 view 404(DB 접근 전), 진입 링크·`#/regions` 없음 | api.test, E2E OFF, Preview 실측(3절) |
| 활성 지역 세트 없음 | 503 NO_VERIFIED_SNAPSHOT | api.test |
| 경계·코드 불일치 | 세트 REJECTED, 활성화 불가, 기존 세트 계속 제공 | TC-008·034 |
| 수집 실패 월 | 그 시 통계 "미확인"(0건 위장 없음), 다른 시 영향 없음 | TC-013·020 |
| 48시간 미갱신 | STALE 경고 + 마지막 정상 데이터 | statistics.db.test, 화면 안내 |
| 버전 혼합 | 409 SNAPSHOT_MISMATCH → 화면이 선택 초기화 후 재조회 | TC-033·035, UI |
| 지도 SDK 실패 | 안내 + 지역 표로 대체 | E2E(지도 키 없음) |
| DB 장애·타임아웃 | 503 일반 메시지(내부 정보 없음), Phase 1 정상 | api.test, TC-040 |
| 커서 비밀값 없음 | 단지 목록만 503, 나머지 정상 | api.test |
| Phase 3 코드의 DB 쓰기 | 읽기 전용 트랜잭션이 거부 | withSnapshot(Phase 2 TC-026 동일 경로) |

## 3. 플래그 OFF/ON 복구 (Phase 3 Preview, 2026-10-25 실측)
1. `PHASE3_REGION_ANALYSIS_ENABLED=false` → 재배포 `dpl_Bwk86o69…`: `/api/v3/regions/statistics` **404**, Phase 1 대시보드 API **200**.
2. `true` 복구 → 재배포 `dpl_A5jcJy6D…`: `/api/v3/regions/status` **200**, snapshotId `1-3659bf993805d395`(OFF 전과 동일).
3. 소요: 환경 변수 변경 + 재배포 약 1분, 코드·DB 변경 없음.
- 지역 세트 롤백: 새 세트가 검증 실패면 REJECTED로 남고 활성 세트 유지(TC-008·034). 테이블 전체 제거는 `regions.ps1 -Step rollback`(로컬 검증, Phase 1·2 데이터 불변).

## 4. 출시(공개) 절차 — **사용자 수동 승인 필요, 아직 수행 안 함**
현재: Production(`jeju-realestate-mvp.vercel.app`)은 Phase 2까지(`dpl_HJojQPWE…`, d203298). 운영 DB에는 Phase 3 지역 세트 1이 이미 ACTIVE(플래그 OFF라 미노출). 카카오 Production 도메인 등록됨.
1. `claude/phase3-region-analysis`를 Production 브랜치 `claude/jeju-realestate-mvp-analysis-6suje9`에 병합(fast-forward 가능 여부 확인).
2. **플래그 OFF로** Production 배포 — 마지막 **코드** 커밋 기준(문서만 바뀐 커밋은 Ignored Build Step으로 취소되므로). 회귀 확인: 대시보드·지도·검색·상세·Phase 2 가격 분석 탭 200, v3 404, 대시보드에 지역 분석 링크 없음.
3. Production 환경 변수: 새 `P3_CURSOR_SECRET`(Preview와 다른 값, sensitive), `PHASE3_REGION_ANALYSIS_ENABLED=true` → 재배포 → 실데이터 확인(status·statistics·detail·apartments).
4. 휴대폰에서 Production 확인.
5. 문제 시: 플래그 `false` + 재배포(약 1분). 전체 롤백: `dpl_HJojQPWE…`(d203298, Phase 3 이전).

## 5. 공개 전 검토 권장 사항
- ⚠ 지역 단위 ㎡당 중위값의 1년 전 대비 변화율은 단지·면적 구성에 따라 크게 움직일 수 있음(예: 표선면 +91.8%, 동홍동 −21.3%, 이도이동 +62.6%). 계산은 대사 일치. 화면에 "단지 구성 변화에 따라 크게 달라질 수 있음" 안내 추가를 권장(작은 문구 변경).
- Preview·Production 커서 비밀값은 작업 기록에 노출되지 않은 새 값으로 교체 권장(대시보드에서 직접 설정 시 가장 안전).
- 요청량 제한(429) 미제공 — 비공개(Vercel 인증 보호) 운영 중에는 위험 낮음, 공개 범위 확대 시 재검토.
- 수동 수집 의존: 이틀 넘게 PC 수집을 안 하면 Phase 2·3 모두 지연 경고.

## 6. 잔여 미검증
- Preview/Production 응답 시간 실측(인증 보호로 이 환경에서 측정 불가), 스크린리더 실기기, 브이월드 이용조건 화면, 카카오 쿼터 초과 동작.

## 7. 사용자 승인 기록
- 2026-10-25: P3-D1~D5, 운영 DB 조회·적재, Phase 3 Preview 전용 플래그, 카카오 Preview 도메인, Preview 실기기 지도 확인.
- 2026-10-25: Production 공개 A안 승인(변화율 안내 문구 추가 후 공개).

## 8. Production 공개 결과 (2026-10-25)
- 변화율 안내 문구 추가(117381d): 상세 카드 보조 문구 + 하단 안내. 전체 230/230, Phase 3 E2E 22/22(안내 문구 확인 1건 추가).
- Production 브랜치 fast-forward → 117381d.
- 1차 배포(플래그 OFF) `dpl_5vPPtxio…`: data-status·top-apartments·search·apartments/684·v2 status 200, v3 status 404.
- Production 환경 변수 추가: `P3_CURSOR_SECRET`(sensitive, Preview와 다른 값), `PHASE3_REGION_ANALYSIS_ENABLED=true`.
- 2차 배포(플래그 ON, redeploy) `dpl_AhZS2nsL…`:
  - status 200, snapshotId `1-3659bf993805d395`(Preview·대사와 동일), 데이터 FRESH·COMPLETE.
  - statistics(시): 제주시 2,962건·4,335,501원/㎡, 서귀포시 1,122건·3,867,879원/㎡, 미매칭 124/7 — 운영 대사(P3-TASK-007 4절)와 일치.
  - list 2시·74 읍면동, detail(표선면) 17건·24개월 월별, apartments(연동) 200 + 서명 커서 발급.
- 롤백: 플래그 `false` + 재배포, 또는 `dpl_HJojQPWE…`(d203298) 승격.
- ✅ 휴대폰 화면 확인(사용자, 2026-10-25) → Phase 3 완료(`PHASE3_COMPLETION.md`). ⚠ Production 커서 비밀값도 MCP 호출로 설정되어 작업 기록에 1회 나타남 → 대시보드에서 새 값으로 교체 권장(교체 후 재배포, 기존 커서만 무효화되고 데이터 영향 없음).
