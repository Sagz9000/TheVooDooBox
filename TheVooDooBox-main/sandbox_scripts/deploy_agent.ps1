# Mallab V3 - CAPE Agent Deployment
# Deploys the Python agent required for sandbox communication.

param(
    [string]$AgentDir = "C:\VoodooBoxAgent",
    [string]$LogPath = "C:\VoodooBox_Agent_Deploy.log"
)

# Admin check
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

Start-Transcript -Path $LogPath -Append

Write-Host "--- VOODOOBOX V3 Agent Deployment ---" -ForegroundColor Cyan

# 1. Ensure Python
Write-Host "[*] Checking for Python..."
if (!(Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python not found. Installing Python 3.11 via Chocolatey..."
    choco install python311 -y
    refreshenv
}

# 2. Install Dependencies
Write-Host "[*] Installing Python dependencies..."
& python -m pip install --upgrade pip
& python -m pip install pillow requests

# 3. Create Agent Directory
if (!(Test-Path $AgentDir)) {
    New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null
}

# 4. Deploy Agent Binary
Write-Host "[*] Deploying mallab-agent-windows.exe..."
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceAgent = Join-Path $ScriptDir "mallab-agent-windows.exe"

# Fallback check in Releases folder if not in sandbox_scripts
if (-not (Test-Path $SourceAgent)) {
    $SourceAgent = Join-Path $PSScriptRoot "..\releases\mallab-agent-windows.exe"
}

if (Test-Path $SourceAgent) {
    Copy-Item -Path $SourceAgent -Destination "$AgentDir\mallab-agent-windows.exe" -Force
}
else {
    Write-Error "Source agent executable not found at $SourceAgent"
    Stop-Transcript
    exit 1
}

# 5. Add to Startup (Scheduled Task for Persistence)
Write-Host "[*] Configuring persistence (Scheduled Task)..."
$Action = New-ScheduledTaskAction -Execute "$AgentDir\mallab-agent-windows.exe" -WorkingDirectory $AgentDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 4
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$TaskName = "VoodooBoxAgent"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings | Out-Null

Write-Host "`nAgent deployment complete." -ForegroundColor Green
Write-Host "The Rust agent is installed and configured for persistence."
Stop-Transcript
