# Mallab V3 - Sandbox Bootstrap
# One-click script to fully provision a malware analysis sandbox.

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   MALLAB V3 - SANDBOX BOOTSTRAP" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Security Configuration
Write-Host "`n[STEP 1] Configuring Security..." -ForegroundColor Yellow
& "$ScriptDir\configure_security.ps1"

# 2. FlareVM Installation
Write-Host "`n[STEP 2] Installing FlareVM..." -ForegroundColor Yellow
& "$ScriptDir\install_flarevm.ps1" -Silent

# 3. Agent Deployment
Write-Host "`n[STEP 3] Deploying Mallab Agent..." -ForegroundColor Yellow
& "$ScriptDir\deploy_agent.ps1"

# 4. Kernel Driver (The Eye)
Write-Host "`n[STEP 4] Installing Kernel Driver..." -ForegroundColor Yellow
& "$ScriptDir\install_driver.ps1"

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "   BOOTSTRAP INITIATED SUCCESSFULLY" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "The VM will reboot several times."
Write-Host "After FlareVM and Agent are installed, take a snapshot!"
Write-Host "==========================================" -ForegroundColor Cyan
