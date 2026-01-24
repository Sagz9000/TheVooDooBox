# Mallab v3 Deployment Guide

This guide covers the deployment of the Mallab v3 Multi-Sandbox Analysis Platform.

## 1. Proxmox Infrastructure Setup

The "Sanctuary" management system requires a Proxmox API Token with appropriate permissions (VM.Audit, VM.Config.HW, VM.PowerMgmt, VM.Snapshot).

1.  **Create API Token**:
    *   Go to **Datacenter -> Permissions -> API Tokens**.
    *   Add a new token (e.g., `MalwareLab`).
    *   Store the **Token ID** and **Token Secret**.
2.  **Snapshot Convention**:
    *   Configure your Windows Sandbox VM.
    *   Once fully configured with the Mallab Agent (see Section 3), take a snapshot named `GOLD_IMAGE`.
    *   The "Revert" button in the Sanctuary view targets this specific name.

## 2. Global Control Center (Docker)

The backend and frontend are orchestrated via Docker Compose.

1.  **Configure Environment**:
    Create a `.env` file in the project root (use `.env.example` as a template) and populate your secrets:
    ```bash
    cp .env.example .env
    nano .env
    ```
    Set `PROXMOX_TOKEN_SECRET`, `POSTGRES_PASSWORD`, etc., in this file.
    
    *Note: `docker-compose.yaml` is now configured to load these values automatically.*
2.  **Launch Stack**:
    ```bash
    docker-compose up --build -d
    ```
    *   **Frontend**: `http://localhost:3000`
    *   **Backend API**: `http://localhost:8080`

## 3. Windows Sandbox Agent Deployment

To monitor a real Windows VM, you must deploy the `agent-windows`.

### Binary Preparation (On Windows Dev Machine)

1.  **Prerequisites**:
    *   Install Rust (from `rustup.rs`).
    *   LLVM/Clang for driver components (optional if only running user-mode agent).
2.  **Compile Agent**:
    ```powershell
    cd agent-windows
    cargo build --release
    ```
3.  **Transfer Binary**: 
    Copy `target/release/agent-windows.exe` to the target Sandbox VM.

### Agent Installation (On Sandbox VM)

1.  **Run with C2 Link**:
    ```powershell
    .\agent-windows.exe --server <control-center-ip>:9001
    ```
2.  **Verify Status**:
    Check the Mallab v3 Dashboard. The VM status should reflect activity, and the "Live Hyper-Bridge" should start receiving telemetry.
3.  **Capture Gold Image**:
    Once the agent is running correctly (ideally started automatically via Task Scheduler or as a Service), take the `GOLD_IMAGE` snapshot in Proxmox.

## 4. Troubleshooting

*   **VNC Console Timed Out**: Ensure the Proxmox user has `VM.Console` permissions and the Proxmox firewall allows incoming traffic on port 8006.
*   **No Telemetry**: Verify the Sandbox VM can reach the Control Center IP on port `9001` (Check Windows Firewall).
*   **CORS Errors**: If accessing the dashboard from a different machine, update the CORS configuration in `backend/src/main.rs`.
