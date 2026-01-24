# Mallab Windows Agent Guide

The **Mallab Windows Agent** is the telemetry collector that runs inside your sandbox VMs.

## 🚀 Features
- **Real-time Monitoring**: Streams process, file, and network events.
- **Remote Control**: Execute commands directly from the Analyst Console.
- **Kernel Integration**: Works seamlessly with "The Eye" driver for deep visibility.

## 📦 Building the Agent

Building requires the Rust toolchain.

```powershell
# Navigate to the agent directory
cd agent

# Build for Windows
cargo build --release --target x86_64-pc-windows-msvc
```

The binary will be located at `target/x86_64-pc-windows-msvc/release/mallab-agent-windows.exe`.

## 🚚 Deployment

1. **Transfer**: Copy the compiled `.exe` and the scripts in `scripts/guest/` to your VM.
2. **Setup**: Run the installation script inside the guest VM:
   ```powershell
   .\scripts\guest\install_agent.ps1 -ServerIP "<Host_IP>" -ServerPort 9001
   ```

## ⚙️ Configuration

The agent looks for a `config.json` in its local directory:

```json
{
  "server_addr": "192.168.1.100:9001",
  "auto_reconnect": true,
  "watch_paths": ["C:\\Windows\\Temp", "C:\\Users\\Public"]
}
```

## 🛠️ Remote Commands
Analysts can send the following commands via the UI or API:
- `KILL <PID>`: Terminate a malicious process.
- `EXEC_BINARY <Path> [Args]`: Run a specific tool or binary.
- `DOWNLOAD_EXEC <URL> <Filename>`: Orchestrator command to fetch and detonate a sample.
- `EXEC_URL <URL>`: Open a URL in the default browser.
- `SCREENSHOT`: Capture and upload a live screenshot of the guest desktop.
- `UPLOAD_PIVOT <Path>`: Retrieve a file from the guest for analysis.

## 📊 Event Types
The agent streams the following events in real-time:
- `SESSION_INIT`: Agent handshake and identity verification.
- `PROCESS_CREATE`: New process started (with SHA256 of executable).
- `NETWORK_CONNECT`: Outbound TCP connection established.
- `NETWORK_DNS`: DNS query resolution detected.
- `LATERAL_MOVEMENT`: Connections to sensitive ports (SMB, RDP, etc.).
- `FILE_CREATE` / `FILE_MODIFY`: File system activity in watched paths.
- `DOWNLOAD_DETECTED`: Files created in the Downloads folder.
- `REGISTRY_SET`: Persistence mechanisms detected in Run/RunOnce keys.
- `MEMORY_ANOMALY`: Evidence of process hollowing or injection.
