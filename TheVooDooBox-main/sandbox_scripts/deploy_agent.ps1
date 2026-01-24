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

# 4. Deploy Agent File
Write-Host "[*] Deploying agent.pyw..."
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceAgent = Join-Path $ScriptDir "agent.pyw"

if (Test-Path $SourceAgent) {
    Copy-Item -Path $SourceAgent -Destination "$AgentDir\agent.pyw" -Force
}
else {
    Write-Error "Source agent.pyw not found at $SourceAgent"
    Stop-Transcript
    exit 1
}

# 5. Add to Startup
Write-Host "[*] Configuring auto-start..."
$startupKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$pythonwPath = (Get-Command pythonw).Source
$cmdValue = "`"$pythonwPath`" `"$AgentDir\agent.pyw`""
Set-ItemProperty -Path $startupKey -Name "VoodooBoxAgent" -Value $cmdValue

Write-Host "`nAgent deployment complete." -ForegroundColor Green
Write-Host "The agent will run silently in the background on next logon."
Stop-Transcript
