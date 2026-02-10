# Sandbox & Agent Internals

The "Arena" is a strictly controlled Windows environment monitored by a custom Agent and Kernel Driver.

## 1. Virtualization Hardware

### Host-Guest Interface
We utilize **VirtIO Serial** for all communication. This bypasses the network stack, remaining invisible to malware firewall rules and avoiding standard network noise.

*   **Channel Name**: `voodoobox.agent`
*   **Host Socket**: `/var/run/qemu/voodoobox.sock`
*   **Guest Device**: `\\.\Global\VirtIO_Serial_Port0`

## 2. VoodooBox Agent Protocol

The Agent communicates via a strict JSON protocol over the serial link.

### Message Structure
```json
{
  "type": "HEARTBEAT" | "TASK" | "ERROR",
  "payload": { ... }
}
```

### Protocol Flow

#### 1. Handshake (Agent -> Host)
Every 5 seconds, the Agent sends:
```json
{
  "type": "HEARTBEAT",
  "payload": {
    "status": "IDLE", 
    "ip": "10.0.0.10",
    "agent_version": "3.0.0"
  }
}
```

#### 2. Detonation Command (Host -> Agent)
To start analysis, the backend sends:
```json
{
  "type": "EXECUTE_FILE",
  "payload": {
    "file_name": "malware.exe",
    "file_url": "http://10.0.0.2:8000/download/sample",
    "arguments": "--silent",
    "timeout_seconds": 60
  }
}
```

#### 3. Execution (Agent Logic)
1.  **Download**: Fetches file from `file_url` (Host-Only Network).
2.  **Drop**: Saves to `C:\Users\Public\malware.exe`.
3.  **Kernel Mark**: Calls driver IOCTL to "mark" the PID of the new process.
4.  **Spawn**: Launches process via `CreateProcess`.
5.  **Monitor**: Returns `EXECUTION_STARTED` event.

## 3. "The Eye" Kernel Driver (`voodoobox_eye.sys`)

### Architecture
*   **Type**: Kernel Mode Driver Framework (KMDF)
*   **Role**: Anti-Tamper / Self-Protection
*   **IOCTL Interface**: `0x222003` (Protect PID)

### Anti-Tamper Mechanism
The driver registers a `Prevent Termination` lock on the Agent process. It intercepts process handle requests and strips the `PROCESS_TERMINATE` and `PROCESS_VM_WRITE` access rights from any process attempting to interact with the Agent. This ensures that even "System" level malware cannot kill the monitoring agent.

### Why No Kernel Telemetry?
While custom kernel telemetry is powerful, it is also unstable. For V3, we rely on **Sysmon** (System Monitor) for event collection. This provides:
1.  **Stability**: Microsoft-signed driver reliability.
2.  **Richness**: Native DNS, Network, and Registry correlation.
3.  **Safety**: Reduced risk of Blue Screens (BSOD) during analysis.

## 4. Native Agent Telemetry
While Sysmon handles high-volume event tracing, the Agent performs specialized forensic tasks natively:

*   **File Hashing**: The agent watches critical paths (e.g., `Downloads`, `Temp`) and calculates SHA256 hashes for every new file.
*   **Registry Persistence**: Periodically polls high-value AutoRun keys (`HKLM\...\Run`) to detect persistence mechanisms that rely on simply setting a value.
*   **Visual Capture**: Takes periodic screenshots of the desktop to capture ransomware notes or error dialogs.
*   **DNS Snapshots**: Captures the state of the Windows DNS Cache to identify domains that may have been queried before monitoring started.
*   **Deep Browser Instrumentation**: A specialized module that captures full DOM snapshots from Edge/Chrome via a dedicated browser extension. This allows forensic analysts to see exactly what the victim saw, even if the payload was delivered via a `blob:` URL or temporary DOM object.
*   **Auto-Decoder Engine**: The agent now features a high-performance scanning module that identifies Base64, XORed, and otherwise obfuscated strings in real-time across all monitored telemetry.

## 5. Forensic Instrumentation (Sysmon)

**Sysmon is the primary telemetry source for TheVooDooBox.** The user-mode agent subscribes to the `Microsoft-Windows-Sysmon/Operational` event channel and forwards events in real-time.

### Installation
Sysmon must be installed in the Guest VM during the "Golden Image" preparation phase.
1. Copy `sandbox_scripts/install_sysmon.ps1` and `sandbox_scripts/sysmon_config.xml` to the VM.
2. Run `install_sysmon.ps1` as Administrator.
   * This script downloads the latest Sysmon from Microsoft Sysinternals.
   * It installs `Sysmon64.exe` using our custom security-focused configuration.

### Configuration (`sysmon_config.xml`)
Our configuration is optimized for malware analysis:
*   **Process Creation**: Captured for all non-system processes.
*   **Network Connections**: Tracked to identify C2 traffic.
*   **Remote Threads**: Monitored to detect process injection (e.g., hollowing).
*   **File Deletion**: Monitored to catch self-deletion attempts.

## 6. Future Roadmap: Path to Kernel Independence

Currently, TheVooDooBox uses a "Hybrid" approach (Path A):
*   **Sysmon**: Telemetry
*   **Custom Driver**: Self-Protection

Our long-term goal is **Path B**: A fully custom Kernel Driver that handles *both* protection and telemetry via native callbacks (`PsSetCreateProcessNotifyRoutineEx`, `ObRegisterCallbacks`).
*   **Why**: To remove the dependency on Sysmon, which sophisticated malware can fingerprint and evade.
*   **Goal**: "God Mode" visibility with zero user-mode dependencies.

### Telemetry Strategy Comparison

| Feature | **Path A: Keep Current (Sysmon)** | **Path B: Build Custom (Kernel Callbacks)** |
| :--- | :--- | :--- |
| **Development** | **Already working.** Robust and stable. | **Extremely Hard.** Writing `unsafe` Rust kernel code is prone to Blue Screens (BSOD). |
| **Stability** | High. Sysmon is a Microsoft-signed driver. | Moderate/Low. A bug in our driver crashes the whole VM. |
| **Stealth** | Lower. Malware knows how to look for Sysmon. | Higher. A custom driver is harder to fingerprint. |
| **Complexity** | User-Mode Agent parses logs (Easy). | Driver must manage memory buffers and IRQL levels (Hard). |
