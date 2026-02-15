# TheVooDooBox Installation Guide (v2.8)

## 1. System Requirements

*   **Host OS**: Ubuntu 22.04 LTS (Recommended) or Windows 10/11 with WSL2.
*   **Virtualization**: Proxmox VE (Preferred) or local KVM/QEMU.
*   **Hardware**: 16GB RAM minimum (32GB recommended for local LLMs).
*   **Docker**: Docker Engine 24+ and Docker Compose v2.

## 2. Quick Start (Docker)

### Clone & Configure
```bash
git clone https://github.com/Sagz9000/TheVooDooBox.git
cd TheVooDooBox-main
cp .env.example .env
```

### Edit Configuration (.env)
You must set your API keys and network paths:

```ini
# --- Database ---
POSTGRES_USER=voodoo
POSTGRES_PASSWORD=secret
POSTGRES_DB=mallab

# --- Proxmox (Sandbox Manager) ---
PROXMOX_HOST=192.168.1.10
PROXMOX_USER=root@pam
PROXMOX_TOKEN_ID=your_token_id
PROXMOX_TOKEN_SECRET=your_token_secret

# --- AI Configuration (Hybrid Mode) ---
# Local Inference (Ollama)
OLLAMA_HOST=http://host.docker.internal:11434
# Cloud Reasoning (Gemini)
GEMINI_API_KEY=your_google_api_key

# --- Remnux Integration ---
REMNUX_MCP_URL=http://192.168.1.50:8090
```

### Launch the Stack
```bash
docker-compose up -d --build
```

Access the dashboard at **http://localhost:3000**.

## 3. Sandbox VM Setup (Windows)

The Windows Guest VM requires the VoodooBox Agent and Kernel Driver.
Please see **[13_AGENT_DEPLOYMENT.md](13_AGENT_DEPLOYMENT.md)** for detailed steps on:
1.  Disabling Defender/Tamper Protection.
2.  Installing the Root Certificate.
3.  Deploying the Agent Service and Kernel Driver.

## 4. Remnux VM Setup (Linux)

For advanced static analysis (Floss, Capa, YARA), you need a dedicated Remnux VM.
Please see **[21_REMNUX_VM_DEPLOYMENT.md](21_REMNUX_VM_DEPLOYMENT.md)** for the complete guide on setting up the Linux node and the Voodoo Gateway service.

## 5. Verification

1.  **Check Services**: `docker-compose ps` should show `backend`, `frontend`, and `db` as healthy.
2.  **Check Logs**: `docker-compose logs -f backend` for startup errors.
3.  **Test AI**: Go to "Settings" in the UI and test the connection to Ollama/Gemini.
