# TheVooDooBox Installation Guide (v3.0 - Flexible Deployment)

This guide covers the installation of the **Control Center (Host)**. For Guest VM setup, see **[VM_SETUP_v2.md](VM_SETUP_v2.md)**.

## 1. System Requirements

*   **Host OS**: Windows 10/11 (with Docker Desktop) or Linux (Ubuntu 22.04+).
*   **Virtualization**: 
    *   **Docker**: Required for the Control Center.
    *   **Proxmox VE**: Highly Recommended for Sandboxes.
    *   *Local VirtualBox/VMware*: Supported but requires manual networking config.
*   **AI Hardware**:
    *   **Local AI**: 16GB+ RAM, NVIDIA GPU (8GB+ VRAM) recommended.
    *   **Cloud AI**: No special hardware requirement (just API keys).

---

## 2. Interactive Installation (Recommended)

We provide an interactive wizard `launch_mallab_v2.ps1` that handles configuration, binary gathering, and launching.

### Step 1: Clone & Run
```powershell
# Open PowerShell
git clone https://github.com/Sagz9000/TheVooDooBox.git
cd TheVooDooBox-main

# Run the Wizard
.\launch_mallab_v2.ps1
```

### Step 2: Follow the Wizard
The script will prompt you for:

1.  **Architecture**:
    *   **Single Node**: Everything (Docker + AI) runs on `localhost`.
    *   **Distributed**: Uses your LAN IP so other machines (like the Sandboxes!) can connect. **(Recommended)**

2.  **AI Neural Core**:
    *   **Local AI (Llama.cpp / Ollama)**: Free, privacy-focused. 
        *   *Note: Llama.cpp is recommended for best performance.*
    *   **Gemini/OpenAI (Cloud)**: Fast, smarter (uses Gemini 3 Flash Preview by default).
    *   **Hybrid**: Local privacy + Cloud power.

3.  **Launch**:
    *   It will generate a `.env` file for you.
    *   It will create a `guest-setup/` folder (The "Guest Bundle").
    *   It will start the Docker stack.

---

## 3. Post-Installation

Once the stack is running:

1.  **Access Dashboard**: Open `http://localhost:3000` (or `http://<YOUR_LAN_IP>:3000`).
2.  **Verify Services**:
    *   **Backend**: `http://localhost:8080` (Should return 404/Hello).
    *   **MCP Server**: `http://localhost:8001`.

---

## 4. Next Steps: Guest VM Setup

Now that the Control Center is running, you need to set up your malware detonation environment.

👉 **Proceed to [VM_SETUP_v2.md](VM_SETUP_v2.md) to install the Agent.**
