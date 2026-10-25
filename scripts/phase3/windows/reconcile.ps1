# Phase 3 P3-TASK-007 운영 DB 읽기 전용 지역 통계 대사 — 사용자 PC에서 실행
#   powershell -ExecutionPolicy Bypass -File .\scripts\phase3\windows\reconcile.ps1 -DbUser postgres.<프로젝트 ref>
# 쓰기 없음(READ ONLY 트랜잭션). 비밀번호는 가려서 입력받아 이 프로세스 환경 변수로만 쓰고 끝나면 지운다.
# 결과(집계 숫자만)는 화면과 바탕화면 p3-reconcile.txt에 저장된다.
param(
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

try {
  $psql = Find-PgTool 'psql'
  if (-not $DbUser) { $DbUser = Read-Host 'DB 사용자 (postgres.<프로젝트 ref>)' }
  $env:PGHOST = $DbHost; $env:PGPORT = "$Port"; $env:PGUSER = $DbUser; $env:PGDATABASE = 'postgres'
  $env:PGSSLMODE = 'require'; $env:PGCLIENTENCODING = 'UTF8'
  $env:PGPASSWORD = Read-Secret 'Supabase DB 비밀번호 (화면에 표시되지 않음)'
  $out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'p3-reconcile.txt'
  & $psql -X -w -v ON_ERROR_STOP=1 -f (Join-Path $repo 'docs\phase3\p3-task-007\reconcile.sql') 2>&1 | Tee-Object -FilePath $out
  if ($LASTEXITCODE -ne 0) { throw '조회 실패' }
  Write-Host "`n저장됨: $out (집계 숫자만, 비밀번호 없음)"
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
