# VOODOOBOX MASTER INSTALLER (GUEST SIDE)
# Run this inside the Windows VM to set up the Agent, Sysmon, and Persistence.

param(
    [string]$ServerAddr = "", # Optional override
    [string]$InstallDir = "C:\TheVooDooBox"
)

$ErrorActionPreference = "Stop"

# --- 1. Interactive Config (if not provided) ---
if ([string]::IsNullOrWhiteSpace($ServerAddr)) {
    Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║    THE VOODOO BOX - AGENT SETUP WIZARD         ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    $ServerAddr = Read-Host "Enter Hyper-Bridge Address (e.g. 192.168.1.100:9001)"
    if ([string]::IsNullOrWhiteSpace($ServerAddr)) {
        Write-Error "Server Address is required!"
        exit 1
    }
}

Write-Host "[*] Configuring Agent for Server: $ServerAddr" -ForegroundColor Yellow

# --- 2. Create Directory Structure ---
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Write-Host "    + Created Install Directory: $InstallDir" -ForegroundColor Gray
}

# --- 3. Copy Binaries ---
$SourceBin = Join-Path $PSScriptRoot "voodoobox-agent.exe"
if (Test-Path $SourceBin) {
    Copy-Item $SourceBin "$InstallDir\voodoobox-agent.exe" -Force
    Write-Host "    + Deployed Agent Binary" -ForegroundColor Gray
}
else {
    Write-Error "MISSING BINARY: voodoobox-agent.exe not found in current folder!"
    exit 1
}

# --- 4. Generate Config ---
$Config = @{
    server_addr       = $ServerAddr
    auto_reconnect    = $true
    scan_interval_sec = 4
    watch_paths       = @("C:\Windows\Temp", "C:\Users\Public", "C:\Users\Public\Downloads")
} | ConvertTo-Json
Set-Content -Path "$InstallDir\config.json" -Value $Config
Write-Host "    + Generated config.json" -ForegroundColor Gray

# --- 5. Install Sysmon (Dependencies) ---
if (Test-Path ".\install_sysmon.ps1") {
    Write-Host "[*] Installing Sysmon..." -ForegroundColor Yellow
    Invoke-Expression -Command ".\install_sysmon.ps1"
}

# --- 6. Setup Persistence (Watchdog) ---
Write-Host "[*] Configuring Persistence..." -ForegroundColor Yellow
$WatchdogScript = @"
`$env:AGENT_SERVER_ADDR = "$ServerAddr"
Set-Location "$InstallDir"
while (`$true) {
    `$proc = Get-Process "voodoobox-agent" -ErrorAction SilentlyContinue
    if (-not `$proc) {
        Write-Host "Starting VooDooBox Agent..."
        Start-Process -FilePath ".\voodoobox-agent.exe" -WindowStyle Hidden
    }
    Start-Sleep -Seconds 10
}
"@
Set-Content "$InstallDir\watchdog.ps1" $Watchdog

# Create Scheduled Task (SYSTEM level)
$TaskName = "VoodooWatchdog"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\watchdog.ps1`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal | Out-Null

Write-Host "    + Registered Scheduled Task: $TaskName" -ForegroundColor Gray

# --- 7. Start Immediately ---
Write-Host "`n[!] SETUP COMPLETE!" -ForegroundColor Green
Write-Host "    Starting Agent Watchdog..."
Start-Process "powershell.exe" -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\watchdog.ps1`""
