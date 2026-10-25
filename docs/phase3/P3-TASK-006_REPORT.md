# P3-TASK-006 모바일 지역 지도·상세·비교 화면

작성 2026-10-25. **배포·플래그 ON·운영 DB 변경 없음.** 로컬 개발 서버 + 로컬 DB(실제 지역 세트 74 + 합성 거래를 실제 읍면동에 분산한 복제본)에서 검증.

## 1. 구현 (신규 `src/phase3/`, 예외 `src/App.tsx`)
| 화면 | 내용 |
|---|---|
| 진입(P3-SCR-001) | 대시보드 상단 "읍면동별 시세·거래량 지도 → 지역 분석" 링크와 `#/regions` 경로 — **v3 status 200일 때만** 존재(플래그 OFF면 링크 없음, 주소로 들어와도 대시보드) |
| 지도(001/002) | 카카오 폴리곤. 처음엔 시 2곳(읍면동 폴리곤을 소속 시 등급으로 색칠) → 시 선택 시 그 시 읍면동만. 선택 지역은 굵은 테두리. 추자도는 그리되 화면 맞춤에서 제외 |
| 필터 | 기간 12/24/36(기본 24), 지표 ㎡당 중위가격/거래량, 단계 이동(제주 전체 › 시) |
| 범례 | 단계별 실제 최소~최대·지역 수, "표본 부족·미확인"(점선·회색), "아파트 없음"(점선·연회색), 분류 방법·대상 지역 수·재분류 안내 |
| 지역 표(006, 지도 대체) | 항상 표시: 색 견본 + 값 텍스트 + 거래 건수 + 변화율, 행을 눌러 선택·이동. 지도 실패 시 지도 대신 안내 + 표 |
| 상세 카드(003) | ㎡당 중위가격(+평당), 거래 건수(누락 시 미확인), 1년 전 대비(표본 조건 문구), 데이터 상태·이번 달 잠정, 월별 거래량 막대(누락 빗금·이번 달 흐림) |
| 거래 단지(004) | 최근 계약일 순, 10개씩 더 보기, Phase 1 상세 링크, Phase 2 켜져 있으면 "가격 분석 탭" 안내 |
| 비교(005) | "비교에 추가" 2곳 → 같은 스냅샷 표(㎡당 중위가격·거래·변화율) |
| 상태 안내 | 48시간 지연, 수집 누락 월, 단지 미확정 거래 제외 건수, 기간·출처·데이터 버전 |
- 일관성: 지도 통계의 `snapshotId`를 상세·단지·비교 요청에 전달 → 409면 선택을 지우고 지도부터 다시 불러옴.
- 색: 단일 색상 파랑 5단계(`#86b6ef #5598e7 #2a78d6 #1c5cab #0d366b`), dataviz 검증 스크립트 `--ordinal` 통과(밝기 단조, 단계 간격, 밝은 끝 2.06:1). 등급이 적으면 간격을 벌려 선택. 색 외에 값 텍스트·점선·문구 제공.

## 2. Phase 1 파일 diff (P3-D3 승인 예외: `src/App.tsx`, +12줄)
```diff
@@ -7,6 +7,8 @@ import { SearchBox } from "./components/SearchBox";
 import { SummaryCard } from "./components/SummaryCard";
 import { TransactionsPage } from "./components/TransactionsPage";
 import { describeStatus, fetchDataStatus, type DataStatusState } from "./dataStatus";
+import { isRegionAnalysisAvailable } from "./phase3/api";
+import { RegionAnalysis } from "./phase3/RegionAnalysis";
 
 const KAKAO_KEY = import.meta.env.VITE_KAKAO_MAP_JS_KEY as string | undefined;
 
@@ -30,6 +32,8 @@ export default function App() {
   const [mapFailed, setMapFailed] = useState(false);
   const [selected, setSelected] = useState<string | null>(null);
   const [focus, setFocus] = useState<{ lat: number; lng: number; seq: number } | null>(null);
+  // Phase 3 (P3-D3): region analysis is reachable only when its status API answers 200 (feature flag on).
+  const [regionsOn, setRegionsOn] = useState(false);
   const hash = useHash();
   const detailId = /^#\/apartments\/(\d+)$/.exec(hash)?.[1];
   // Views live in the URL hash so each one can be linked: #/ dashboard (first screen), #/map, #/list.
@@ -38,6 +42,7 @@ export default function App() {
 
   useEffect(() => {
     void fetchDataStatus().then(setStatus);
+    void isRegionAnalysisAvailable().then(setRegionsOn);
   }, []);
 
   const onUnavailable = useCallback(() => setMapFailed(true), []);
@@ -49,6 +54,7 @@ export default function App() {
 
   // key: filters and pages reset when moving to another apartment.
   if (detailId) return <TransactionsPage key={detailId} id={detailId} />;
+  if (regionsOn && hash === "#/regions") return <RegionAnalysis appKey={KAKAO_KEY} />;
 
   return (
     <div className="flex h-dvh flex-col bg-slate-50 text-slate-900">
@@ -96,6 +102,14 @@ export default function App() {
       <main className="relative min-h-0 flex-1">
         {mode === "dashboard" ? (
           <div className="h-full overflow-auto">
+            {regionsOn && (
+              <div className="px-4 pt-3">
+                <a href="#/regions" className="mx-auto flex max-w-2xl items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
+                  <span>읍면동별 시세·거래량 지도</span>
+                  <span aria-hidden="true">지역 분석 →</span>
+                </a>
+              </div>
+            )}
             <Dashboard />
           </div>
         ) : mode === "map" ? (
```

