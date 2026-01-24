param (
    [string]$ServerAddr = ""
)

$ErrorActionPreference = "Stop"

# Interactive Configuration
if ($ServerAddr -eq "") {
    Write-Host ""
    $DefaultIP = "192.168.1.100:9001"
    $InputIP = Read-Host "Please enter the Agent Server Address (Enter for default: $DefaultIP)"
    if ($InputIP -eq "") {
        $ServerAddr = $DefaultIP
    }
    else {
        $ServerAddr = $InputIP
    }
    Write-Host "[*] Using Server Address: $ServerAddr"
    Write-Host ""
}

# Configuration
$InstallDir = "C:\Mallab"
$AgentExe = "mallab-agent-windows.exe"
$WatchdogScript = "agent_watchdog.ps1"
$TaskName = "MallabAgent"

# 1. Create Installation Directory
Write-Host "[*] Creating install directory: $InstallDir"
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

# 2. Copy Executable
Write-Host "[*] Copying agent binary..."
if (Test-Path $AgentExe) {
    Copy-Item -Path $AgentExe -Destination "$InstallDir\$AgentExe" -Force
}
else {
    Write-Error "Could not find $AgentExe in current directory. Please run this script from the same folder as the agent binary."
}

# 3. Create Watchdog Script
Write-Host "[*] Creating watchdog script..."
$EnvSetting = ""
if ($ServerAddr -ne "") {
    $EnvSetting = "`$env:AGENT_SERVER_ADDR = `"$ServerAddr`""
}

$WatchdogContent = @"
`$AgentPath = "$InstallDir\$AgentExe"
`$LogPath = "$InstallDir\agent.log"

function Log-Message {
    param(`$Message)
    `$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path `$LogPath -Value "[`$Timestamp] `$Message"
}

Log-Message "Watchdog started."

# Server Configuration
$EnvSetting

while (`$true) {
    `$proc = Get-Process -Name "mallab-agent-windows" -ErrorAction SilentlyContinue
    if (-not `$proc) {

        Log-Message "Agent not found. Starting..."
        try {
            Start-Process -FilePath `$AgentPath -WindowStyle Hidden -WorkingDirectory "$InstallDir"
        } catch {
            Log-Message "Error starting agent: `$_"
        }
    }
    Start-Sleep -Seconds 5
}
"@
Set-Content -Path "$InstallDir\$WatchdogScript" -Value $WatchdogContent

# 4. Create Scheduled Task
# Critical: Run only when user is logged on (to access GUI/Interactive Session)
# Run with Highest Privileges (Admin)
Write-Host "[*] Creating Scheduled Task '$TaskName'..."

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallDir\$WatchdogScript`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Principal = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Administrators" -RunLevel Highest

# Unregister if exists
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Register
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal
# Configure Settings to allow running on demand and not stopping if running long
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0) -Priority 4

Set-ScheduledTask -TaskName $TaskName -Settings $Settings

Write-Host "[+] Installation Complete!"
Write-Host "[*] Starting the persistent service task now..."
Start-ScheduledTask -TaskName $TaskName

Write-Host "[+] Agent is running. You can check C:\Mallab\agent.log for status."
