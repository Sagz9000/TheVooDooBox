# VOODOOBOX V3 - Kernel Driver "The Eye" Installer
# Installs and registers the kernel-mode monitoring driver.

param(
    [string]$DriverName = "VoodooBoxEye",
    [string]$DriverDesc = "VOODOOBOX V3 Real-time Event Streamer",
    [string]$LogPath = "C:\VoodooBox_Driver_Install.log"
)

# Admin check
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

Start-Transcript -Path $LogPath -Append

Write-Host "--- VOODOOBOX V3 Kernel Driver Installer ---" -ForegroundColor Cyan

# 1. Enable Test Signing (Required for non-WHQL drivers)
Write-Host "[*] Enabling Test Signing mode..."
bcdedit /set testsigning on

# 2. Check for Driver Binary
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceDriver = Join-Path $ScriptDir "voodoobox_eye.sys"
$DestDriver = "C:\Windows\System32\drivers\voodoobox_eye.sys"

if (Test-Path $SourceDriver) {
    Write-Host "[*] Copying driver binary to System32..."
    Copy-Item -Path $SourceDriver -Destination $DestDriver -Force
}
else {
    Write-Warning "Driver binary (voodoobox_eye.sys) not found in $ScriptDir."
    Write-Warning "Skipping registration. Please place the compiled .sys file in the folder and re-run."
    Stop-Transcript
    exit 0
}

# 3. Create and Register Service
Write-Host "[*] Registering Kernel Service..."
# Remove existing if present
sc.exe stop $DriverName 2>$null | Out-Null
sc.exe delete $DriverName 2>$null | Out-Null

# Create New Service
sc.exe create $DriverName binPath= $DestDriver type= kernel start= auto displayName= $DriverDesc

if ($LASTEXITCODE -eq 0) {
    Write-Host "[+] Driver registered successfully!" -ForegroundColor Green
}
else {
    Write-Error "Failed to register driver service."
}

Write-Host "`nREBOOT REQUIRED to enable Test Signing and load the driver." -ForegroundColor Yellow
Write-Host "After reboot, verify with: 'sc query $DriverName'"

Stop-Transcript
