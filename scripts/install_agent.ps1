# Mallab Windows Agent - Installation Script
# This script deploys the agent to a Windows sandbox VM and configures it to auto-start

param (
    [Parameter(Mandatory = $false)]
    [string]$ServerIP = "192.168.50.1",
    
    [Parameter(Mandatory = $false)]
    [int]$ServerPort = 9001,
    
    [Parameter(Mandatory = $false)]
    [string]$InstallPath = "C:\Mallab",
    
    [Parameter(Mandatory = $false)]
    [switch]$AutoStart = $true
)

$ErrorActionPreference = "Stop"

Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Mallab Windows Agent - Deployment v3.0.0    ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Step 1: Create installation directory
Write-Host "[1/5] Creating installation directory..." -ForegroundColor Yellow
if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    Write-Host "      ✓ Created: $InstallPath" -ForegroundColor Green
}
else {
    Write-Host "      ✓ Directory exists: $InstallPath" -ForegroundColor Green
}

# Step 2: Copy agent binary
Write-Host "[2/5] Deploying agent binary..." -ForegroundColor Yellow
$AgentSource = Join-Path $PSScriptRoot "..\target\release\voodoobox-agent-windows.exe"
$AgentDest = Join-Path $InstallPath "voodoobox-agent.exe"

if (Test-Path $AgentSource) {
    Copy-Item -Path $AgentSource -Destination $AgentDest -Force
    Write-Host "      ✓ Deployed: voodoobox-agent.exe" -ForegroundColor Green
}
else {
    Write-Host "      ✗ ERROR: Agent binary not found at $AgentSource" -ForegroundColor Red
    Write-Host "      → Run 'cargo build --release -p voodoobox-agent-windows' first" -ForegroundColor Yellow
    exit 1
}

# Step 3: Create configuration file
Write-Host "[3/5] Generating configuration..." -ForegroundColor Yellow
$ConfigPath = Join-Path $InstallPath "config.json"
$Config = @{
    server_addr       = "${ServerIP}:${ServerPort}"
    auto_reconnect    = $true
    scan_interval_sec = 4
    watch_paths       = @(
        "C:\Windows\Temp",
        "C:\Users\Public\Downloads",
        "C:\ProgramData"
    )
} | ConvertTo-Json -Depth 10

Set-Content -Path $ConfigPath -Value $Config -Force
Write-Host "      ✓ Config saved: $ConfigPath" -ForegroundColor Green

# Step 4: Create startup script
Write-Host "[4/5] Creating startup script..." -ForegroundColor Yellow
$StartupScript = @"
@echo off
title TheVooDooBox Agent
cd /d "$InstallPath"
set AGENT_SERVER_ADDR=${ServerIP}:${ServerPort}
echo [THEVOODOOBOX] Starting Windows Agent...
echo [THEVOODOOBOX] Server: %AGENT_SERVER_ADDR%
voodoobox-agent.exe
pause
"@

$StartupScriptPath = Join-Path $InstallPath "start-agent.bat"
Set-Content -Path $StartupScriptPath -Value $StartupScript -Force
Write-Host "      ✓ Startup script: $StartupScriptPath" -ForegroundColor Green

# Step 5: Configure auto-start (if enabled)
if ($AutoStart) {
    Write-Host "[5/5] Configuring auto-start..." -ForegroundColor Yellow
    
    # Create scheduled task to run at startup
    $TaskName = "MallabAgent"
    $Action = New-ScheduledTaskAction -Execute $StartupScriptPath
    $Trigger = New-ScheduledTaskTrigger -AtStartup
    $Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    
    # Remove existing task if present
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    
    # Register new task
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings | Out-Null
    Write-Host "      ✓ Auto-start configured (Scheduled Task)" -ForegroundColor Green
}
else {
    Write-Host "[5/5] Skipping auto-start configuration" -ForegroundColor Gray
}

Write-Host ""
Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║          Installation Complete! ✓              ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Agent Location:  $AgentDest" -ForegroundColor Cyan
Write-Host "Server Address:  ${ServerIP}:${ServerPort}" -ForegroundColor Cyan
Write-Host "Auto-Start:      $(if ($AutoStart) { 'Enabled' } else { 'Disabled' })" -ForegroundColor Cyan
Write-Host ""
Write-Host "To start the agent manually, run:" -ForegroundColor Yellow
Write-Host "  $StartupScriptPath" -ForegroundColor White
Write-Host ""
Write-Host "To start the agent now:" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName 'MallabAgent'" -ForegroundColor White
Write-Host ""
