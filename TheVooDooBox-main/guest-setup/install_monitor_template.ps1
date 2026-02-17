# VOODOOBOX MASTER INSTALLER
# Generated from Template

param([string]$ServerAddr = "{{SERVER_ADDR}}") # Placeholder replaced by wizard

if ($ServerAddr -match "{{") {
    # Fallback if replacement failed or script ran manually without wizard
    Write-Warning "Server Address not set via Wizard. Please enter it manually."
    $ServerAddr = Read-Host "Enter Hyper-Bridge Address (e.g. 192.168.1.100:9001)"
}

Write-Host "Installing VoodooBox Agent..." -ForegroundColor Cyan
Set-ExecutionPolicy Bypass -Scope Process -Force

# 1. Config
$Config = @{
    server_addr       = $ServerAddr
    auto_reconnect    = $true
    scan_interval_sec = 4
    watch_paths       = @("C:\Windows\Temp", "C:\Users\Public")
} | ConvertTo-Json
Set-Content -Path ".\config.json" -Value $Config

# 2. Sysmon
if (Test-Path ".\install_sysmon.ps1") { .\install_sysmon.ps1 }

# 3. Persistence & Watchdog
$InstallDir = "C:\TheVooDooBox"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item ".\voodoobox-agent.exe" "$InstallDir\voodoobox-agent.exe" -Force
Copy-Item ".\config.json" "$InstallDir\config.json" -Force

# Create Watchdog Script
$Watchdog = @"
`$env:AGENT_SERVER_ADDR = "$ServerAddr"
cd "$InstallDir"
while (`$true) {
    if (-not (Get-Process "voodoobox-agent" -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath ".\voodoobox-agent.exe" -WindowStyle Hidden
    }
    Start-Sleep -Seconds 10
}
"@
Set-Content "$InstallDir\watchdog.ps1" $Watchdog

# Scheduled Task
Unregister-ScheduledTask -TaskName "VoodooWatchdog" -Confirm:$false -ErrorAction SilentlyContinue
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -File `"$InstallDir\watchdog.ps1`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "VoodooWatchdog" -Action $Action -Trigger $Trigger -Principal $Principal

Write-Host "Installation Complete! Agent starting..." -ForegroundColor Green
Start-Process "powershell.exe" -ArgumentList "-WindowStyle Hidden -File `"$InstallDir\watchdog.ps1`""
