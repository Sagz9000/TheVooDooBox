# Architecture & Logic

TheVooDooBox operates on a highly efficient "Stream-Analysis" architecture, separated into three distinct layers: The Guest Agent (Kernel), The Host Bridge (Backend), and The Analyst Interface (Frontend).

## Logical Data Flow

```mermaid
graph TD
    subgraph "Guest VM (Windows 10)"
        Kernel[Windows Kernel]
        Driver["'The Eye' (Kernel Driver)"]
        Sysmon[Sysmon Service]
        Agent[VoodooBox Agent Service]
        VirtIO[VirtIO Serial Port]

        Kernel -- "Callback Events" --> Driver
        Kernel -- "Event Logs" --> Sysmon
        Sysmon -- "Forensic JSON" --> Agent
        Driver -- "Raw Event Structs" --> VirtIO
        Agent -- "Heartbeats & Commands" --> VirtIO
    end

    subgraph "Host Server (Dockerized)"
        Socket[QEMU Guest Socket]
        Bridge["Hyper-Bridge (Rust)"]
        DB[(PostgreSQL)]
        Ghidra[Ghidra Service]

        VirtIO -- "Unix Domain Socket (Out-of-Band)" --> Socket
        Socket -- "Byte Stream" --> Bridge
        Bridge -- "Persist Events" --> DB
        Bridge -- "Tasks" --> Ghidra
    end

    subgraph "Analyst Frontend"
        API[WebSocket API]
        UI[React Dashboard]
        
        Bridge -- "JSON/WS Events" --> API
        API --> UI
    end
```

## Component Details

### 1. "The Eye" (Kernel Anti-Tamper)
*   **Role**: **Self-Protection Only**.
*   **Mechanism**: Uses `IOCTL_PROTECT_PROCESS` to prevent the Agent service from being terminated by malware.
*   **Telemetry Source**: The User-Mode Agent consumes **Sysmon** events for process creation and network activity, ensuring stability and compatibility.

### 2. Transport Modes: In-Band vs. Out-of-Band
    ```c
    typedef struct _DRIVER_EVENT {
        ULONG EventType;      // 0=ProcCreate, 1=NetConnect, 2=RegSet
        ULONG ProcessId;
        ULONG ParentId;
        WCHAR Details[256];   // Fixed size buffer for zero-copy speed
        LARGE_INTEGER Timestamp;
    } DRIVER_EVENT;
    ```

### 2. Transport Modes: In-Band vs. Out-of-Band
TheVooDooBox supports two primary communication channels between the Guest Agent and the Hyper-Bridge:

*   **In-Band (TCP/IP)**: The default configuration. The Agent connects to the backend over a standard network interface (e.g., `192.168.1.1:9001`). This is simple to setup but visible to advanced malware monitoring the network stack.
*   **Out-of-Band (VirtIO Serial)**: The "Gold Standard" for stealth. Communication occurs over a virtual serial hardware device.
    *   **Bypasses `tcpip.sys`**: Data never enters the Windows network stack.
    *   **Hardware Layer**: QEMU/VirtIO maps the Guest's serial port to a Unix Domain Socket on the host. 
    *   **Stealth**: Telemetry traffic is invisible to packet sniffers (Wireshark) and firewall logs within the VM.

### 3. Hyper-Bridge (Backend)
*   **Tech Stack**: Rust (Actix-Web, Tokio, SQLx).
*   **Concurrency**: Uses a centralized `EventBus` (Tokio Broadcast Channel) to fan-out kernel events to:
    1.  **WebSocket Actors**: Connected frontend clients.
    2.  **Database Writer**: Async buffering to Postgres.
    3.  **AI Analyzer**: Triggered on threshold events.

## Database Schema (`voodoobox` DB)

### `tasks` Table
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary Key |
| `status` | VARCHAR | `pending`, `running`, `completed` |
| `verdict` | VARCHAR | `malicious`, `suspicious`, `benign` |
| `risk_score` | INT | 0-100 |

### `analysis_reports` Table
Stores the final output of the AI Analyst.
| Column | Type | Description |
|--------|------|-------------|
| `task_id` | UUID | Foreign Key -> tasks.id (Unique) |
| `risk_score` | INT | 0-100 |
| `threat_level` | VARCHAR | BENIGN, SUSPICIOUS, MALICIOUS |
| `summary` | TEXT | Executive Summary (AI generated) |
| `suspicious_pids` | INT[] | List of PIDs involved in the attack chain |
| `mitre_tactics` | TEXT[] | e.g. ["Persistence", "Privilege Escalation"] |
| `forensic_report_json`| JSONB | Full structured report (timeline, artifacts) |

## API Specifications

### REST Endpoints (`/api`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/tasks` | Submit a new file for analysis. Body: Multipart form. |
| `GET` | `/tasks` | List recent analysis tasks. |
| `GET` | `/tasks/{id}` | Get status and metadata for a specific task. |
| `POST` | `/tasks/{id}/analyze` | Trigger manual AI analysis for a running/completed task. |
| `GET` | `/tasks/{id}/ai-report` | Fetch the generated AI report. |
| `GET` | `/tasks/{id}/ghidra` | Fetch static analysis findings (functions, strings). |

### WebSocket (`/ws`)
*   **Protocol**: JSON-over-WS
*   **Events**:
    *   `TELEMETRY`: Real-time kernel event (Process, Network, File).
    *   `AGENT_STATUS`: Heartbeat from the VM agent (Idle, Busy, Error).
    *   `CONSOLE_LOG`: Standard output from the guest instrumentation.

### 4. Frontend Dashboard
*   **Language**: React, TypeScript, TailwindCSS
*   **Role**: A single-page application (SPA) that combines the VNC video stream with the scrolling telemetry log and AI analysis panels.

> [!NOTE]
> For a deep dive into how remote console sessions are proxied between the browser and Proxmox, see [VNC & SPICE Integration](10_VNC_SPICE_INTEGRATION.md).
