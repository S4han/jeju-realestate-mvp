# Phase 3 지역·경계 참조 데이터 적재(P3-TASK-003) — 사용자 PC에서 단계별로 실행
#   check → migrate → load → activate → status   (되돌리기: rollback)
#   powershell -ExecutionPolicy Bypass -File .\scripts\phase3\windows\regions.ps1 -Step check -DbUser postgres.<ref> `
#     -Codes C:\경로\국토교통부_전국_법정동.csv -Boundary C:\경로\LSMD_ADM_SECT_UMD_50_202610.shp
# check·status 는 읽기만 한다. migrate·load·activate·rollback 은 확인 문구를 입력해야 실행된다.
# Phase 1·2 테이블은 바꾸지 않는다(새 p3_* 테이블만). 원본 파일은 저장소에 넣지 않는다.
param(
  [Parameter(Mandatory = $true)][ValidateSet('check', 'migrate', 'load', 'activate', 'status', 'rollback')][string]$Step,
  [string]$Codes,
  [string]$Boundary,  # .shp 경로(같은 폴더에 .dbf/.prj 필요)
  [string]$SetId,
  [int]$Tolerance = 20,
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
  if (-not $v -or [int]($v.TrimStart('v').Split('.')[0]) -lt 22) { throw "Node.js 22 이상이 필요합니다(현재: $v)." }
  if (-not (Test-Path (Join-Path $repo 'node_modules\tsx'))) { throw "의존성이 없습니다. 저장소 폴더에서 'npm ci' 를 먼저 실행하세요." }
}
function Invoke-Node([string[]]$NodeArgs) {
  & node --import tsx @NodeArgs
  if ($LASTEXITCODE -ne 0) { throw "실패 (exit $LASTEXITCODE)" }
}
function Confirm-Word([string]$message, [string]$word) {
  $ok = Read-Host "$message 계속하려면 $word 입력"
  if ($ok -ne $word) { throw '취소했습니다.' }
}
function Loader-Args {
  if (-not $Codes -or -not (Test-Path $Codes)) { throw '-Codes 에 법정동 코드 CSV 경로를 지정하세요.' }
  if (-not $Boundary -or -not (Test-Path $Boundary)) { throw '-Boundary 에 경계 .shp 경로를 지정하세요.' }
  $base = $Boundary -replace '\.shp$', ''
  return @('scripts/phase3/load-regions.ts', '--codes', $Codes, '--boundary', $base, '--tolerance', "$Tolerance")
}
$statusSql = @"
SELECT set_id, status, code_as_of, boundary_as_of, simplify_tolerance_m, created_at, activated_at FROM p3_region_sets ORDER BY set_id;
SELECT level, count(*) FROM p3_regions r JOIN p3_region_sets s USING (set_id) WHERE s.status = 'ACTIVE' GROUP BY 1;
SELECT count(*) AS boundaries, sum(vertex_count) AS vertices, round(sum(area_m2) / 1e6, 1) AS area_km2,
       pg_size_pretty(pg_total_relation_size('p3_region_boundaries')) AS table_size
  FROM p3_region_boundaries b JOIN p3_region_sets s USING (set_id) WHERE s.status = 'ACTIVE';
"@

try {
  Write-Host "== $Step | 저장소 $repo"
  if (-not $DbUser) { $DbUser = Read-Host 'DB 사용자 (postgres.<프로젝트 ref>)' }
  $pw = Read-Secret 'Supabase DB 비밀번호 (화면에 표시되지 않음)'
  $env:PGHOST = $DbHost; $env:PGPORT = "$Port"; $env:PGUSER = $DbUser; $env:PGDATABASE = 'postgres'
  $env:PGSSLMODE = 'require'; $env:PGCLIENTENCODING = 'UTF8'; $env:PGPASSWORD = $pw
  $scheme = 'postgresql' + '://'
  $env:DATABASE_URL = $scheme + [Uri]::EscapeDataString($DbUser) + ':' + [Uri]::EscapeDataString($pw) + '@' + "${DbHost}:$Port/postgres"
  $env:DATABASE_SSL = 'require'
  $pw = $null
  $psql = Find-PgTool 'psql'
  switch ($Step) {
    'check' {
      Assert-Node
      Write-Host '[1] 적용 대기 마이그레이션(0005 하나만 있어야 정상)'
      $applied = & $psql -X -w -A -t -c "SET default_transaction_read_only = on" -c "SELECT name FROM schema_migrations ORDER BY 1"
      if ($LASTEXITCODE -ne 0) { throw 'DB 연결 실패' }
      Get-ChildItem (Join-Path $repo 'db\migrations\*.sql') | Where-Object { $applied -notcontains $_.Name } | ForEach-Object { Write-Host "  pending: $($_.Name)" }
      Write-Host '[2] 파일 검증 + 단지 좌표 포함 검사(읽기만)'
      Invoke-Node (Loader-Args)
    }
    'migrate' {
      Assert-Node
      Confirm-Word '운영 DB에 Phase 3 테이블(p3_*)을 만듭니다(기존 테이블 변경 없음).' 'MIGRATE'
      Invoke-Node @('scripts/migrate.ts')
    }
    'load' {
      Assert-Node
      Confirm-Word '운영 DB에 지역·경계 세트를 저장합니다(검증 실패 시 REJECTED로만 기록, 활성화는 하지 않음).' 'LOAD'
      Invoke-Node ((Loader-Args) + @('--save'))
    }
    'activate' {
      Assert-Node
      if (-not $SetId) { throw '-SetId 에 load 결과의 세트 번호를 지정하세요.' }
      Confirm-Word "지역 세트 $SetId 을(를) 활성화합니다(이전 활성 세트는 RETIRED)." 'ACTIVATE'
      Invoke-Node @('scripts/phase3/load-regions.ts', '--activate', $SetId)
    }
    'status' {
      & $psql -X -w -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only = on" -c $statusSql
      if ($LASTEXITCODE -ne 0) { throw '조회 실패' }
    }
    'rollback' {
      Confirm-Word 'Phase 3 테이블(p3_*)과 0005 적용 기록을 삭제합니다(Phase 1·2 데이터는 그대로).' 'ROLLBACK'
      & $psql -X -w -v ON_ERROR_STOP=1 -c "BEGIN; DROP TABLE IF EXISTS p3_region_boundaries, p3_regions, p3_region_sets; DELETE FROM schema_migrations WHERE name = '0005_p3_regions.sql'; COMMIT;"
      if ($LASTEXITCODE -ne 0) { throw '되돌리기 실패' }
    }
  }
} finally {
  foreach ($n in 'PGPASSWORD', 'DATABASE_URL') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
}
