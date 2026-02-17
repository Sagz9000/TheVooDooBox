<#
.SYNOPSIS
    Installs Sysmon64 with a malware analysis optimized configuration.
.DESCRIPTION
    1. Downloads the Sysmon zip from Microsoft Sysinternals.
    2. Extracts the binaries.
    3. Installs Sysmon64 using the local sysmon_config.xml.
#>

$ErrorActionPreference = "Stop"
$toolsDir = "C:\Tools"
$sysmonZip = Join-Path $toolsDir "Sysmon.zip"
$sysmonExtracted = Join-Path $toolsDir "Sysmon"
$configPath = Join-Path $PSScriptRoot "sysmon_config.xml"

# 1. Create Tools directory if it doesn't exist
if (-not (Test-Path $toolsDir)) {
    Write-Host "[*] Creating $toolsDir..." -ForegroundColor Cyan
    New-Item -Path $toolsDir -ItemType Directory | Out-Null
}

# 2. Download Sysmon
Write-Host "[*] Downloading Sysmon from Microsoft Sysinternals..." -ForegroundColor Cyan
$url = "https://download.sysinternals.com/files/Sysmon.zip"
Invoke-WebRequest -Uri $url -OutFile $sysmonZip

# 3. Extract Sysmon
Write-Host "[*] Extracting Sysmon..." -ForegroundColor Cyan
if (Test-Path $sysmonExtracted) { Remove-Item -Path $sysmonExtracted -Recurse -Force }
Expand-Archive -Path $sysmonZip -DestinationPath $sysmonExtracted

# 4. Install Sysmon64
$sysmonExe = Join-Path $sysmonExtracted "Sysmon64.exe"

if (-not (Test-Path $configPath)) {
    Write-Error "[-] Configuration file not found at $configPath"
}

Write-Host "[*] Installing Sysmon64 with config..." -ForegroundColor Green
# -i: Install
# -accepteula: Automatically accept the EULA
Start-Process -FilePath $sysmonExe -ArgumentList "-i", "`"$configPath`"", "-accepteula" -Wait

# 5. Verify Installation
if (Get-Service "Sysmon64" -ErrorAction SilentlyContinue) {
    Write-Host "[+] Sysmon64 installed and running successfully!" -ForegroundColor Green
}
else {
    Write-Error "[-] Sysmon64 installation failed or service not started."
}
