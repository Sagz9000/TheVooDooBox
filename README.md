# The VoodooBox

**Hybrid AI Malware Analysis Platform**
The Voodoo, who do
What you don't dare do
![TheVooDooBox Logo](TheVooDooBox-main/frontend/public/logo.png)

![VoodooBox Dashboard](TheVooDooBox-main/pictures/preview.png)

> **"From Logging to Streaming"**
TheVooDooBox acts as your automated orchestrator, handling the "don't dare-to" tasks of malware research. By automating detonation, kernel-level behavioral capture, and AI-driven synthesis, it strips the "voodoo" from malicious code... leaving only actionable intelligence behind.

---

## 🚀 Key Features (v2.8)

### 🧠 Hybrid AI Core (Map-Reduce)
The VoodooBox uses a unique **Map-Reduce** pipeline to balance privacy and reasoning power:
*   **Map Phase (Local)**: Raw telemetry is processed locally by **Ollama** (Llama-3/DeepSeek) to extract technical facts without data leakage.
*   **Reduce Phase (Cloud/Local)**: Aggregated insights are sent to high-reasoning models like **Google Gemini 1.5 Pro** for final verdict synthesis and threat scoring.
*   *Configurable strategies: Local Only, Cloud Only, or Hybrid.*

### 🕵️ Full-Spectrum Orchestration
*   **Dynamic Windows Sandbox**: SECURE detonation with Sysmon, Kernel Drivers ("The Eye"), and out-of-band communication via VirtIO Serial.
*   **Remnux Linux Integration**: Offloads deep static analysis to a dedicated Remnux node running **Floss**, **Capa**, **YARA**, and **Manalyze**.
*   **Ghidra Automation**: Automated decompilation pipeline that feeds suspicious code logic directly into the AI analyzer.

### 📊 The Neural Report
Forget manual log correlation. The Neural Report provides:
*   **MITRE ATT&CK Matrix**: Automated mapping of observed tactics and techniques.
*   **Behavioral Timelines**: Chronological reconstruction of the infection chain.
*   **Threat Score Rings**: Visual assessment of risk level (0-100).
*   **Verdict Triage**: High-confidence "Malicious", "Suspicious", or "Benign" judgments.

### 🕸️ Activity Flow (Galaxy)
*   **Real-Time Visualization**: Watch the process execution tree grow live during detonation.
*   **Interactive Inspection**: Drill down into any process to see loaded DLLs, network connections, and registry modifications.

---

## 📚 Documentation

The full documentation is available in the `docs/` directory.

| Guide | Description |
| :--- | :--- |
| **[01. Overview & Vision](docs/01_OVERVIEW.md)** | Core capabilities and safety requirements. |
| **[02. Architecture & Logic](docs/02_ARCHITECTURE.md)** | System design, Map-Reduce flow, and DB schema. |
| **[07. Installation Guide](docs/07_INSTALLATION.md)** | Step-by-step deployment (Docker + Proxmox). |
| **[15. Analyst Manual](docs/15_ANALYSIS.md)** | How to run investigations and interpret results. |
| **[21. Remnux Setup](docs/21_REMNUX_VM_DEPLOYMENT.md)** | Deploying the Linux static analysis node. |

---

## ⚡ Quick Start

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/Sagz9000/TheVooDooBox.git
    cd TheVooDooBox
    ```

2.  **Configure Environment**:
    ```bash
    cp TheVooDooBox-main/.env.example TheVooDooBox-main/.env
    # Edit the .env with your credentials and API keys.
    ```

3.  **Launch the Stack**:
    ```bash
    cd TheVooDooBox-main
    docker-compose up -d --build
    ```

4.  **Access the Dashboard**:
    *   **Frontend**: `http://localhost:3000`
    *   **Backend API**: `http://localhost:8080`

---

## 🏗️ Technical Philosophy

Traditional sandboxes are "black boxes" for batch processing. TheVooDooBox is a **live streaming engine** for deep forensic dissection. Using our custom **Windows Kernel Driver**, we bypass noisy user-mode hooks that malware can detect, providing a high-fidelity window into the core of the infection.

*Built with ❤️ by the AntiCode Team. Maintained by JP.*

---
> "I got the poison (I got the remedy)"
