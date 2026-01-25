![TheVooDooBox Logo](TheVooDooBox-main/frontend/public/logo.png)

# TheVooDooBox

![Analyst Report Preview](TheVooDooBox-main/pictures/preview.png)

> **"From Logging to Streaming"**
"The Voodoo who-do, what you don't dare-to people." > Malware analysis is inherently a risk no one should have to take alone. TheVooDooBox acts as your automated orchestrator, handling the "don't dare-to" tasks by isolating the execution and interaction layers within a hardened Proxmox environment. By automating the detonation and behavioral capture, it strips the "voodoo" from malicious code...leaving only the actionable intelligence behind.

It provides a real-time window into the malware's execution, allowing analysts to:
*   **Watch** the infection execute live via a high-performance VNC/Spice stream.
*   **Interact** with the malware (click dialogs, solve CAPTCHAs, traverse file systems).
*   **Observe** kernel-level events (process creation, file modification, registry connection) as they happen, with millisecond latency.


## 📚 Documentation

The full documentation is available in the `docs/` directory. For a complete guide to all available documents, see the [**Documentation Index**](docs/00_INDEX.md).

### Core Guides
1.  [**Overview & Vision**](docs/01_OVERVIEW.md)
2.  [**Architecture & Logic**](docs/02_ARCHITECTURE.md)
3.  [**AI Analyst & RAG**](docs/03_AI_RAG.md)
4.  [**Hyper-Bridge & MCP**](docs/04_HYPER_BRIDGE.md)
5.  [**Sandbox & Agent Internals**](docs/05_SANDBOX_AND_AGENT.md)
6.  [**Frontend Dashboard**](docs/06_FRONTEND_DASHBOARD.md)

### Technical Deep Dives
*   [**Installation Guide**](docs/07_INSTALLATION.md)
*   [**User Guide**](docs/08_USER_GUIDE.md)
*   [**VNC & SPICE Integration**](docs/10_VNC_SPICE_INTEGRATION.md)
*   [**Reporting & AI Analysis**](docs/11_REPORTING_AI.md)
*   [**Ghidra Static Analysis**](docs/17_GHIDRA_INTEGRATION.md)

### Extended Resources
*   [**Scripts Reference**](docs/08_SCRIPTS.md)
*   [**Agent Build & Deploy**](docs/12_AGENT_BUILD_DEPLOY.md)
*   [**Agent Deployment**](docs/13_AGENT_DEPLOYMENT.md)
*   [**Agent Troubleshooting**](docs/14_AGENT_TROUBLESHOOTING.md)
*   [**Ollama Testing**](docs/15_OLLAMA_TESTING.md)
*   [**Sandbox Guide**](docs/16_SANDBOX_GUIDE.md)

## 🚀 Quick Start

For those familiar with the stack:

1.  **Clone**: `git clone https://github.com/Sagz9000/TheVooDooBox.git`
2.  **Config**: `cp .env.example .env` (⚠️ Check `DATABASE_URL` user is `voodoobox`!)
3.  **Run**: `docker-compose up -d --build`
4.  **Analysis**: Access UI at `http://localhost:3000`

## 📺 Streaming vs. Logging

Traditional sandboxes like Cuckoo or CAPE are "black boxes" designed for high-volume batch processing. TheVooDooBox is built for deep, interactive forensic dissection.

*   **Interaction Paradigm**: Traditional sandboxes execute samples for a fixed time and generate post-mortem reports. TheVooDooBox is a **live streaming engine**, allowing you to watch and interact with the infection in real-time.
*   **Stealth & Transport**: We use **"The Eye"**, a custom Windows Kernel Driver, and **VirtIO Serial** for out-of-band communication. This bypasses the noisy user-mode hooks and network-based logging that modern malware easily detects and evades.
*   **Real-Time AI**: Unlike static signature lists, our **Hybrid-RAG AI Analyst** synthesizes live kernel events and Ghidra static findings into a coherent forensic narrative as the malware executes.
*   **Hardware Native**: Purpose-built for the **Proxmox/KVM stack** with a high-speed WebSocket-to-TCP console relay, providing significantly lower latency than standard VNC implementations.

---
*Maintained by the VoodooBox Research Team...me JP*
