# System Architecture

## Core Data Flow

1.  **Submission**: User uploads a file via the Frontend.
2.  **Ingestion**: Backend saves the file, computes hashes, and checks the database for existing analysis.
3.  **Orchestration**: Backend triggers:
    - **Sandbox Job**: Creates a VM snapshot, runs the binary with the kernel driver.
    - **Ghidra Job**: Headless analysis runs in parallel to extract functions and strings.
4.  **Telemetry Stream**: The Sandbox Agent streams kernel events to the backend via TCP/WebSocket.
5.  **AI Synthesis**: Once both streams complete, the AI engine combines the data into a prompt and generates the report.
6.  **Presentation**: Frontend displays the report, timeline, and thinking process.

## Component Breakdown

### Backend (The Brain)
- **Language**: Rust (Actix-Web)
- **Role**: API Server, Job Queue, AI Prompt Engineer.
- **Key Modules**:
    - `ai_analysis.rs`: Handles prompt construction, JSON salvage, and thinking extraction.
    - `main.rs`: Core API routes and websocket handling.
    - `db.rs`: PostgreSQL and ChromaDB interactions.

### Frontend (The Face)
- **Language**: TypeScript (React + Vite)
- **Role**: Analyst Interface.
- **Key Components**:
    - `AIInsightPanel.tsx`: Renders the forensic report, timeline, and thinking console.
    - `FloatingChat.tsx`: Handles AI chat interaction.
    - `voodooApi.ts`: Type definitions and API client.

### The Agent (The Eyes)
- **Language**: Rust
- **Role**: In-VM execution monitor.
- **Capabilities**:
    - Process monitoring (Create, Terminate).
    - File system tracking (Drop, Delete, Modify).
    - Network traffic logging.
    - Anti-evasion measures.
