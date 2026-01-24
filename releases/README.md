# VOODOOBOX Windows Agent - Pre-built Binary

This directory contains pre-built binaries of the VOODOOBOX Windows Agent for easy deployment.

## Download

**Latest Release:** `voodoobox-agent-windows.exe`

## Quick Start (Persistence & Auto-Start)

We have provided a PowerShell script to automatically install the agent as a persistent service (Scheduled Task) that starts on login and restarts if closed.

1. **Copy Files to VM**:
   Copy the entire `releases` folder (or just `voodoobox-agent-windows.exe` and `install.ps1`) to your Windows VM (e.g., to `C:\Users\Public\Downloads`).

2. **Run Installer (As Admin)**:
   Open **PowerShell as Administrator** and run:
   ```powershell
   cd C:\Path\To\Files
   Set-ExecutionPolicy Bypass -Scope Process -Force
   .\install.ps1
   ```

   **This will:**
   - Prompt you for the **Hyper-Bridge IP address** (default: `192.168.50.196:9001`).
   - Create `C:\VoodooBox`.
   - Copy the agent binary and create a watchdog script (`agent_watchdog.ps1`).
   - Create a **Scheduled Task** ("VoodooBoxAgent") that runs with Highest Privileges on User Logon.
   - Start the agent immediately.

## Configuration

The agent creates a log file at `C:\VoodooBox\agent.log`.

To change the server address (default: `192.168.50.200:9001`), you may need to edit the `agent_watchdog.ps1` created in `C:\VoodooBox` to set the environment variable before starting the process.

## Manual Execution (Testing)

If you just want to test without installing:

```powershell
$env:AGENT_SERVER_ADDR = "192.168.50.200:9001"
.\voodoobox-agent-windows.exe
```

## Building from Source

To rebuild the binary:

```powershell
cd agent-windows
cargo build --release
copy target\release\voodoobox-agent-windows.exe ..\releases\
```
