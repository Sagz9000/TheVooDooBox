# TheVooDooBox Windows Agent - Complete Deployment Workflow

## Overview
This guide covers **three deployment methods** for getting the TheVooDooBox Windows Agent running in your sandbox VM.

---

## 🎯 Method 1: Build on Windows (Recommended)

### Prerequisites
1. **Install Rust** (one-time setup):
   ```powershell
   # Download and run the installer
   Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe
   .\rustup-init.exe
   
   # Restart PowerShell, then verify
   cargo --version
   rustc --version
   ```

2. **Install Windows Build Tools** (if not already present):
   ```powershell
   # Visual Studio Build Tools (required for linking)
   # Download from: https://visualstudio.microsoft.com/downloads/
   # Select "Desktop development with C++" workload
   ```

### Build Steps
```powershell
# Navigate to agent directory
cd C:\AntiCode\TheVooDooBox\TheVooDooBox-main\agent-windows

# Build release binary
cargo build --release

# Binary location
# C:\AntiCode\TheVooDooBox\target\release\voodoobox-agent-windows.exe
```

### Deploy to VM
```powershell
# Option A: Copy via network share
Copy-Item target\release\voodoobox-agent-windows.exe \\VM-IP\C$\TheVooDooBox\

# Option B: Copy via RDP clipboard
# 1. RDP into the VM
# 2. Copy the .exe file
# 3. Paste into C:\TheVooDooBox\ on the VM

# Option C: Use the install script
.\TheVooDooBox-main\scripts\install_agent.ps1 -ServerIP "192.168.1.1"
```

---

## 🐧 Method 2: Cross-Compile from Linux/WSL

### Prerequisites (Linux/WSL)
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Add Windows target
rustup target add x86_64-pc-windows-gnu

# Install MinGW cross-compiler
sudo apt-get install mingw-w64
```

### Build Steps
```bash
cd /mnt/c/AntiCode/TheVooDooBox/TheVooDooBox-main/agent-windows

# Cross-compile for Windows
cargo build --release --target x86_64-pc-windows-gnu

# Binary location
# target/x86_64-pc-windows-gnu/release/voodoobox-agent-windows.exe
```

### Deploy to VM
```bash
# Copy to Windows host first
cp target/x86_64-pc-windows-gnu/release/voodoobox-agent-windows.exe /mnt/c/Temp/

# Then use PowerShell to transfer to VM (see Method 1)
```

---

## 🚀 Method 3: Use Pre-Built Binary (Quick Start)

If you don't want to build from source, I can provide a pre-built binary.

### Download & Deploy
```powershell
# Download pre-built agent (example - replace with actual URL)
Invoke-WebRequest -Uri "https://github.com/Sagz9000/TheVooDooBox/releases/download/v3.0.0/voodoobox-agent-windows.exe" -OutFile voodoobox-agent.exe

# Transfer to VM and install
.\TheVooDooBox-main\scripts\install_agent.ps1 -ServerIP "192.168.1.1"
```

---

## 📦 Automated Installation Script (Persistence)

A script is provided to setup the agent as a persistent service on the VM:

1. Copy the `releases/` folder (containing `voodoobox-agent-windows.exe` and `install.ps1`) to the VM.
2. Run the installer as Administrator:

```powershell
# Run inside the Windows VM (Powershell Admin)
cd C:\Path\To\Files
.\install.ps1
```

**What it does:**
1. Creates `C:\TheVooDooBox` directory
2. Copies the agent binary
3. Creates a **Watchdog Script** (`agent_watchdog.ps1`) to ensure the agent is always running.
4. Registers a **Scheduled Task** ("VooDooBoxAgent") to start the watchdog on User Logon with High Privileges.
5. Starts the service immediately.

---

## 🧪 Testing the Agent

### Manual Test (Before Installation)
```powershell
# Inside the VM
cd C:\TheVooDooBox

# Set server address
$env:AGENT_SERVER_ADDR = "192.168.1.1:9001"

