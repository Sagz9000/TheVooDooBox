# VOODOOBOX Windows Agent - Build Script
# Cross-compiles the agent for Windows x86_64 from any platform

param (
    [Parameter(Mandatory = $false)]
    [ValidateSet("debug", "release")]
    [string]$BuildType = "release",
    
    [Parameter(Mandatory = $false)]
    [switch]$Install = $false
)

$ErrorActionPreference = "Stop"

Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     VOODOOBOX Windows Agent - Build System       ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Navigate to agent directory
$AgentDir = Join-Path $PSScriptRoot "..\agent-windows"
Set-Location $AgentDir

Write-Host "[INFO] Build Type: $BuildType" -ForegroundColor Cyan
Write-Host "[INFO] Target: x86_64-pc-windows-msvc" -ForegroundColor Cyan
Write-Host ""

# Check if Rust is installed
Write-Host "[1/3] Checking Rust toolchain..." -ForegroundColor Yellow
try {
    $RustVersion = cargo --version
    Write-Host "      ✓ $RustVersion" -ForegroundColor Green
}
catch {
    Write-Host "      ✗ ERROR: Rust not found" -ForegroundColor Red
    Write-Host "      → Install from: https://rustup.rs" -ForegroundColor Yellow
    exit 1
}

# Check for Windows target
Write-Host "[2/3] Verifying Windows target..." -ForegroundColor Yellow
$Targets = rustup target list --installed
if ($Targets -match "x86_64-pc-windows-msvc") {
    Write-Host "      ✓ x86_64-pc-windows-msvc installed" -ForegroundColor Green
}
else {
    Write-Host "      ! Installing x86_64-pc-windows-msvc..." -ForegroundColor Yellow
    rustup target add x86_64-pc-windows-msvc
    Write-Host "      ✓ Target installed" -ForegroundColor Green
}

# Build the agent
Write-Host "[3/3] Building agent..." -ForegroundColor Yellow
Write-Host ""

if ($BuildType -eq "release") {
    cargo build --release --target x86_64-pc-windows-msvc
    $BinaryPath = "target\x86_64-pc-windows-msvc\release\voodoobox-agent-windows.exe"
}
else {
    cargo build --target x86_64-pc-windows-msvc
    $BinaryPath = "target\x86_64-pc-windows-msvc\debug\voodoobox-agent-windows.exe"
}

Write-Host ""

# Verify build
if (Test-Path $BinaryPath) {
    $FileInfo = Get-Item $BinaryPath
    $SizeMB = [math]::Round($FileInfo.Length / 1MB, 2)
    
    Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║            Build Successful! ✓                 ║" -ForegroundColor Green
    Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "Binary:  $BinaryPath" -ForegroundColor Cyan
    Write-Host "Size:    $SizeMB MB" -ForegroundColor Cyan
    Write-Host ""
    
    if ($Install) {
        Write-Host "Running installation script..." -ForegroundColor Yellow
        & "$PSScriptRoot\install_agent.ps1"
    }
    else {
        Write-Host "To deploy to a Windows VM, run:" -ForegroundColor Yellow
        Write-Host "  .\scripts\install_agent.ps1 -ServerIP <BRIDGE_IP>" -ForegroundColor White
        Write-Host ""
    }
}
else {
    Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "║              Build Failed! ✗                   ║" -ForegroundColor Red
    Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Red
    exit 1
}
