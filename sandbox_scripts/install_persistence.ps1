# Mallab V3 - Persistence Installer
# Registers enforce_security.ps1 as a Windows Scheduled Task.

$ScriptPath = Join-Path $PSScriptRoot "enforce_security.ps1"
$TaskName = "MallabSecurityEnforcement"
$Description = "Ensures Windows Defender and other security features remain disabled for malware analysis."

# Check if script exists
if (-not (Test-Path $ScriptPath)) {
    Write-Error "Enforcement script not found at $ScriptPath"
    exit 1
}

Write-Host "[*] Registering Scheduled Task: $TaskName" -ForegroundColor Cyan

# Define the action
$Action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -File `"$ScriptPath`""

# Define the triggers: At Startup and every 30 minutes
$TriggerStartup = New-ScheduledTaskTrigger -AtStartup
$TriggerDaily = New-ScheduledTaskTrigger -Daily -At "12:00AM"
$TriggerDaily.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30)).Repetition

# Define the principal: Run as SYSTEM
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Register the task
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $TriggerStartup, $TriggerDaily -Principal $Principal -Description $Description -Force

Write-Host "[+] Scheduled Task '$TaskName' registered successfully." -ForegroundColor Green
Write-Host "[*] The task will run on every boot and every 30 minutes to enforce security settings."
