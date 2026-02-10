# PowerShell Script to Force-Install Browser Extension in Chrome/Edge (Sideloading Unpacked)
# This script applies enterprise policies and registry entries to load the extension.

param (
    [string]$ExtensionPath = "C:\Mallab\agent-windows\browser_extension",
    # Deterministic ID generated from the key in manifest.json
    [string]$ExtensionId = "ihglmjmdikjkbobldkhidkbhldkhidkh" 
)

# Robust path detection: check relative path if default doesn't exist
if (-not (Test-Path $ExtensionPath)) {
    $RelativePath = Join-Path $PSScriptRoot "agent-windows\browser_extension"
    if (Test-Path $RelativePath) {
        $ExtensionPath = $RelativePath
    }
    elseif (Test-Path (Join-Path $PSScriptRoot "..\agent-windows\browser_extension")) {
        $ExtensionPath = (Join-Path $PSScriptRoot "..\agent-windows\browser_extension")
    }
}

if (-not (Test-Path $ExtensionPath)) {
    Write-Error "Extension path not found: $ExtensionPath. Please ensure the extension files are copied to the sandbox."
    exit 1
}

Write-Host "Configuring Chrome Policies..." -ForegroundColor Cyan
# 1. Allow Developer Mode (Required for unpacked sideloading via registry)
$ChromePolicyKey = "HKLM:\SOFTWARE\Policies\Google\Chrome"
if (-not (Test-Path $ChromePolicyKey)) { New-Item -Path $ChromePolicyKey -Force | Out-Null }
Set-ItemProperty -Path $ChromePolicyKey -Name "DeveloperModeAllowed" -Value 1 -Type DWord

# 2. Register External Extension (Direct Path)
$ChromeExtKey = "HKLM:\SOFTWARE\Google\Chrome\Extensions\$ExtensionId"
if (-not (Test-Path $ChromeExtKey)) { New-Item -Path $ChromeExtKey -Force | Out-Null }
Set-ItemProperty -Path $ChromeExtKey -Name "path" -Value $ExtensionPath
Set-ItemProperty -Path $ChromeExtKey -Name "version" -Value "1.0"

# 3. Force-Install Extension (Policy)
$ChromeForceKey = "HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist"
if (-not (Test-Path $ChromeForceKey)) { New-Item -Path $ChromeForceKey -Force | Out-Null }
# The format is "ExtensionId;UpdateUrl"
# For local unpacked extensions, use the path or a placeholder if using External Extensions registry
# Actually, for local unpacked via External Extensions registry, we just need it to be in the forcelist with a placeholder or the actual ID
Set-ItemProperty -Path $ChromeForceKey -Name "1" -Value "$($ExtensionId);https://clients2.google.com/service/update2/crx"

Write-Host "Configuring Edge Policies..." -ForegroundColor Cyan
# 1. Allow Developer Mode
$EdgePolicyKey = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
if (-not (Test-Path $EdgePolicyKey)) { New-Item -Path $EdgePolicyKey -Force | Out-Null }
Set-ItemProperty -Path $EdgePolicyKey -Name "DeveloperModeAllowed" -Value 1 -Type DWord

# 2. Register External Extension
$EdgeExtKey = "HKLM:\SOFTWARE\Microsoft\Edge\Extensions\$ExtensionId"
if (-not (Test-Path $EdgeExtKey)) { New-Item -Path $EdgeExtKey -Force | Out-Null }
Set-ItemProperty -Path $EdgeExtKey -Name "path" -Value $ExtensionPath
Set-ItemProperty -Path $EdgeExtKey -Name "version" -Value "1.0"

# 3. Force-Install Extension (Policy)
$EdgeForceKey = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"
if (-not (Test-Path $EdgeForceKey)) { New-Item -Path $EdgeForceKey -Force | Out-Null }
Set-ItemProperty -Path $EdgeForceKey -Name "1" -Value "$($ExtensionId);https://clients2.google.com/service/update2/crx"

Write-Host "Extension Policy Applied." -ForegroundColor Green
Write-Host "NOTE: You may need to restart the browser. In some environments, you must manually 'Enable' it once if it appears as 'Disabled (External Source)'." -ForegroundColor Yellow

