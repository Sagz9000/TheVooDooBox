# TheVooDooBox Windows Agent - Deployment Guide

## Overview
The **TheVooDooBox Windows Agent** is a lightweight telemetry collector that runs inside your Windows sandbox VMs. It streams real-time process, file, network, and memory events to the Hyper-Bridge backend for analysis.

## Features
- **Process Monitoring**: Detects new processes, terminations, and suspicious parent-child relationships
- **File System Watching**: Monitors critical directories for malware activity
- **Network Telemetry**: Tracks TCP connections and flags lateral movement attempts
- **Memory Forensics**: Scans for process hollowing and code injection
- **Kernel-Level Protection**: Optional anti-tamper driver integration
- **Remote Execution**: Execute binaries and open URLs from the analyst console

## Architecture
```
┌─────────────────────────────────────────┐
│   Windows Sandbox VM (Proxmox)         │
│  ┌───────────────────────────────────┐  │
│  │  TheVooDooBox Agent (Rust)        │  │
│  │  - Process Monitor                │  │
│  │  - File Watcher                   │  │
│  │  - Network Scanner                │  │
│  │  - Memory Forensics               │  │
│  └───────────────┬───────────────────┘  │
│                  │ TCP Stream           │
│                  │ (Port 9001)          │
└──────────────────┼──────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│   Hyper-Bridge (Docker Container)       │
│   - Event Aggregation                   │
│   - WebSocket Broadcast                 │
│   - PostgreSQL Persistence              │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│   Frontend (React)                       │
│   - Real-time Event Stream              │
│   - Process Tree Visualization          │
│   - Remote Command Execution            │
└──────────────────────────────────────────┘
```

## Prerequisites
1. **Rust Toolchain** (for building)
   ```powershell
   # Install from https://rustup.rs
   rustup target add x86_64-pc-windows-msvc
   ```

2. **Windows VM** (Proxmox or local)
   - Windows 10/11 (x64)
   - Network access to Hyper-Bridge server
   - Administrator privileges

3. **Hyper-Bridge Backend** (running)
   - Listening on port `9001` for agent connections
   - Accessible from the VM network

## Quick Start

### Step 1: Build the Agent
From the project root on your **build machine** (can be Windows, Linux, or macOS):

```powershell
# Windows
.\scripts\build_agent.ps1 -BuildType release

# Linux/macOS
cd agent-windows
cargo build --release --target x86_64-pc-windows-msvc
```

The compiled binary will be at:
```
target/x86_64-pc-windows-msvc/release/voodoobox-agent-windows.exe
```

### Step 2: Deploy to Sandbox VM
Copy the binary to your Windows VM, then run the installation script **inside the VM**:

```powershell
# Transfer the binary and scripts to the VM
# Then, inside the VM:
.\scripts\install_agent.ps1 -ServerIP "192.168.50.1" -ServerPort 9001 -AutoStart
```

**Parameters:**
- `ServerIP`: IP address of the Hyper-Bridge server (default: `192.168.50.1`)
- `ServerPort`: TCP port for agent connections (default: `9001`)
- `InstallPath`: Installation directory (default: `C:\TheVooDooBox`)
- `AutoStart`: Configure as Windows service/scheduled task (default: `$true`)

### Step 3: Verify Connection
Check the Hyper-Bridge logs:
```bash
docker logs voodoobox-hyper-bridge-1
```

You should see:
```
Agent connected: <VM_IP>:<PORT>
```

In the frontend UI, you should start seeing real-time events in the telemetry stream.

## Manual Execution (Testing)
For quick testing without installation:

```powershell
# Set the server address
$env:AGENT_SERVER_ADDR = "192.168.50.1:9001"

# Run the agent
.\voodoobox-agent-windows.exe
```

## Configuration
The agent can be configured via environment variables or a `config.json` file:

**Environment Variables:**
- `AGENT_SERVER_ADDR`: Server address (e.g., `192.168.50.1:9001`)

**config.json** (optional):
```json
{
  "server_addr": "192.168.50.1:9001",
  "auto_reconnect": true,
  "scan_interval_sec": 4,
  "watch_paths": [
    "C:\\Windows\\Temp",
    "C:\\Users\\Public\\Downloads",
    "C:\\ProgramData"
  ]
}
```

## Remote Commands
The agent supports the following commands from the Hyper-Bridge:

### 1. Kill Process
```json
{
  "command": "KILL",
  "pid": 1234
}
```

### 2. Execute Binary
```json
{
  "command": "EXEC_BINARY",
  "path": "C:\\Tools\\sample.exe",
  "args": ["--flag", "value"]
}
```

### 3. Open URL
```json
{
  "command": "EXEC_URL",
  "url": "https://malicious-site.com"
}
```

These commands can be triggered from the **Analysis Arena** in the web UI.

## Event Types
The agent streams the following event types:

| Event Type | Description |
|------------|-------------|
| `PROCESS_CREATE` | New process started |
| `PROCESS_TERMINATE` | Process killed (manual or remote) |
| `FILE_CREATE` | File created in watched directory |
| `FILE_MODIFY` | File modified |
| `FILE_DELETE` | File deleted |
| `NETWORK_CONNECT` | TCP connection established |
| `LATERAL_MOVEMENT` | Connection to RDP/SMB/WinRM ports |
| `MEMORY_ANOMALY` | Process hollowing detected |
| `EXEC_SUCCESS` | Remote binary execution succeeded |
| `EXEC_ERROR` | Remote binary execution failed |
| `URL_OPEN` | URL opened in browser |

## Kernel Driver (Optional)
For enhanced anti-tamper protection, you can deploy the TheVooDooBox kernel driver:

1. Build the driver (requires WDK):
   ```powershell
   cd kernel-driver
   msbuild TheVooDooBoxFilter.sln /p:Configuration=Release
   ```

2. Install the driver:
   ```powershell
   sc create TheVooDooBoxFilter type=kernel binPath=C:\TheVooDooBox\TheVooDooBoxFilter.sys
   sc start TheVooDooBoxFilter
   ```

The agent will automatically detect and use the kernel bridge if available.

## Troubleshooting

### Agent won't connect
- Verify network connectivity: `Test-NetConnection -ComputerName 192.168.50.1 -Port 9001`
- Check firewall rules on both VM and host
- Ensure Hyper-Bridge is running: `docker ps | grep hyper-bridge`

### No events appearing
- Check if the agent is running: `Get-Process voodoobox-agent`
- Verify the agent logs (console output)
- Ensure the VM has activity (run a program, create a file)

### High CPU usage
- Reduce scan interval in config (default: 4 seconds)
- Limit watched directories
- Disable memory forensics if not needed

## Uninstallation
```powershell
# Stop and remove scheduled task
Unregister-ScheduledTask -TaskName "VooDooBoxAgent" -Confirm:$false

# Remove installation directory
Remove-Item -Path "C:\TheVooDooBox" -Recurse -Force
```

## Security Considerations
- The agent runs with **SYSTEM** privileges for full visibility
- All communication is **unencrypted** (use VPN/isolated network)
- The agent can execute arbitrary binaries via remote commands
- Only deploy in **isolated sandbox environments**

## Next Steps
- Integrate with the **Analysis Arena** UI for interactive analysis
- Configure **AI-powered threat detection** via the Hyper-Bridge
- Create **golden snapshots** with the agent pre-installed
- Set up **automated sample submission** workflows
