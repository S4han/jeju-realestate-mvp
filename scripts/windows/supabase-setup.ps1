# 제주 부동산 MVP - Supabase 초기 적재 (Windows PowerShell 5.1 / 7)
# 클라우드 작업 환경은 DB(raw TCP)에 직접 접속할 수 없어 사용자 PC에서 실행한다. 절차: docs/TASK-009_HANDOFF.md
# 단계별로 한 번에 하나씩 실행한다:  check -> migrate -> restore -> verify
#   powershell -ExecutionPolicy Bypass -File .\supabase-setup.ps1 -Step check
# 비밀번호는 실행할 때 가려진 입력으로 받고, 파일·명령 기록·출력에 남기지 않는다.
param(
  [Parameter(Mandatory = $true)][ValidateSet('check', 'migrate', 'restore', 'verify')][string]$Step,
  [string]$DumpPath,
  [string]$DbUser,  # postgres.<프로젝트 ref> (대시보드 Connect 화면). 비우면 실행 시 묻는다
  [string]$DbHost = 'aws-0-ap-northeast-2.pooler.supabase.com',
  [int]$Port = 5432  # Session pooler. 막히면 -Port 6543 (Transaction pooler)
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$migrationsDir = Join-Path $here '..\..\db\migrations'
$ExpectedDumpBytes = 486829

# PostgreSQL 클라이언트(psql, pg_restore) 찾기: PATH 우선, 없으면 기본 설치 폴더
$psql = (Get-Command psql.exe -ErrorAction SilentlyContinue).Source
if (-not $psql) {
  $psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $psql) { throw 'psql.exe를 찾지 못했습니다. PostgreSQL 17 Command Line Tools를 설치하세요.' }
$pgRestore = Join-Path (Split-Path $psql) 'pg_restore.exe'

function Invoke-Psql([string[]]$PsqlArgs) {
  & $psql -X -v ON_ERROR_STOP=1 @PsqlArgs
  if ($LASTEXITCODE -ne 0) { throw "psql 실패 (exit $LASTEXITCODE)" }
}
function Get-Scalar([string]$Sql) {
  $out = & $psql -X -A -t -v ON_ERROR_STOP=1 -c $Sql
  if ($LASTEXITCODE -ne 0) { throw "psql 실패 (exit $LASTEXITCODE)" }
  return ($out | Out-String).Trim()
}

if (-not $DbUser) { $DbUser = Read-Host 'DB 사용자 (postgres.<프로젝트 ref>)' }
$env:PGHOST = $DbHost
$env:PGPORT = "$Port"
$env:PGUSER = $DbUser
$env:PGDATABASE = 'postgres'
$env:PGSSLMODE = 'require'
$env:PGCLIENTENCODING = 'UTF8'
$env:PGCONNECT_TIMEOUT = '15'
$secure = Read-Host 'Supabase DB 비밀번호 (화면에 표시되지 않음)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

try {
  Write-Host "== $Step | ${DbHost}:$Port | client: $(& $psql --version)"
  switch ($Step) {
    'check' {
      Invoke-Psql @('-A', '-t', '-c', 'SELECT version();',
        '-c', "SELECT 'ssl=' || ssl || ' ' || version FROM pg_stat_ssl WHERE pid = pg_backend_pid();",
        '-c', "SELECT 'schema_migrations exists=' || (to_regclass('public.schema_migrations') IS NOT NULL);",
        '-c', "SELECT 'apartments exists=' || (to_regclass('public.apartments') IS NOT NULL);")
      Write-Host "pg_restore: $(& $pgRestore --version)"
    }
    'migrate' {
      Invoke-Psql @('-q', '-c', 'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
      $done = (Get-Scalar 'SELECT name FROM schema_migrations') -split "`r?`n" | Where-Object { $_ }
      foreach ($f in Get-ChildItem $migrationsDir -Filter '*.sql' | Sort-Object Name) {
        if ($done -contains $f.Name) { Write-Host "skip    $($f.Name) (이미 적용)"; continue }
        # 파일과 기록 INSERT를 한 트랜잭션(-1)으로 실행: 실패하면 둘 다 취소된다
        Invoke-Psql @('-q', '-1', '-f', $f.FullName, '-c', "INSERT INTO schema_migrations (name) VALUES ('$($f.Name)')")
        Write-Host "applied $($f.Name)"
      }
      Write-Host "schema_migrations: $(Get-Scalar 'SELECT count(*) FROM schema_migrations') rows"
    }
    'restore' {
      if (-not $DumpPath -or -not (Test-Path $DumpPath)) { throw '-DumpPath 로 jeju_data_20261024.dump 경로를 지정하세요.' }
      $size = (Get-Item $DumpPath).Length
      Write-Host "dump size: $size bytes (expected $ExpectedDumpBytes)"
      if ($size -ne $ExpectedDumpBytes) { throw '덤프 파일 크기가 다릅니다. 다시 내려받으세요.' }
      Write-Host "dump sha256: $((Get-FileHash $DumpPath -Algorithm SHA256).Hash)"
      $migrations = Get-Scalar 'SELECT count(*) FROM schema_migrations'
      if ($migrations -ne '4') { throw "마이그레이션이 4개가 아닙니다 ($migrations). migrate 단계를 먼저 실행하세요." }
      $existing = Get-Scalar 'SELECT count(*) FROM apartments'
      if ($existing -ne '0') { throw "대상 DB가 비어 있지 않습니다 (apartments=$existing). 중단합니다." }
      & $pgRestore --data-only --no-owner --no-privileges --single-transaction --exit-on-error -d postgres $DumpPath
      if ($LASTEXITCODE -ne 0) { throw "pg_restore 실패 (exit $LASTEXITCODE). 한 트랜잭션이라 아무것도 반영되지 않았습니다." }
      Write-Host 'restore done. 이어서 -Step verify 를 실행하세요.'
    }
    'verify' {
      Invoke-Psql @('-f', (Join-Path $here 'supabase-verify.sql'))
    }
  }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
