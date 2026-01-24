param (
    [string]$Server = "192.168.1.10:9001"
)

Write-Host "Launching VOODOOBOX Windows Agent..." -ForegroundColor Cyan
Write-Host "Connecting to Hyper-Bridge @ $Server" -ForegroundColor Gray

# Check if agent is already built
if (-not (Test-Path "..\target\release\agent-windows.exe")) {
    Write-Host "Building agent (Release)..." -ForegroundColor Yellow
    Push-Location ..
    cargo build -p agent-windows --release
    Pop-Location
}

$env:AGENT_SERVER_ADDR = $Server
Write-Host "Executing Agent..." -ForegroundColor Green
&\..\target\release\agent-windows.exe
