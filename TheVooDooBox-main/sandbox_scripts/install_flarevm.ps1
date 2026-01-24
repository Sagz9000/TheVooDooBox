# Mallab V3 - Automated FlareVM Installer
# Installs FlareVM with optimized settings for the Mallab environment.

param(
    [switch]$Silent = $true,
    [string]$LogPath = "C:\Mallab_FlareVM_Install.log"
)

# Admin check
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

Start-Transcript -Path $LogPath -Append

Write-Host "--- Mallab V3 FlareVM Installer ---" -ForegroundColor Cyan

# 1. Prepare Environment
Write-Host "[*] Preparing environment..."
Set-ExecutionPolicy Unrestricted -Scope CurrentUser -Force

# 2. Check Chocolatey
Write-Host "[*] Checking for Chocolatey..."
if (!(Test-Path "$env:ProgramData\chocolatey\choco.exe")) {
    Write-Host "Installing Chocolatey..."
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    $script = (New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1')
    Invoke-Expression $script
}

# Refresh Env
$env:Path += ";$env:ProgramData\chocolatey\bin"

# 3. Download FlareVM Loader
Write-Host "[*] Downloading FlareVM high-level installer..."
$url = "https://raw.githubusercontent.com/mandiant/flare-vm/main/install.ps1"
$dest = "$env:TEMP\flare_install.ps1"
(New-Object System.Net.WebClient).DownloadFile($url, $dest)

# 4. Execute Installation
Write-Host "[!] Initiating FlareVM installation..."
Write-Host "[!] Note: The VM will reboot multiple times. This process takes 1-3 hours." -ForegroundColor Yellow

if ($Silent) {
    Write-Host "[*] Running in SILENT mode..."
    # FlareVM supports some environment variables for automation
    $env:FLARE_SILENT = "1"
    $env:FLARE_REBOOT = "1"
}

# Execute
Powershell.exe -ExecutionPolicy Bypass -File $dest

Write-Host "`nInstallation task created. Check the VM console for progress." -ForegroundColor Green
Stop-Transcript
