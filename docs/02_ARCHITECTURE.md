# TheVooDooBox System Architecture

## 1. High-Level Design

TheVooDooBox is a **hybrid forensic platform** that acts as an orchestration layer between a secure, isolated sandbox environment and a modern AI analysis engine. It is built to be **self-hosted**, **offline-capable**, and **modular**.

### System Context Diagram

```mermaid
C4Context
    title System Context Diagram for TheVooDooBox

    Person(analyst, "Security Analyst", "Uploads malware, reviews reports, interacts with AI.")
    
    System_Boundary(host, "Host Environment (Docker)") {
        System(frontend, "Frontend Dashboard", "React/Vite app with V5 Functional Fidelity UI.")
        System(backend, "Hyper-Bridge", "Rust API server. Orchestrates VMs, ingests telemetry, manages AI.")
        System(db, "Persistence Layer", "PostgreSQL (Relational) + ChromaDB (Vector).")
        System(ai_local, "Local Inference", "Llama.cpp / Ollama for Map Phase.")
        System(ai_cloud, "Cloud Reasoning", "Google Gemini 3 Flash Preview for Reduce Phase (Optional).")
    }

    System_Boundary(isolation, "Windows Sandbox (Proxmox/KVM)") {
        System(vm, "Sandbox VM", "Windows 10/11 Guest. Isolated Network.")
        System(agent, "TheVooDooBox Agent", "Rust binary with Kernel Driver (The Eye).")
    }

    System_Boundary(remnux_zone, "Remnux Analysis Zone (Linux)") {
        System(remnux_vm, "Remnux VM", "Ubuntu Linux dedicated to static analysis.")
        System(gateway, "Voodoo Gateway", "Node.js service bridging tools (Floss/Capa) to Backend.")
    }

    Rel(analyst, frontend, "Interacts/Views Reports")
    Rel(frontend, backend, "HTTPS / WSS (Telemetry Stream)")
    Rel(backend, db, "SQL / Vector Query")
    Rel(backend, ai_local, "Map Phase (Filter Privacy)")
    Rel(backend, ai_cloud, "Reduce Phase (Synthesize Verdict)")
    Rel(backend, vm, "VirtIO Serial / TCP", "Control & Telemetry")
    Rel(backend, gateway, "HTTP POST /analyze", "Triggers Static Analysis")
    Rel(gateway, remnux_vm, "Executes Toolchain")
```

---

## 2. Container Architecture

The system runs as a multi-container Docker application (`docker-compose.yaml`).

| Service | Image/Build | Port | Description |
| :--- | :--- | :--- | :--- |
| **hyper-bridge** | `./backend` | `8080` (API), `9001` (Agent) | Core logic. Rust-based Actix server. |
| **frontend** | `./frontend` | `3000` | React web application. |
| **db** | `postgres:15-alpine` | `5432` | Stores Tasks, Events, and Reports. |
| **chromadb** | `chromadb/chroma` | `8002` | Stores embeddings for RAG (Retrieval Augmented Generation). |
| **remnux-gateway** | `./remnux` | `8090` | Node.js bridge to Remnux tools (can be remote). |

---

## 3. AI Pipeline (Map-Reduce)

TheVooDooBox uses a **Map-Reduce** architecture to process large volumes of telemetry while respecting privacy boundaries.

```mermaid
sequenceDiagram
    participant B as Backend (Rust)
    participant L as Local LLM (Llama.cpp / Ollama)
    participant C as Cloud AI (Gemini)

    Note over B: Analysis Complete (10k+ Telemetry Events)
    
    B->>B: Chunk Telemetry (Batch Size: 3 Processes)
    
    loop Map Phase (Parallel)
        B->>L: analyze_chunk(json_chunk)
        L-->>B: structured_insights (Privacy Filtered)
    end
    
    B->>B: Aggregate Insights + Static Analysis Data
    
    alt Hybrid Mode
        B->>C: generate_final_report(aggregated_context)
        C-->>B: final_verdict_json
    else Local Only Mode
        B->>L: generate_final_report(aggregated_context)
        L-->>B: final_verdict_json
    end
```

---

## 4. Database Schema

The persistence layer uses **PostgreSQL**. Key tables include:

### `tasks`
Tracks the lifecycle of a submitted sample.
- `id` (UUID): Unique Task ID.
- `filename` (Text): Name of submitted file.
- `file_hash` (Text): SHA256 hash.
- `status` (Text): `QUEUED`, `RUNNING`, `ANALYZING`, `COMPLETED`.
- `verdict` (Text): AI-determined verdict (`MALICIOUS`, `BENIGN`).
- `risk_score` (Int): 0-100 score.
- `mitre_matrix` (JSONB): Mapped tactics and techniques.
- `remnux_status` (Text): Status of the Linux static analysis.

### `events`
Stores raw telemetry streamed from the Agent.
- `id` (Serial): Primary Key.
- `task_id` (UUID): Link to parent Task.
- `event_type` (Text): `PROCESS_CREATE`, `network_connect`, `file_create`, `registry_set`.
- `timestamp` (BigInt): Unix epoch.
- `process_id` (Int): PID of the actor.
- `details` (JSON): Context-specific data (IPs, Paths, Registry Keys).

---

## 5. Security & Isolation

### Network Segregation
- **Host-Only Network**: The Sandbox VMs live on a dedicated virtual network (e.g., `vmbr1`) with no routing to the host's LAN.
- **Strict Firewall**: The Guest VM can *only* talk to the Hyper-Bridge on port `9001` (Telemetry) and `8080` (Artifact Uploads).
- **No Internet (Default)**: Outbound internet is blocked by default to prevent C2 callbacks from reaching real threat actors. (Configurable for honey-potting).

### The "Eye" (Kernel Driver)
The Agent is protected by a custom Kernel Driver (`voodoobox_eye.sys`).
- **Anti-Tamper**: Strips `PROCESS_TERMINATE` rights from any process attempting to open a handle to the Agent.
- **Callback Registration**: Uses `PsSetCreateProcessNotifyRoutine` to capture process execution at the kernel level, ensuring no user-mode rootkit can hide execution.
