$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $projectRoot '.local'
$archivePath = Join-Path $localRoot 'postgresql-17.11-5-windows-x64-binaries.zip'
$postgresRoot = Join-Path $localRoot 'postgresql'
$dataPath = Join-Path $localRoot 'pgdata'
$logPath = Join-Path $localRoot 'postgresql.log'
$downloadUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip'
$expectedSha256 = '80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f'

New-Item -ItemType Directory -Path $localRoot -Force | Out-Null

if (-not (Test-Path -LiteralPath $archivePath)) {
  Write-Host 'Downloading PostgreSQL 17.11 portable binaries from EDB...'
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath
}

$actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "PostgreSQL archive checksum mismatch. Delete $archivePath and retry."
}
Write-Host 'PostgreSQL archive checksum verified.'

if (-not (Test-Path -LiteralPath $postgresRoot)) {
  $extractPath = Join-Path $localRoot 'postgresql-extract'
  if (Test-Path -LiteralPath $extractPath) { Remove-Item -LiteralPath $extractPath -Recurse -Force }
  Write-Host 'Extracting PostgreSQL...'
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
  $initDb = Get-ChildItem -LiteralPath $extractPath -Filter 'initdb.exe' -Recurse | Select-Object -First 1
  if (-not $initDb) { throw 'initdb.exe was not present in the verified PostgreSQL archive.' }
  $discoveredRoot = Split-Path -Parent (Split-Path -Parent $initDb.FullName)
  Move-Item -LiteralPath $discoveredRoot -Destination $postgresRoot
  if (Test-Path -LiteralPath $extractPath) { Remove-Item -LiteralPath $extractPath -Recurse -Force }
}

$binPath = Join-Path $postgresRoot 'bin'
$initDbPath = Join-Path $binPath 'initdb.exe'
$pgCtlPath = Join-Path $binPath 'pg_ctl.exe'
$psqlPath = Join-Path $binPath 'psql.exe'
foreach ($required in @($initDbPath, $pgCtlPath, $psqlPath)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required PostgreSQL executable is missing: $required" }
}

if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))) {
  $passwordPath = Join-Path $localRoot 'postgres-password.tmp'
  try {
    Set-Content -LiteralPath $passwordPath -Value 'postgres' -NoNewline -Encoding Ascii
    Write-Host 'Initializing the local PostgreSQL cluster...'
    & $initDbPath -D $dataPath -U postgres -A scram-sha-256 --pwfile=$passwordPath --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw "initdb failed with exit code $LASTEXITCODE" }
  } finally {
    if (Test-Path -LiteralPath $passwordPath) { Remove-Item -LiteralPath $passwordPath -Force }
  }
  Add-Content -LiteralPath (Join-Path $dataPath 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`n"
}

& $pgCtlPath -D $dataPath status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Starting local PostgreSQL on 127.0.0.1:55432...'
  & $pgCtlPath -D $dataPath -l $logPath -o '-p 55432' -w start
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed to start. Read $logPath" }
}

$previousPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = 'postgres'
  & $psqlPath -h 127.0.0.1 -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=1 -f (Join-Path $PSScriptRoot 'create-local-db.sql')
  if ($LASTEXITCODE -ne 0) { throw "Database creation failed with exit code $LASTEXITCODE" }
} finally {
  $env:PGPASSWORD = $previousPassword
}

Write-Host ''
Write-Host 'Portable PostgreSQL is ready.'
Write-Host "Binaries: $postgresRoot"
Write-Host "Data:     $dataPath"
Write-Host 'Database: postgresql://ums:ums_local_password@localhost:55432/ums_payments'
