# Phase 2 과거 매매 수집(P2-TASK-001 D1, 범위 b·실행 E1) — 사용자 PC에서 단계별로 실행
#   check → backup → dryrun → collect → match → verify
#   powershell -ExecutionPolicy Bypass -File .\scripts\phase2\windows\backfill.ps1 -Step check
# 비밀번호·서비스 키는 가려서 입력받아 이 프로세스의 환경 변수로만 쓰고 끝나면 지운다(파일 저장 없음).
param(
  [Parameter(Mandatory = $true)][ValidateSet('check', 'backup', 'dryrun', 'collect', 'match', 'verify')][string]$Step,
  [string]$From = '202311',
  [string]$To = '202510',
  [int]$MaxCalls = 60,
  [string]$DbUser,  # postgres.<프로젝트 ref>. 비우면 묻는다
  [string]$DbHost = 'aws-0-ap-northeast-2.pooler.supabase.com',
  [int]$Port = 5432  # Session pooler
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\..\..')
Set-Location $repo

function Find-PgTool([string]$name) {
  $p = (Get-Command "$name.exe" -ErrorAction SilentlyContinue).Source
  if (-not $p) {
    $p = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$name.exe" -ErrorAction SilentlyContinue |
      Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $p) { throw "$name.exe 를 찾지 못했습니다(PostgreSQL Command Line Tools 필요)." }
  return $p
}
function Read-Secret([string]$prompt) {
  $sec = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Assert-Node {
  $v = (& node -v 2>$null)
  if (-not $v -or -not $v.StartsWith('v22.')) { throw "Node.js 22가 필요합니다(현재: $v). https://nodejs.org 에서 22 LTS 설치 후 새 PowerShell에서 다시 실행하세요." }
  if (-not (Test-Path (Join-Path $repo 'node_modules\tsx'))) { throw "의존성이 없습니다. 저장소 폴더에서 'npm ci' 를 먼저 실행하세요." }
  return $v
}
function Invoke-Node([string[]]$NodeArgs) {
  & node --import tsx @NodeArgs
  if ($LASTEXITCODE -ne 0) { throw "실패 (exit $LASTEXITCODE)" }
}

$needsDb = $Step -ne 'dryrun'
try {
  Write-Host "== $Step | 저장소 $repo"
  if ($needsDb) {
    if (-not $DbUser) { $DbUser = Read-Host 'DB 사용자 (postgres.<프로젝트 ref>)' }
    $pw = Read-Secret 'Supabase DB 비밀번호 (화면에 표시되지 않음)'
    $env:PGHOST = $DbHost; $env:PGPORT = "$Port"; $env:PGUSER = $DbUser; $env:PGDATABASE = 'postgres'
    $env:PGSSLMODE = 'require'; $env:PGCLIENTENCODING = 'UTF8'; $env:PGPASSWORD = $pw
    # 접속 문자열은 실행 중 메모리에서만 조립한다(비밀번호는 URL 인코딩).
    $scheme = 'postgresql' + '://'
    $env:DATABASE_URL = $scheme + [Uri]::EscapeDataString($DbUser) + ':' + [Uri]::EscapeDataString($pw) + '@' + "${DbHost}:$Port/postgres"
    $env:DATABASE_SSL = 'require'
    $pw = $null
  }
  switch ($Step) {
    'check' {
      Write-Host "node $(Assert-Node)"
      $psql = Find-PgTool 'psql'; Write-Host "psql: $(& $psql --version)"; Write-Host "pg_dump: $(& (Find-PgTool 'pg_dump') --version)"
      & $psql -X -w -A -t -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only = on" `
        -c "SELECT 'sale rows=' || count(*) FILTER (WHERE trade_type='sale') || ', sale min=' || min(contract_date) FILTER (WHERE trade_type='sale') FROM transactions"
      if ($LASTEXITCODE -ne 0) { throw 'DB 연결 실패' }
    }
    'backup' {
      $pgDump = Find-PgTool 'pg_dump'
      $file = Join-Path (Get-Location) ("backup_before_backfill_{0:yyyyMMdd_HHmm}.dump" -f (Get-Date))
      & $pgDump -w --data-only --no-owner --format=custom --file $file
      if ($LASTEXITCODE -ne 0) { throw "pg_dump 실패 (exit $LASTEXITCODE)" }
      $f = Get-Item $file
      Write-Host "backup: $($f.Name) $($f.Length) bytes sha256 $((Get-FileHash $file -Algorithm SHA256).Hash)"
      Write-Host '이 파일은 저장소(공개)에 커밋하지 마세요. .gitignore 에 *.dump 가 있습니다.'
    }
    'dryrun' {
      Assert-Node | Out-Null
      Invoke-Node @('scripts/phase2/backfill-sales.ts', '--from', $From, '--to', $To, '--max-calls', "$MaxCalls", '--dry-run')
    }
    'collect' {
      Assert-Node | Out-Null
      $backups = @(Get-ChildItem 'backup_before_backfill_*.dump' -ErrorAction SilentlyContinue)
      if ($backups.Count -eq 0) { throw '백업 파일이 없습니다. -Step backup 을 먼저 실행하세요.' }
      $ok = Read-Host "운영 DB에 $From~$To 매매를 수집합니다(data.go.kr 호출 최대 $MaxCalls 회). 계속하려면 COLLECT 입력"
      if ($ok -ne 'COLLECT') { throw '취소했습니다.' }
      $env:DATA_GO_KR_SERVICE_KEY = Read-Secret '공공데이터포털 일반 인증키(Decoding)'
      Invoke-Node @('scripts/phase2/backfill-sales.ts', '--from', $From, '--to', $To, '--max-calls', "$MaxCalls")
      Write-Host '수집 완료. 이어서 -Step match 를 실행하세요(매칭 전에는 새 거래가 단지에 연결되지 않습니다).'
    }
    'match' {
      Assert-Node | Out-Null
      Invoke-Node @('scripts/match-transactions.ts')
    }
    'verify' {
      $psql = Find-PgTool 'psql'
      & $psql -X -w -v ON_ERROR_STOP=1 -f (Join-Path $repo 'scripts\phase2\backfill-verify.sql')
      if ($LASTEXITCODE -ne 0) { throw 'verify 실패' }
    }
  }
} finally {
  foreach ($n in 'PGPASSWORD', 'DATABASE_URL', 'DATA_GO_KR_SERVICE_KEY') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
}
