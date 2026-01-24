# Mallab V3 - VM Security Configuration
# Disables Windows security features to prepare the environment for malware analysis.

param(
    [string]$LogPath = "C:\Mallab_Security_Config.log"
)

# Admin check
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

Start-Transcript -Path $LogPath -Append

Write-Host "--- Mallab V3 Security Configuration ---" -ForegroundColor Cyan

# 1. Disable Windows Defender
Write-Host "[*] Disabling Windows Defender..."
Set-MpPreference -DisableRealtimeMonitoring $true -ErrorAction SilentlyContinue
Set-MpPreference -DisableBehaviorMonitoring $true -ErrorAction SilentlyContinue
Set-MpPreference -DisableBlockAtFirstSeen $true -ErrorAction SilentlyContinue
Set-MpPreference -DisableIOAVProtection $true -ErrorAction SilentlyContinue
Set-MpPreference -DisablePrivacyMode $true -ErrorAction SilentlyContinue
Set-MpPreference -DisableScriptScanning $true -ErrorAction SilentlyContinue
Set-MpPreference -SubmitSamplesConsent 2 -ErrorAction SilentlyContinue

# Registry-based disablement
$DefenderKey = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender"
if (-not (Test-Path $DefenderKey)) { New-Item -Path $DefenderKey -Force }
Set-ItemProperty -Path $DefenderKey -Name "DisableAntiSpyware" -Value 1 -Force

# 2. Disable Windows Update
Write-Host "[*] Disabling Windows Update..."
Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue
Set-Service -Name wuauserv -StartupType Disabled -ErrorAction SilentlyContinue

# 3. Disable UAC
Write-Host "[*] Disabling User Account Control (UAC)..."
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name "EnableLUA" -Value 0 -Force
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name "ConsentPromptBehaviorAdmin" -Value 0 -Force

# 4. Disable Firewall
Write-Host "[*] Disabling Windows Firewall..."
Set-NetFirewallProfile -Profile Domain, Public, Private -Enabled False

# 5. Disable SmartScreen
Write-Host "[*] Disabling SmartScreen..."
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer" -Name "SmartScreenEnabled" -Value "Off" -Force

# 6. Disable Telemetry
Write-Host "[*] Disabling Telemetry..."
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection" -Name "AllowTelemetry" -Value 0 -Force

# 7. Power Settings (Never sleep)
Write-Host "[*] Optimizing Power Settings..."
powercfg /change monitor-timeout-ac 0
powercfg /change monitor-timeout-dc 0
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0

# 8. Disable Error Reporting
Write-Host "[*] Disabling Windows Error Reporting..."
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting" -Name "Disabled" -Value 1 -Force

Write-Host "`nSecurity configuration complete. REBOOT REQUIRED." -ForegroundColor Green
Stop-Transcript
