# Daily content-farm run, started by Windows Task Scheduler (see install-schedule.ps1).
# Logs go to content-farm\logs\YYYY-MM-DD.log; the last 30 logs are kept.
param([string]$Command = "daily")

$ErrorActionPreference = "Continue"
$farm = Split-Path -Parent $PSScriptRoot
Set-Location $farm

$logs = Join-Path $farm "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs ("{0:yyyy-MM-dd}.log" -f (Get-Date))
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Log([string]$text) { [System.IO.File]::AppendAllText($log, "$(Get-Date -Format s) $text`r`n", $utf8) }

# One run at a time: a stale lock (>2 h) is ignored.
$lock = Join-Path $farm ".work\run.lock"
if ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalHours -lt 2) {
  if ($Command -ne "work") { Write-Log "skipped: another $Command run is in progress" }
  exit 0
}
New-Item -ItemType Directory -Force (Split-Path $lock) | Out-Null
Set-Content $lock $PID

try {
  # cmd.exe writes Node's UTF-8 output byte-for-byte (PowerShell 5.1 would re-encode it).
  if (-not (Test-Path (Join-Path $farm "node_modules"))) { cmd.exe /c "npm ci >> `"$log`" 2>&1" }
  $tmp = Join-Path $farm ".work\run-$Command.log"
  cmd.exe /c "npx tsx src/cli.ts $Command > `"$tmp`" 2>&1"
  $code = $LASTEXITCODE
  # Frequent "work" runs stay silent in the log when there was nothing to do.
  $text = [System.IO.File]::ReadAllText($tmp, $utf8).Trim()
  if ($text -or $code -ne 0) {
    Write-Log "===== $Command (exit $code) ====="
    [System.IO.File]::AppendAllText($log, "$text`r`n", $utf8)
  }
} finally {
  Remove-Item $lock -ErrorAction SilentlyContinue
  Get-ChildItem $logs -Filter *.log | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -ErrorAction SilentlyContinue
  # Rendered files are already in Supabase Storage; keep two weeks locally.
  Get-ChildItem (Join-Path $farm "out") -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Recurse -ErrorAction SilentlyContinue
}