## 3. 테스트
- 단위·DB: **24 파일, 190/190 통과**, `tsc`·빌드·번들 비밀 노출 검사 통과.
- Phase 3 E2E `tests/e2e/phase3.e2e.mjs`(390px, 가짜 카카오 SDK `tests/e2e/fake-kakao-sdk-p3.js`): **21/21 통과**
  - OFF: 진입 링크 없음, `#/regions`도 대시보드, `/api/v3` 요청은 status 확인뿐(TC-039), 오류 없음
  - ON: 진입 → 시 지도(폴리곤 140조각=섬 포함 74 읍면동) → 시 표 2행 → 제주시 47행·제주시 폴리곤만 → 범례(범위·표본 부족·아파트 없음) → 지역 선택 → 상세·단지 링크·선택 테두리 → 두 지역 비교 → 거래량 지표 범례 "건" → 12개월 기간 반영 → 서귀포시 아파트 없음 점선·문구 → 가로 넘침 없음(TC-001~003, 009, 010, 036)
  - 지도 키 없음: 지도 대신 안내 + 표(TC-038)
- Phase 2 E2E 회귀(가격 분석 탭): **17/17 통과**(App.tsx 변경 영향 없음).
- 지도 형상 확인: 테스트용 가짜 SDK는 폴리곤을 그리지 않으므로, 같은 경계·등급·색으로 SVG 미리보기를 별도로 그려 확인(제주시 북부·추자도·우도, 서귀포시 남부, 등급 색 단계 정상).

## 4. 미검증
- **실제 카카오 지도 위 폴리곤 렌더링·성능(모바일)**: 이 작업 환경에서 카카오 SDK를 불러올 수 없음 → Preview 플래그 ON 후 휴대폰 확인 필요. Phase 3 Preview 도메인은 카카오에 미등록.
- 실데이터 화면(운영 적재 전). 스크린리더 실기기 확인.

## 5. 운영 DB 적재 (2026-10-25, 사용자 PC `regions.ps1`, 승인 후)
- migrate(0005 적용) → load(세트 1 VERIFIED) → activate(세트 1 ACTIVE, 2026-10-25 11:48:54Z).
- status: 세트 1 ACTIVE(코드 2026-06-30, 경계 2026-10-01, 20m), 시 2·읍면동 74, 경계 74·정점 12,311·면적 1,848.1㎢, 테이블 240kB — 로컬 리허설과 동일.
- 기능 플래그는 Production·Preview 모두 OFF 상태(사용자 화면 변화 없음). 되돌리기: `regions.ps1 -Step rollback`.
- 2026-10-25 Phase 3 브랜치 Preview 전용 환경 변수 추가(승인): `PHASE3_REGION_ANALYSIS_ENABLED=true`, `P3_CURSOR_SECRET`(sensitive, 44자) — Git 브랜치 `claude/phase3-region-analysis` 한정. Production 미설정(OFF).
- Preview 재배포 `dpl_2hQdBBKF…`(e18f058) READY, 실데이터 확인: 제주시 읍면동 통계 200 — 노형동 527건·연동 503건·외도일동 259건, 가격 표시 가능 29곳(P3-TASK-001 실측 29와 일치), 5분위 5단계(226만~725만원/㎡), 미매칭 124건(실측 124와 일치), 아파트 없음·거래 없음·표본 부족 구분, Brotli 압축 전송 확인.
- 2026-10-25 카카오 앱(Pat-Map) Web 도메인에 Phase 3 Preview 주소 추가(사용자). **사용자 휴대폰 확인 완료: Phase 3 Preview에서 실제 카카오 지도 위 지역 지도 정상 표시**(4절 미검증 항목 중 "실제 카카오 지도 렌더링" 해소).
