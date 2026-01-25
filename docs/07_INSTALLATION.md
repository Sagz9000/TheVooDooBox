# Installation Guide

Setting up TheVooDooBox involves configuring a Linux host (for the backend/database) and a Windows VM (for the sandbox).

## 1. Prerequisites

### Host System (Server)
*   **OS**: Ubuntu 22.04 LTS or Debian 11+
*   **Docker**: Engine 24.0+ & Docker Compose
*   **Hardware**: 8 Cores, 32GB RAM (Recommended if running local LLMs + VM)

### Analysis VM
*   **Hypervisor**: Proxmox VE (Preferred) or plain QEMU/KVM
*   **Guest**: Windows 10/11

## 2. host Setup (Backend)

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/Sagz9000/TheVooDooBox.git
    cd TheVooDooBox
    ```

2.  **Configure Environment**
    Copy the example config and edit it. This is where you will define your Proxmox integration and networking:
    ```bash
    cp .env.example .env
    nano .env
    ```

## 3. Proxmox API Setup

TheVooDooBox interacts with Proxmox VE via its REST API to automate snapshot rollbacks, control VM power states, and generate interactive console tickets.

### Credential Collection
Before proceeding, you must collect the following from your Proxmox environment:

1.  **Proxmox URL**: The base URL and port of your PVE web interface (e.g., `https://192.168.1.200:8006`).
2.  **API Token**:
    *   In Proxmox: Go to **Datacenter** -> **Permissions** -> **API Tokens**.
    *   Create a new token for a user (e.g., `root@pam`).
    *   **Important**: Copy the **Secret** immediately; it is only shown once.
3.  **Token ID**: The name given to the token during creation (e.g., `VoodooBox`).

### `.env` Mapping
Enter these values into your `.env` file in the project root:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `PROXMOX_URL` | Your PVE management URL | `https://192.168.1.200:8006` |
| `PROXMOX_USER` | The user the token belongs to | `root@pam` |
| `PROXMOX_TOKEN_ID` | The ID/Name of the token | `VoodooBox` |
| `PROXMOX_TOKEN_SECRET` | The secret string from Proxmox | `xxxx-xxxx-xxxx...` |
| `DATABASE_URL` | Postgres connection string | `postgres://voodoobox:secure_password_here@db:5432/voodoobox_telemetry` |

> [!IMPORTANT]
> **Credential Mismatch Warning**: Ensure your `DATABASE_URL` uses the user `voodoobox` and NOT `mallab`.
> The `docker-compose.yaml` creates the user `voodoobox`. If your `.env` has `mallab`, the application will fail to connect.
> **Correct**: `postgres://voodoobox:password@db:5432/voodoobox_telemetry`
> **Incorrect**: `postgres://mallab:password@db:5432/mallab_telemetry`

### AI Analyst Configuration
Configure your local LLM or cloud API here.

| Variable | Description |
| :--- | :--- |
| `OLLAMA_URL` | URL of your local Ollama instance (e.g., `http://192.168.1.100:11434`) |
| `OLLAMA_MODEL` | Smart model for analysis (e.g., `qwen2.5-coder:14b`) |
| `EMBEDDING_MODEL` | Fast model for RAG (e.g., `nomic-embed-text:v1.5`) |
| `GEMINI_API_KEY` | (Optional) Fallback to Google Gemini Pro |

### How it Works
The `hyper-bridge` backend uses these credentials to authenticate via the `PVEAPIToken` header. When an analysis starts, the backend calls the Proxmox API to:
1.  **Revert** the sandbox VM to a clean snapshot.
2.  **Start** the VM.
3.  **Generate** a VNC/SPICE proxy ticket, which is then relayed to your browser.

## 4. Deploy Services
    ```bash
    cd TheVooDooBox-main
    docker-compose up -d --build
    ```
    This brings up:
    *   `hyper-bridge` (Backend API)
    *   `postgres` (Database)
    *   `ghidra-service` (Static Analysis)
    *   `voodoobox-ui` (Frontend)

4.  **Verify**
    Visit `http://localhost:3000` (or your server IP). You should see the login/dashboard capability.

## 5. Optional: Knowledge Base Ingestion

To ground the AI Analyst in real-world forensic knowledge, you can ingest SANS Forensic Posters into the vector database.

1.  Create a `sans_posters/` folder in the project root.
2.  Place your forensic PDFs inside.
3.  Run the ingestion from the host:
    ```bash
    python ./TheVooDooBox-main/scripts/ingest_posters.py
    ```

## 6. Sandbox Setup (Guest)

1.  **Prepare the Windows VM**.
2.  **Install the Agent & Instrumentation**:
    *   Copy the contents of `TheVooDooBox-main/releases/` and `TheVooDooBox-main/sandbox_scripts/` to the VM.
    *   Run `install.ps1` as Administrator (Agent & Driver).
    *   Run `install_sysmon.ps1` as Administrator (Forensic logging).
3.  **Snapshot**:
    *   Shut down the VM.
    *   Take a snapshot named `ready_for_analysis` (or configure your preferred name in the `.env`).

## 4. Connecting Them

Ensure your Proxmox/KVM setup exposes the VirtIO serial socket at the location specified in `docker-compose.yaml` (default: `/var/run/qemu/voodoobox.sock`).

If using Proxmox, you may need to use the `proxmox_setup_win.sh` helper script (see Scripts Guide) to ensure the hardware is defined correctly.
