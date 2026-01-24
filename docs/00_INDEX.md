# Documentation Index

Welcome to TheVooDooBox Documentation. Use the links below to navigate the technical guides and user manuals.

## 🏁 Getting Started
*   [**01. Overview & Vision**](01_OVERVIEW.md)
    *   *What & Why*: The mission statement and critical safety/network isolation requirements.
*   [**07. Installation Guide**](07_INSTALLATION.md)
    *   *Deployment*: Step-by-step instructions for Docker host and Proxmox guest setup.
*   [**09. User Guide**](09_USER_GUIDE.md)
    *   *Usage*: How to submit samples, interact with VMs, and analyze forensic reports.

## 🏗️ Technical Architecture
*   [**02. Architecture & Logic**](02_ARCHITECTURE.md)
    *   *Design*: Data flow from Kernel Driver to React UI, including DB schema and API specs.
*   [**04. Hyper-Bridge & MCP**](04_HYPER_BRIDGE.md)
    *   *Orchestration*: How the backend works as an MCP server to provide agentic AI tools.
*   [**06. Frontend Dashboard**](06_FRONTEND_DASHBOARD.md)
    *   *Analyst UI*: React/Vite architecture, component breakdowns, and real-time telemetry rendering.
*   [**10. VNC & SPICE Integration**](10_VNC_SPICE_INTEGRATION.md)
    *   *Console*: Technical details on the WebSocket-to-TCP console relay mechanism.
*   [**11. Reporting & AI Analysis**](11_REPORTING_AI.md)
    *   *Workflow*: How telemetry is aggregated and synthesized into final PDF reports.

## 🤖 AI & Intelligence
*   [**03. AI Analyst & RAG**](03_AI_RAG.md)
    *   *Intelligence*: Hybrid RAG approach and the specific system prompts used for analysis.
*   [**17. Ghidra Integration**](17_GHIDRA_INTEGRATION.md)
    *   *Static Analysis*: How Ghidra decompiles binaries and feeds insights into the AI Chat.
*   [**15. Ollama Testing**](15_OLLAMA_TESTING.md)
    *   *Troubleshooting*: Verification steps for the local LLM integration.

## 🛡️ Sandbox & Agent Internals
*   [**05. Sandbox & Agent Internals**](05_SANDBOX_AND_AGENT.md)
    *   *Internals*: Deep dive into the Agent service and "The Eye" kernel driver structures.
*   [**13. Agent Deployment**](13_AGENT_DEPLOYMENT.md)
    *   *Deployment*: Detailed diagrams and steps for installing the agent in a sandbox.
*   [**16. Sandbox Guide**](16_SANDBOX_GUIDE.md)
    *   *Hardening*: Recommendations for VM optimization and software packages.

## 🛠️ Developer & Operations
*   [**08. Scripts Reference**](08_SCRIPTS.md)
    *   *Tooling*: Guide to the automation scripts in `/scripts` and `/sandbox_scripts`.
*   [**12. Agent Build & Deploy**](12_AGENT_BUILD_DEPLOY.md)
    *   *Cross-Compilation*: How to build the Rust agent for Windows targets.
*   [**14. Agent Troubleshooting**](14_AGENT_TROUBLESHOOTING.md)
    *   *Debug*: Solutions for common agent connectivity and execution issues.
*   [**18. Backend Logging**](18_BACKEND_LOGGING.md)
    *   *Ops*: Monitoring Hyper-Bridge health and configuring RUST_LOG levels.
