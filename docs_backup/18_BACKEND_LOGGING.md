# Backend Logging & Debugging

TheVooDooBox Hyper-Bridge uses a hybrid logging approach: structured logging via the `env_logger` crate for technical stack traces, and prefixed console output for forensic sub-systems.

## ⚙️ Configuration: Logging Levels

Logging is controlled via the `RUST_LOG` environment variable in your `.env` or `docker-compose.yaml`.

### Available Levels
| Level | Description | Recommended For |
| :--- | :--- | :--- |
| `error` | Only critical failures. | Production |
| `warn` | Potential issues or non-fatal errors. | Production |
| `info` | General operational flow (Default). | General Use |
| `debug` | Detailed internal state and API responses. | Development |
| `trace` | Extremely granular data (very noisy). | Deep Issue Debugging |

To change the level, update your `.env`:
```bash
RUST_LOG=info
```
Then restart the services:
```bash
docker-compose restart hyper-bridge
```

---

## 📺 How to View Logs

Since the backend runs in a Docker container, use the standard Docker CLI tools.

### 1. Real-time Tail
To watch logs as they happen during an analysis:
```bash
docker logs -f voodoobox-hyper-bridge-1
```

### 2. Check Recent History
```bash
docker logs --tail 100 voodoobox-hyper-bridge-1
```

### 3. Grep for Specific Tasks
```bash
docker logs voodoobox-hyper-bridge-1 | grep "Task <YOUR_ID>"
```

---

## 🔍 Interpreting Logs

To help analysts quickly find relevant information, logs are prefixed by component:

| Prefix | Meaning | What to Look For |
| :--- | :--- | :--- |
| `[PROXMOX]` | API Communication with PVE. | Authentication errors or VM ID mismatches. |
| `[ORCHESTRATOR]` | The Sandbox lifecycle manager. | Failures during rollback or VM startup. |
| `[AGENT]` | Communication with Windows Guest. | Heartbeats and command acknowledgement. |
| `[TELEMETRY]` | Raw kernel event processing. | Real-time flow of process/file events. |
| `[SUBMISSION]` | File upload and hashing. | Verification of SHA256 and Storage pathing. |
| `[DATABASE]` | SQL/Postgres operations. | Duplicate key errors or connection timeouts. |
| `[SPICE_WS]` | WebSocket console relay. | TLS handshake failures or ticket expiration. |

## 🛠️ Common Log Patterns

### Healthy Detonation
```text
[ORCHESTRATOR] Starting analysis for Task 17000000 on VM 301
[ORCHESTRATOR] Step 1: Reverting to 'clean_sand' snapshot...
[ORCHESTRATOR] Step 2: Starting VM...
[AGENT] Agent connected: 192.168.1.50:51234
[ORCHESTRATOR] Session 192.168.1.50:51234 assigned to Task 17000000
[ORCHESTRATOR] Step 3.1: Sending detonation command to agent...
```

### Proxmox API Failure
```text
[PROXMOX] Failed to fetch VMs for node pve1: Connection refused (os error 111)
```

### Agent Timeout
```text
[ORCHESTRATOR] CRITICAL ERROR: No free agent connected within timeout. Aborting.
```
*Tip: Ensure the Windows Agent is set to auto-start on boot in the Gold Image.*
