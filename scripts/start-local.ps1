param(
  [ValidateSet('rehearsal','sandbox')][string]$Mode = 'rehearsal',
  [int]$Port = 0,
  [string]$DataDirectory = ''
)
$ErrorActionPreference = 'Stop'
$appDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($Port -eq 0) { $Port = if ($Mode -eq 'sandbox') { 4320 } else { 4319 } }
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid local port.' }
if (-not $DataDirectory) { $DataDirectory = Join-Path $appDirectory "data/v2-local-$Mode" }
if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'dist/server/index.js'))) { throw 'Run npm run build first.' }
$env:NODE_ENV = 'production'
$env:APP_MODE = $Mode
$env:LOTSPLIT_CONCEPT = 'v2'
$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$env:APP_ORIGIN = "http://127.0.0.1:$Port"
$env:DATA_DIR = [IO.Path]::GetFullPath($DataDirectory)
$env:SESSION_COOKIE_NAME = "lotsplit_v2_$Mode"
Push-Location $appDirectory
try { & node dist/server/index.js; exit $LASTEXITCODE } finally { Pop-Location }
