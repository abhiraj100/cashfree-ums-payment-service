$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $projectRoot '.local'
$pgCtl = Join-Path $localRoot 'postgresql\bin\pg_ctl.exe'
$dataPath = Join-Path $localRoot 'pgdata'

if (-not (Test-Path -LiteralPath $pgCtl)) { Write-Host 'Portable PostgreSQL is not installed.'; exit 0 }
& $pgCtl -D $dataPath status *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Portable PostgreSQL is already stopped.'; exit 0 }
& $pgCtl -D $dataPath -m fast -w stop
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not stop cleanly.' }
