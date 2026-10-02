# Registers (or removes with -Remove) the daily Windows Task Scheduler job for the content farm.
#   powershell -ExecutionPolicy Bypass -File content-farm\scripts\install-schedule.ps1 [-Time 09:00] [-Remove]
# Runs as the current user, no admin rights needed. If the PC was off/asleep at that time,
# the task starts as soon as it's available (and wakes the PC from sleep when allowed).
param([string]$Time = "09:00", [switch]$Remove)

$daily = "SealEnglish Content Farm"
$work = "SealEnglish Content Farm Work"
if ($Remove) {
  foreach ($n in @($daily, $work)) { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }
  Write-Output "Removed: $daily, $work"
  exit 0
}

$script = Join-Path $PSScriptRoot "run-daily.ps1"
$cwd = Split-Path -Parent $PSScriptRoot
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
function Action($cmd) {
  New-ScheduledTaskAction -Execute "powershell.exe" -WorkingDirectory $cwd `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Command $cmd"
}

# 1) Daily: trends -> ideas -> scripts for approval.
Register-ScheduledTask -TaskName $daily -Action (Action "daily") -Trigger (New-ScheduledTaskTrigger -Daily -At $Time) -Settings $settings `
  -Description "Seal English: trends -> AI ideas -> scripts for approval (cabinet -> Content farm)" -Force | Out-Null

# 2) Every 15 min: rewrite scripts the owner commented on, produce approved ones.
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $work -Action (Action "work") -Trigger $every -Settings $settings `
  -Description "Seal English: produce approved scripts (voice, backgrounds, render)" -Force | Out-Null

Write-Output "Registered: $daily (daily at $Time) and $work (every 15 min)."
