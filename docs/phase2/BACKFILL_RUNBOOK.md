# 과거 매매 수집 실행 절차 (P2-TASK-001 D1: 범위 b·실행 E1)

대상: 2023-11 ~ 2025-10 **매매만**(제주시·서귀포시), data.go.kr 호출 약 48회(상한 60). 사용자 PC에서 1회 실행.
Phase 1 수집 코드를 그대로 재사용하고(정규화·해제 처리·sync_jobs·호출 예산), 전월세는 받지 않는다. Phase 1 화면은 최근 12개월만 보여 주므로 과거 거래가 들어와도 변하지 않는다.

## 준비 (1회)
1. Node.js **22 이상**(LTS) 설치: https://nodejs.org (설치 후 새 PowerShell 창). Node 24에서 `npm ci`의 engines 경고(EBADENGINE)는 무시해도 됨
2. PostgreSQL 클라이언트(psql·pg_dump): Phase 1 키트 때 설치한 것 사용
3. 저장소 받기(둘 중 하나)
   - Git이 있으면: `git clone -b claude/phase2-price-analysis https://github.com/S4han/jeju-realestate-mvp.git C:\jeju_repo`
   - 없으면: GitHub에서 `claude/phase2-price-analysis` 브랜치 → Code → Download ZIP → `C:\jeju_repo`에 풀기
4. 의존성 설치: `cd C:\jeju_repo` → `npm ci`

## 실행 (단계마다 결과 확인 후 다음 단계)
모든 명령은 `C:\jeju_repo`에서 `powershell -ExecutionPolicy Bypass -File .\scripts\phase2\windows\backfill.ps1 -Step <단계>`
| 단계 | 하는 일 | 외부 영향 |
|---|---|---|
| `check` | Node 22·psql·pg_dump 확인, DB 읽기 전용 연결 확인 | DB 읽기 |
| `backup` | 운영 DB 데이터 전체 백업(`backup_before_backfill_*.dump`, 크기·SHA-256 출력) | DB 읽기, PC에 파일 생성 |
| `dryrun` | 수집 대상 월·예상 호출 수만 출력 | 없음 |
| `collect` | 백업 파일 존재 확인 → `COLLECT` 입력 확인 → 서비스 키 입력 → 수집 | **data.go.kr 호출(≤60)·운영 DB 쓰기** |
| `match` | 매칭 전체 재계산(Phase 1 `scripts/match-transactions.ts`) | 운영 DB 쓰기(네트워크 없음) |
| `verify` | `scripts/phase2/backfill-verify.sql`(읽기 전용): 월×시 수집 상태, 월별 건수·해제·확정, 기간별 매칭률, 용량 | DB 읽기 |

- DB 비밀번호·서비스 키는 가려서 입력받고, 실행 프로세스의 환경 변수로만 쓰고 끝나면 지운다. 파일에 저장하지 않는다.
- 호출 상한 도달이나 실패로 일부 월이 빠지면 `-From <빠진 첫 월>`로 다시 실행(이미 받은 월은 재수집해도 중복 저장되지 않음).
- 백업 파일은 공개 저장소에 커밋하지 않는다(`.gitignore`의 `*.dump`).

## 기대 결과(verify)
- 1번: 50110·50130 각각 months 24, success 24
- 2번: 2023-11 ~ 2025-10 월별 건수(월 100~200건 수준), 해제 일부
- 3번: 과거 구간 확정 매칭률(표본 호출 기준 단지 코드 87.5%가 기존 매칭에 존재 → 80%대 이상 예상, 실측으로 확인)

## 되돌리기(문제 발생 시, 실행 전 별도 승인)
과거 구간만 지우고 매칭을 다시 계산한다. 최근 12개월(Phase 1) 데이터는 건드리지 않는다.
```sql
BEGIN;
DELETE FROM transactions WHERE trade_type = 'sale' AND contract_date >= '2023-11-01' AND contract_date < '2025-11-01';
DELETE FROM sync_jobs WHERE source_id = 'MOLIT_SALE' AND period BETWEEN '202311' AND '202510';
COMMIT;
```
그다음 `-Step match`. 전체 복구가 필요하면 `backup_before_backfill_*.dump`를 Phase 1 키트(`scripts/windows/supabase-setup.ps1`) 방식으로 빈 DB에 복원.