# Run agent
.\voodoobox-agent.exe
```

**Expected Output:**
```
TheVooDooBox Windows Agent (Active Eye) - v3.0.0
Connected to Hyper-Bridge @ 192.168.1.1:9001
```

## 4. Automated Testing (Agent Mock)
For development without a live VM, use the **Agent Mock**. This Rust service simulates a connected Windows Guest, sending fake heartbeats and telemetry to the backend.

### Running the Mock
1.  **Direct Run**:
    ```bash
    cd agent-mock
    cargo run
    ```
    *   Configured to connect to `localhost:9001` by default.
2.  **Docker**:
    Uncomment the `mock-agent` service in `docker-compose.yaml` to spin it up automatically with the stack.

### Verify Backend Connection
On your host machine, check the Hyper-Bridge logs:
```bash
docker logs voodoobox-hyper-bridge-1 --tail 50
```

You should see:
```
Agent connected: <VM_IP>:<PORT>
```

### Verify UI Stream
1. Open the TheVooDooBox UI: http://localhost:3000
2. Navigate to **Analysis Arena** or **Logs**
3. Run a program in the VM (e.g., `notepad.exe`)
4. You should see `PROCESS_CREATE` events appear in real-time

---

## 🔧 Troubleshooting

### Build Errors

**Error: `linker 'link.exe' not found`**
```powershell
# Install Visual Studio Build Tools
# https://visualstudio.microsoft.com/downloads/
# Select "Desktop development with C++"
```

**Error: `could not find system library 'windows'`**
```bash
# On Linux: Install MinGW
sudo apt-get install mingw-w64
```

### Connection Errors

**Agent shows: `Connection refused`**
```powershell
# Check if Hyper-Bridge is running
docker ps | grep hyper-bridge

# Verify network connectivity from VM
Test-NetConnection -ComputerName 192.168.1.1 -Port 9001

# Check firewall rules ON HOST (Admin PowerShell)
New-NetFirewallRule -DisplayName "TheVooDooBox Agent Listener" -Direction Inbound -LocalPort 9001 -Protocol TCP -Action Allow
```

**No events appearing in UI**
```powershell
# Verify agent is running
Get-Process voodoobox-agent

# Check agent output for errors
# Run manually to see console output

# Ensure VM has activity
notepad.exe  # Should trigger PROCESS_CREATE event
```

### Performance Issues

**High CPU usage**
```json
// Edit C:\TheVooDooBox\config.json
{
  "scan_interval_sec": 10  // Increase from 4 to 10 seconds
}
```

**Too many events**
```json
// Reduce watched directories
{
  "watch_paths": [
    "C:\\Windows\\Temp"  // Only watch critical paths
  ]
}
```

---

## 🎯 Recommended Workflow

### For Development/Testing
1. Use **Method 1** (build on Windows) for fastest iteration
2. Test manually before installing
3. Use auto-start only after confirming stability

### For Production Deployment
1. Build once using **Method 1** or **Method 2**
2. Create a **golden snapshot** with agent pre-installed
3. Use that snapshot as the base for all analysis VMs
4. Agent auto-starts on every VM boot

### For Quick Demo
1. Use **Method 3** (pre-built binary)
2. Manual installation and testing
3. Upgrade to full build later

---

## 📋 Next Steps

After successful deployment:

1. **Test Remote Execution**
   - Use the ExecutionPanel in the UI
   - Execute a test binary: `C:\Windows\System32\calc.exe`
   - Open a test URL: `https://example.com`

2. **Test AI Analysis**
   - Collect some process/event data
   - Click "Run AI Threat Analysis"
   - Verify Ollama integration works

3. **Create Golden Snapshot**
   - Install the agent
   - Verify it auto-starts
   - Create a Proxmox snapshot named `GOLD_IMAGE_WITH_AGENT`
   - Use this for all future analysis sessions

4. **Integrate with Workflow**
   - Submit samples via the Task Dashboard
   - Monitor in real-time via Analysis Arena
   - Review historical data in the Logs view

---

## 🔐 Security Notes

- Agent runs with **SYSTEM** privileges
- All communication is **unencrypted** (use isolated network)
- Agent can execute **arbitrary binaries** via remote commands
- Only deploy in **sandbox/isolated environments**
- Consider using the **kernel driver** for anti-tamper protection

---

## 📚 Additional Resources

- **Full Deployment Guide**: `docs/13_AGENT_DEPLOYMENT.md`
- **Build Script**: `TheVooDooBox-main/scripts/build_agent.ps1`
- **Install Script**: `TheVooDooBox-main/scripts/install_agent.ps1`
- **Ollama Testing**: `docs/15_OLLAMA_TESTING.md`
