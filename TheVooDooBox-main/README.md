# The VoodooBox (Mallab v3)

**AI-Driven Malware Analysis & Orchestration Platform**

The VoodooBox is a comprehensive forensic environment that combines:
- **Dynamic Analysis**: Secure Windows Sandbox execution with Kernel-level telemetry.
- **Static Analysis**: Automated Ghidra decompilation and function triage.
- **AI Synthesis**: Generative AI (LLM) reasoning to correlate findings and produce actionable reports.

## Documentation

We have moved to a structured documentation system. Please see the `docs/` directory:

| Guide | Description |
| :--- | :--- |
| **[01_OVERVIEW.md](docs/01_OVERVIEW.md)** | High-level introduction to features and goals. |
| **[02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md)** | System design, components, and data flow. |
| **[07_INSTALLATION.md](docs/07_INSTALLATION.md)** | Step-by-step deployment guide (Docker + Proxmox). |
| **[15_ANALYSIS.md](docs/15_ANALYSIS.md)** | Analyst guide: Running scans and using the UI. |
| **[20_AI_REPORTS.md](docs/20_AI_REPORTS.md)** | Interpreting AI verdicts, scores, and reasoning. |

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
