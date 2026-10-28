$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $projectRoot '.local'
$pgCtl = Join-Path $localRoot 'postgresql\bin\pg_ctl.exe'
$dataPath = Join-Path $localRoot 'pgdata'
$logPath = Join-Path $localRoot 'postgresql.log'

if (-not (Test-Path -LiteralPath $pgCtl)) {
  throw 'Portable PostgreSQL is not installed. Run: npm.cmd run db:portable:install'
}
& $pgCtl -D $dataPath status *> $null
if ($LASTEXITCODE -eq 0) { Write-Host 'Portable PostgreSQL is already running.'; exit 0 }
& $pgCtl -D $dataPath -l $logPath -o '-p 55432' -w start
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed to start. Read $logPath" }
