# PowerShell Script to Force-Install Browser Extension in Chrome/Edge
# Usage: .\install_browser_extension.ps1 -ExtensionId "acemimpy" -UpdateUrl "https://clients2.google.com/service/update2/crx"
# OR if local hosting is set up (more complex for force list), usually we pack it.
# For Development (Sideloading), we just launch with args.

# This script sets the Registry keys for enterprise policy installation (ForceInstall)

param (
    [string]$ExtensionId = "YOUR_EXTENSION_ID_HERE", 
    [string]$UpdateUrl = "https://clients2.google.com/service/update2/crx" # Default Web Store
)

Write-Host "Configuring Chrome Extension Policy..." -ForegroundColor Cyan
$ChromeKey = "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist"
if (-not (Test-Path $ChromeKey)) { New-Item -Path $ChromeKey -Force | Out-Null }
# Value Name is arbitrary (1, 2, ...), Value Data is "ID;UpdateURL"
Set-ItemProperty -Path $ChromeKey -Name "1" -Value "$ExtensionId;$UpdateUrl"

Write-Host "Configuring Edge Extension Policy..." -ForegroundColor Cyan
$EdgeKey = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"
if (-not (Test-Path $EdgeKey)) { New-Item -Path $EdgeKey -Force | Out-Null }
Set-ItemProperty -Path $EdgeKey -Name "1" -Value "$ExtensionId;$UpdateUrl"

Write-Host "Extension Policy Applied. Restart Browsers to take effect." -ForegroundColor Green
