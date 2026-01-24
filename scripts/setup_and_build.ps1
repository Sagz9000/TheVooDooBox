# Quick Start: Install Rust and Build Agent
$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   VooDooBox Agent - Rust Setup & Build" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Rust is already installed
$RustInstalled = $false
try {
    $null = cargo --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $RustInstalled = $true
        $CargoVersion = cargo --version
        Write-Host "[OK] Rust is already installed: $CargoVersion" -ForegroundColor Green
    }
}
catch {
    # Rust not installed
}

if (-not $RustInstalled) {
    Write-Host "[!] Rust is not installed. Installing now..." -ForegroundColor Yellow
    Write-Host ""
    
    # Download rustup-init
    $RustupUrl = "https://win.rustup.rs/x86_64"
    $RustupPath = "$env:TEMP\rustup-init.exe"
    
    Write-Host "[1/3] Downloading Rust installer..." -ForegroundColor Yellow
    try {
        Invoke-WebRequest -Uri $RustupUrl -OutFile $RustupPath -UseBasicParsing
        Write-Host "      OK Downloaded to: $RustupPath" -ForegroundColor Green
    }
    catch {
        Write-Host "      ERROR Failed to download Rust installer" -ForegroundColor Red
        Write-Host "      Please download manually from: https://rustup.rs" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "[2/3] Running Rust installer..." -ForegroundColor Yellow
    Write-Host "      Follow the prompts (press Enter for default options)" -ForegroundColor Gray
    Write-Host ""
    
    # Run installer
    & $RustupPath
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "      ERROR Installation failed or was cancelled" -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "[3/3] Refreshing environment..." -ForegroundColor Yellow
    
    # Add Cargo to PATH for current session
    $CargoPath = "$env:USERPROFILE\.cargo\bin"
    $env:Path = "$env:Path;$CargoPath"
    
    # Verify installation
    try {
        $CargoVersion = cargo --version
        Write-Host "      OK Rust installed successfully: $CargoVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "      WARNING Rust installed but not in PATH" -ForegroundColor Yellow
        Write-Host "      Please restart PowerShell and run this script again" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "         Building VOODOOBOX Windows Agent" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

# Navigate to agent directory
$AgentDir = Join-Path $PSScriptRoot "..\agent-windows"
if (-not (Test-Path $AgentDir)) {
    Write-Host "[ERROR] Agent directory not found: $AgentDir" -ForegroundColor Red
    exit 1
}

Set-Location $AgentDir
Write-Host "[INFO] Building in: $AgentDir" -ForegroundColor Cyan
Write-Host ""

# Build the agent
Write-Host "[BUILD] Running: cargo build --release" -ForegroundColor Yellow
Write-Host "        This may take 5-10 minutes on first build..." -ForegroundColor Gray
Write-Host ""

cargo build --release

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host "              Build Failed!" -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "  1. Missing Visual Studio Build Tools" -ForegroundColor White
    Write-Host "     Download from: https://visualstudio.microsoft.com/downloads/" -ForegroundColor Gray
    Write-Host "     Select 'Desktop development with C++'" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  2. Antivirus blocking compilation" -ForegroundColor White
    Write-Host "     Add exception for: $AgentDir\target" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

# Verify binary exists
$BinaryPath = "target\release\voodoobox-agent-windows.exe"
if (Test-Path $BinaryPath) {
    $FileInfo = Get-Item $BinaryPath
    $SizeMB = [math]::Round($FileInfo.Length / 1MB, 2)
    
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "            Build Successful!" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Binary Location:" -ForegroundColor Cyan
    Write-Host "  $(Resolve-Path $BinaryPath)" -ForegroundColor White
    Write-Host ""
    Write-Host "Binary Size: $SizeMB MB" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "              Next Steps" -ForegroundColor Yellow
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To deploy to a Windows VM:" -ForegroundColor White
    Write-Host "  1. Copy the binary to the VM" -ForegroundColor Gray
    Write-Host "  2. Run the install script inside the VM:" -ForegroundColor Gray
    Write-Host "     .\scripts\install_agent.ps1 -ServerIP <BRIDGE_IP>" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To test locally:" -ForegroundColor White
    Write-Host '  $env:AGENT_SERVER_ADDR = "192.168.50.1:9001"' -ForegroundColor Cyan
    Write-Host "  .\target\release\voodoobox-agent-windows.exe" -ForegroundColor Cyan
    Write-Host ""
}
else {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host "         Binary Not Found!" -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Expected location: $BinaryPath" -ForegroundColor Yellow
    exit 1
}
