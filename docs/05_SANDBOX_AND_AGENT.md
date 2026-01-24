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

## 3. "The Eye" Kernel Driver (`voodoobox-eye.sys`)

### Architecture
*   **Type**: Minifilter + Legacy Device Driver
*   **IOCTL Interface**: `0x80002000` (Register PID), `0x80002004` (Stop Monitoring).

### Event Collection
The driver pushes events to a ring buffer shared with the user-mode Agent.

#### Captured Event Types

| ID | Name | Trigger |
|----|------|---------|
| 1 | `PROCESS_CREATE` | `PsSetCreateProcessNotifyRoutineEx` |
| 2 | `THREAD_CREATE` | `PsSetCreateThreadNotifyRoutine` |
| 3 | `IMAGE_LOAD` | `PsSetLoadImageNotifyRoutine` |
| 4 | `REGISTRY_SET` | `CmRegisterCallback` (RegNtPreSetValueKey) |
| 5 | `FILE_CREATE` | Minifilter `IRP_MJ_CREATE` |

### Kernel-to-User Transport
The driver exposes a device object `\\.\Global\VoodooBoxEye`. The Agent reads from this device and forwards the raw bytes immediately to the VirtIO serial port.

### Evasion Resistance
*   **ObCallback**: Protects the Agent process from being terminated by malware (strips `PROCESS_TERMINATE` rights).
*   **Direct I/O**: Does not use Windows Event Tracing (ETW), protecting against "ETW Patching" techniques common in modern malware.

## 4. Forensic Instrumentation (Sysmon)

While "The Eye" provides deep kernel telemetry, we complement it with **Sysmon** for high-level event correlation (DNS, Registry, File Creation).

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
*   **DNS Queries**: Logged to capture domain-based C2.
*   **File Deletion**: Monitored to catch self-deletion attempts.
