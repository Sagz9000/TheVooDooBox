# VOODOOBOX V3 - Persistent Security Enforcement
# Re-applies security disablement settings to ensure they stay off.
# This script is intended to be run via Scheduled Task.

$LogPath = "C:\VoodooBox_Security_Enforcement.log"

function Write-Log {
    param([string]$Message)
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$Timestamp - $Message" | Out-File -FilePath $LogPath -Append
}

Write-Log "[*] Starting security enforcement check..."

try {
    # 1. Enforcement of Windows Defender Disable
    Set-MpPreference -DisableRealtimeMonitoring $true -ErrorAction SilentlyContinue
    Set-MpPreference -DisableBehaviorMonitoring $true -ErrorAction SilentlyContinue
    Set-MpPreference -DisableIOAVProtection $true -ErrorAction SilentlyContinue
    
    $DefenderKey = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender"
    if (-not (Test-Path $DefenderKey)) { New-Item -Path $DefenderKey -Force | Out-Null }
    Set-ItemProperty -Path $DefenderKey -Name "DisableAntiSpyware" -Value 1 -Force -ErrorAction SilentlyContinue

    # 2. Enforcement of Windows Update Disable
    $Service = Get-Service -Name wuauserv -ErrorAction SilentlyContinue
    if ($Service -and $Service.Status -ne "Stopped") {
        Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue
        Write-Log "[!] Windows Update service was running. Stopped."
    }
    Set-Service -Name wuauserv -StartupType Disabled -ErrorAction SilentlyContinue

    # 3. Enforcement of Firewall Disable
    $Firewall = Get-NetFirewallProfile -Profile Domain, Public, Private
    if ($Firewall | Where-Object { $_.Enabled -eq $true }) {
        Set-NetFirewallProfile -Profile Domain, Public, Private -Enabled False
        Write-Log "[!] Firewall was enabled. Disabled."
    }

    Write-Log "[+] Security enforcement check complete."
}
catch {
    Write-Log "[ERROR] Failed to apply security enforcement: $_"
}
