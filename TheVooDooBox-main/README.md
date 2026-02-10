# The VoodooBox (Mallab v3)

**AI-Driven Malware Analysis & Orchestration Platform**

The VoodooBox is a comprehensive forensic environment that combines:
- **Dynamic Analysis**: Secure Windows Sandbox execution with Kernel-level telemetry.
- **Static Analysis**: Automated Ghidra decompilation and function triage.
- **AI Synthesis & Orchestration**: Powered by **llama.cpp** (DeepSeek-R1 / Llama-3), this engine performs "Deep Thinking" reasoning to correlate findings.
- **Interactive Intelligence**: A unified dashboard with real-time AI insights, toggleable auto-response modes, and detailed behavioral timelines.
- **Agentic Automation**: The AI doesn't just report; it moves into action. It can autonomously trigger **Automated Responses** such as payload fetching (`FETCH_URL`), memory forensics (`MEM_DUMP`), and intelligent telemetry tagging (`TAG_EVENT`) to accelerate the investigation.
- **The Hive Mind**: Historical behavioral correlation system that identifies similarities between current telemetry and past investigations.
- **Threat Intel Integration**: Deep integration with VirusTotal for multi-engine reputation and family labeling.

## Agentic AI & Automated Response

The VoodooBox now features an **Agentic AI** engine capable of autonomous investigation. Instead of just analyzing telemetry, the AI can request follow-up actions:

| Action | Description |
| :--- | :--- |
| **FETCH_URL** | Automatically downloads payloads or second-stage malware found in URLs/Strings. |
| **MEM_DUMP** | Triggers a full process memory dump when suspicious injection or packing is detected. |
| **TAG_EVENT** | Intelligently tags specific telemetry lines (e.g., "C2 Beacon", "Keylogging") for the analyst. |

Analysts can toggle **"Auto-Response"** mode in the UI to approve these actions automatically or review them manually.

## Documentation

We have moved to a structured documentation system. Please see the `docs/` directory:

| Guide | Description |
| :--- | :--- |
| **[01_OVERVIEW.md](../docs/01_OVERVIEW.md)** | High-level introduction to features and goals. |
| **[02_ARCHITECTURE.md](../docs/02_ARCHITECTURE.md)** | System design, components, and data flow. |
| **[07_INSTALLATION.md](../docs/07_INSTALLATION.md)** | Step-by-step deployment guide (Docker + Proxmox). |
| **[15_ANALYSIS.md](../docs/15_ANALYSIS.md)** | Analyst guide: Running scans and using the UI. |
| **[20_AI_REPORTS.md](../docs/20_AI_REPORTS.md)** | Interpreting AI verdicts, scores, and reasoning. |

## Quick Start

1.  **Clone & Configure**:
    ```bash
    git clone https://github.com/Sagz9000/TheVooDooBox.git
    cd TheVooDooBox-main
    cp .env.example .env
    # Edit .env with your Proxmox/DB credentials
    ```

2.  **Launch Stack**:
    ```bash
    docker-compose up -d --build
    ```

3.  **Access Dashboard**:
    - **UI**: `http://localhost:3000`
    - **API**: `http://localhost:8080`

## Contributing

Please read the **[Architecture Guide](docs/02_ARCHITECTURE.md)** before submitting PRs.
