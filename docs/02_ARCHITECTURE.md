# TheVooDooBox System Architecture

## 1. High-Level Design

TheVooDooBox is a **hybrid forensic platform** that combines traditional sandbox isolation with modern AI-driven analysis. It is designed to be **modular**, **self-hosted**, and **privacy-centric**.

```mermaid
graph TD
    User[Analyst / User] -->|Web UI (React)| Frontend[Frontend Dashboard]
    
    subgraph "Host Environment (Docker)"
        Frontend -->|REST / WebSocket| Backend[Hyper-Bridge Backend]
        Backend -->|SQL| DB[(PostgreSQL)]
        Backend -->|Vector Search| VectorDB[(ChromaDB)]
        Backend -->|Inference| Llama[Llama.cpp Server]
        Backend -->|Static Analysis| Ghidra[Ghidra Headless]
    end
    
    subgraph "Isolation Zone (Proxmox / KVM)"
        Backend -->|VirtIO Serial / TCP| Agent[Windows Agent]
        Agent -->|Telemetry Stream| Backend
        
        subgraph "Guest VM"
            Agent
            Sysmon[Sysmon Driver]
            Kernel[VoodooBox Kernel Driver]
        end
    end
```

---

## 2. Core Components

### A. The Hyper-Bridge (Backend)
**Role**: The central nervous system. It orchestrates VMs, manages the analysis queue, and synthesizes reports.
- **Technology**: Rust (Actix-Web)
- **Key Responsibilities**:
    - **VM Control**: Communicates with Proxmox API to revert/start/stop snapshots.
    - **Data Aggregation**: Ingests high-speed telemetry from the Agent (TCP/9001).
    - **AI Orchestration**: Constructs prompts for `llama.cpp` using a RAG (Retrieval-Augmented Generation) pipeline.
    - **State Management**: Persists all task data to PostgreSQL.
- **Why Rust?**: Memory safety and concurrency are critical when handling potentially malicious streams and managing heavy IO.

### B. The Eye (Windows Agent)
**Role**: The "boots on the ground" observer inside the malware sandbox.
- **Technology**: Rust (Systems Programming)
- **Key Modes**:
    1.  **Passive Monitor**: Streams `Sysmon` events (Process, Network, File) to the backend.
    2.  **Active Hunter**:
        - **Signature Scans**: Real-time `WinVerifyTrust` checks on every file drop and execution.
        - **Memory Forensics**: Scans for process hollowing/injection.
        - **Browser Hooks**: Captures DOM state from web browsers.
    3.  **Enforcer**: Can kill processes or block network traffic if instructed by the Auto-Response system.

### C. The Brain (AI Analysis Engine)
**Role**: Replaces the Tier-1 Security Analyst.
- **Technology**: Python (Llama.cpp / GGUF Models)
- **Models**: Optimized for `DeepSeek-R1-Distill-Llama-8B` or similar reasoning models.
- **Workflow**:
    1.  **Ingest**: Takes raw JSON logs from the Agent.
    2.  **Enrich**: Adds static analysis data (Ghidra) and knowledge base context (VectorDB).
    3.  **Think**: Uses `<think>` tags to reason through the attack chain.
    4.  **Report**: Outputs a structured JSON verdict (Malicious/Benign) + Timeline.

### D. The Face (Frontend Dashboard)
**Role**: The command center for the human analyst.
- **Technology**: React + TypeScript + Vite
- **Visuals**: "Cyber-Nostalgia" aesthetic (Neon, Terminal fonts) backed by modern UX.
- **Features**:
    - **Live Arena**: Watch the malware detonate in real-time (VNC + Event Stream).
    - **Execution Graph**: Interactive node-link diagram of the process tree.
    - **Chat with Malware**: Conversational interface to query the AI about specific events.

---

## 3. Data Flow Architecture

### The "Detonation Loop"

1.  **Submission**: User uploads `invoice.exe` via the Dashboard.
2.  **Queuing**: Backend hashes the file (SHA256) and creates a `Task`.
3.  **Prep**:
    - Backend instructs Proxmox to **Revert** VM to "Gold Image".
    - Backend **Uploads** the sample to the VM via internal API.
4.  **Detonation**:
    - Agent receives `EXECUTE` command.
    - Agent launches sample and begins streaming events.
    - **Simultaneously**: Backend triggers Ghidra for static analysis.
5.  **Synthesis**:
    - After X minutes (or termination), Agent sends "End of Report".
    - Backend combines (Agent Stream + Ghidra Output + Vector Knowledge).
    - AI generates the final verdict.
6.  **Storage**: Artifacts, logs, and report are saved to disk/DB.

---

## 4. Security Model

### Isolation
-   **No Shared Network**: The Sandbox VM is on an isolated VLAN (Host-Only).
-   **No Internet**: By default, the VM has no outbound internet to prevent C2 leaks (configurable).
-   **Air-Gapped AI**: The AI model runs locally; no data leaves the server.

### Integrity
-   **Immutable Infrastructure**: VMs are reverted to a clean snapshot *before* every analysis.
-   **Agent Hardening**: The Agent runs as a System Service and (optionally) is protected by a Kernel Driver to prevent termination by malware.

---

## 5. Technology Stack Summary

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React, TypeScript, Tailwind, Lucide Icons |
| **Backend API** | Rust (Actix-Web), SQLx, Tokio |
| **Database** | PostgreSQL (Relational), ChromaDB (Vector) |
| **AI Inference** | Llama.cpp (GGUF), Python Bindings |
| **Sandbox** | QEMU/KVM (Proxmox), Windows 10/11 Guest |
| **Agent** | Rust (Windows API, Sysmon Integration) |
