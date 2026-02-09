# Installation & Deployment Guide

## 1. Prerequisites

### Hardware Requirements
- **CPU**: x86_64 Processor with Virtualization Extensions (VT-x/AMD-v) enabled.
- **RAM**: 16GB Minimum (32GB Recommended if running local Ollama LLM).
- **Storage**: 100GB+ SSD.

### Software Requirements
- **Docker**: Docker Engine + Docker Compose.
- **Proxmox Virtual Environment (PVE)**: Required for Sandbox VM management.
- **Node.js**: v18+ (for frontend dev).
- **Rust**: 1.75+ (for backend dev).
- **Ghidra**: 11.0+ (Headless Analyzer).

## 2. Environment Setup

1.  **Clone Repository**:
    ```bash
    git clone https://github.com/Sagz9000/TheVooDooBox.git
    cd TheVooDooBox-main
    ```

2.  **Configure Secrets**:
    Create a `.env` file in the root directory (copy from `.env.example`).
    ```bash
    cp .env.example .env
    ```
    Populate the following critical variables:
    - `PROXMOX_HOST`: IP/Hostname of your PVE.
    - `PROXMOX_TOKEN_ID`: API Token ID (e.g., `root@pam!token`).
    - `PROXMOX_TOKEN_SECRET`: API Token Secret.
    - `POSTGRES_PASSWORD`: Database password.
    - `OLLAMA_API_URL`: URL to your Ollama instance (e.g., `http://host.docker.internal:11434`).

## 3. Launching the Stack

Run the Docker Compose stack to start the Backend, Frontend, and Database:

```bash
docker-compose up -d --build
```

- **Frontend**: Accessible at `http://localhost:3000`
- **Backend API**: Accessible at `http://localhost:8080`

## 4. Configuring the Sandbox (Windows VM)

1.  **Create VM**: In Proxmox, create a Windows 10/11 VM.
2.  **Install Agent**: Compile `agent-windows` and copy `agent-windows.exe` to the VM.
3.  **Run Agent**: Execute the agent with the server IP:
    ```powershell
    .\agent-windows.exe --server <HOST_IP>:9001
    ```
4.  **Snapshot**: Take a snapshot named `GOLD_IMAGE` while the agent is running and waiting for commands.
5.  **Update Config**: Ensure the `.env` file reflects the VM ID and Snapshot Name.
