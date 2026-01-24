param (
    [switch]$BuildOnly,
    [switch]$SkipAgent,
    [string]$ProxmoxIP = "192.168.1.100"
)

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   THE VOODOO BOX AUTOMATED DEPLOYMENT ORCHESTRATOR" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# 1. Prerequisite Check
Write-Host "`n[1/4] Checking Prerequisites..." -ForegroundColor Yellow
$Prereqs = @("docker", "cargo", "npm")
foreach ($cmd in $Prereqs) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        Write-Host "  ✅ $cmd detected" -ForegroundColor Green
    }
    else {
        Write-Host "  ❌ $cmd NOT found! Please install it." -ForegroundColor Red
        exit
    }
}

# 2. Build Components
Write-Host "`n[2/4] Building Components..." -ForegroundColor Yellow

if (-not $SkipAgent) {
    Write-Host "  📦 Building Windows Agent..." -ForegroundColor Gray
    Set-Location agent-windows
    cargo build --release
    Set-Location ..
}

Write-Host "  🐳 Building Control Room (Docker Containers)..." -ForegroundColor Gray
docker-compose build

if ($BuildOnly) {
    Write-Host "`n✨ Build Complete! Assets ready in target/release and docker images." -ForegroundColor Green
    exit
}

# 3. Launch Stack
Write-Host "`n[3/4] Launching Control Center..." -ForegroundColor Yellow
docker-compose up -d

# 4. Final Status
Write-Host "`n[4/4] Finalizing Setup..." -ForegroundColor Yellow
Write-Host "`n🚀 TheVooDooBox is now LIVE!" -ForegroundColor Cyan
Write-Host "----------------------------------------------"
Write-Host "  Dashboard:  http://localhost:3000" -ForegroundColor White
Write-Host "  C2 Server:   tcp://$(hostname -ip):9001" -ForegroundColor White
Write-Host "  Backend API: http://localhost:8080" -ForegroundColor White
Write-Host "----------------------------------------------"
Write-Host "Next Steps:" -ForegroundColor Gray
Write-Host "1. Deploy 'agent-windows.exe' to your Sandbox VM."
Write-Host "2. Use '.\scripts\run_agent.ps1 -Server <this-ip>:9001' on the VM."
Write-Host "3. Check the 'Sanctuary' view in the dashboard."

Write-Host "`n✨ Happy Hunting!" -ForegroundColor Green
