# THE VOODOO BOX - INSTALLATION & LAUNCH WIZARD (V2)
# Updated to support Gemini 3 Flash

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$EnvFile = Join-Path $ProjectRoot ".env"
$EnvExample = Join-Path $ProjectRoot ".env_v2.example"
$GuestBundleDir = Join-Path $ProjectRoot "guest-setup"

function GetInput($Prompt, $Default) {
    if ($Default) {
        $InputVar = Read-Host "$Prompt [$Default]"
        if ([string]::IsNullOrWhiteSpace($InputVar)) { return $Default }
        return $InputVar
    }
    return Read-Host "$Prompt"
}

function WriteEnv($Key, $Value) {
    $Content = Get-Content $EnvFile
    $Pattern = "^$Key=.*"
    if ($Content -match $Pattern) {
        $Content = $Content -replace $Pattern, "$Key=$Value"
    }
    else {
        $Content += "$Key=$Value"
    }
    $Content | Set-Content $EnvFile
}

# --- 1. CONFIGURATION WIZARD ---
Write-Host "--- VoodooBox Setup ---" -ForegroundColor Cyan

if (-not (Test-Path $EnvFile)) {
    Write-Host "Creating .env from template..."
    Copy-Item $EnvExample $EnvFile
}

$CurrentOps = @{}
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)') {
        $CurrentOps[$matches[1]] = $matches[2]
    }
}

# -> Architecture Selection
Write-Host "`n[1] Architecture" -ForegroundColor Green
Write-Host "1. Single Node"
Write-Host "2. Distributed"
$ArchChoice = GetInput "Select" "1"

if ($ArchChoice -eq "1") {
    $HostIP = "localhost"
    $OllamaHost = "http://host.docker.internal:11434"
}
else {
    $DetectedIP = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias (Get-NetAdapter | Where-Object Status -eq Up).Name).IPAddress | Select-Object -First 1
    $HostIP = GetInput "Enter Host LAN IP" $DetectedIP
    $OllamaHost = GetInput "Enter Local AI URL (Llama.cpp/Ollama)" "http://$HostIP:11434"
}
WriteEnv "HOST_IP" $HostIP
WriteEnv "OLLAMA_URL" $OllamaHost
WriteEnv "EMBEDDING_URL" $OllamaHost

# -> AI Configuration
Write-Host "`n[2] AI Neural Core" -ForegroundColor Green
Write-Host "1. Llama.cpp / Ollama (Local)"
Write-Host "2. Gemini (Cloud)"
Write-Host "3. Hybrid (Recommended for Performance)"
$AIChoice = GetInput "Select Provider" "3"

if ($AIChoice -eq "1") {
    WriteEnv "AI_PROVIDER" "ollama"
    WriteEnv "AI_MODE" "local_only"
    Write-Host "Note: Llama.cpp is recommended over Ollama for better performance." -ForegroundColor Cyan
    $Model = GetInput "Model Name (e.g. llama-server)" "llama-server"
    WriteEnv "OLLAMA_MODEL" $Model
}
elseif ($AIChoice -eq "2") {
    WriteEnv "AI_PROVIDER" "gemini"
    WriteEnv "AI_MODE" "cloud_only"
    $Key = GetInput "Gemini API Key" $CurrentOps["GEMINI_API_KEY"]
    WriteEnv "GEMINI_API_KEY" $Key
}
elseif ($AIChoice -eq "3") {
    WriteEnv "AI_PROVIDER" "ollama"
    WriteEnv "AI_MODE" "hybrid"
    Write-Host "Note: Llama.cpp is recommended over Ollama for better performance." -ForegroundColor Cyan
    $Model = GetInput "Local Model Name" "llama-server"
    WriteEnv "OLLAMA_MODEL" $Model
    $Key = GetInput "Gemini API Key" $CurrentOps["GEMINI_API_KEY"]
    WriteEnv "GEMINI_API_KEY" $Key
}

# -> Proxmox
Write-Host "`n[3] Proxmox" -ForegroundColor Green
$ProxUrl = GetInput "Proxmox URL" $CurrentOps["PROXMOX_URL"]
WriteEnv "PROXMOX_URL" $ProxUrl

# --- 2. GUEST BUNDLE GENERATION ---
Write-Host "`n[*] Generating Guest Setup Bundle..." -ForegroundColor Yellow
if (-not (Test-Path $GuestBundleDir)) { New-Item -ItemType Directory -Path $GuestBundleDir | Out-Null }

# 2a. Find Agent Binary
$InternalBuild = Join-Path $ProjectRoot "agent-windows\target\release\voodoobox-agent-windows.exe"
$ReleaseBuild = Join-Path $ProjectRoot "releases\mallab-agent-windows.exe"
$DestBinary = Join-Path $GuestBundleDir "voodoobox-agent.exe"

if (Test-Path $InternalBuild) {
    Copy-Item $InternalBuild $DestBinary -Force
    Write-Host "+ Using Fresh Build"
}
elseif (Test-Path $ReleaseBuild) {
    Copy-Item $ReleaseBuild $DestBinary -Force
    Write-Host "+ Using Release Build"
}
else {
    Write-Host "! WARNING: No Agent Binary Found!" -ForegroundColor Red
}

# 2b. Copy Scripts
$ScriptSource = Join-Path $ProjectRoot "sandbox_scripts"
if (Test-Path $ScriptSource) {
    Copy-Item "$ScriptSource\*" $GuestBundleDir -Force -Recurse
    Write-Host "+ Copied Sandbox Scripts"
}

# 2c. Create Master Installer
$TemplatePath = Join-Path $ScriptSource "install_monitor_template.ps1"
$InstallerPath = Join-Path $GuestBundleDir "install_monitor_v2.ps1"

if (Test-Path $TemplatePath) {
    $TemplateContent = Get-Content $TemplatePath -Raw
    $NewContent = $TemplateContent -replace "{{SERVER_ADDR}}", "$HostIP`:9001"
    Set-Content -Path $InstallerPath -Value $NewContent
    Write-Host "+ Created install_monitor_v2.ps1"
}

# --- 3. LAUNCH ---
Write-Host "`n[4] Launch" -ForegroundColor Green
$Launch = GetInput "Start Docker Stack now? [Y/N]" "Y"
if ($Launch -eq "Y") {
    Write-Host "Starting Docker Compose..."
    docker-compose -f docker-compose_v2.yaml up -d --build
    Write-Host "`n[!] Stack Launched!" -ForegroundColor Cyan
    Write-Host "Dashboard: http://localhost:3000"
    Write-Host "Agent IP: $HostIP"
    Write-Host "Setup Complete."
}
