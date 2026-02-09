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
    - `LLAMA_API_URL`: URL to your local `llama-server` (e.g., `http://host.docker.internal:8080`).

## 3. Launching the Stack

1.  **Start Llama Server**:
    Download a GGUF model (e.g., DeepSeek-R1-Distill-Llama-8B) and run:
    ```bash
    ./llama-server -m models/deepseek-r1.gguf -c 8192 --host 0.0.0.0 --port 8080
    ```

2.  **Run Docker Compose**:
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
