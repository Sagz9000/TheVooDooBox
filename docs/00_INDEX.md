# Documentation Index

Welcome to TheVooDooBox Documentation. Use the links below to navigate the technical guides and user manuals.

## 🏁 Getting Started
*   [**01. Overview & Vision**](01_OVERVIEW.md)
    *   *What & Why*: The mission statement and critical safety/network isolation requirements.
*   [**07. Installation Guide**](07_INSTALLATION.md)
    *   *Deployment*: Step-by-step instructions for Docker host and Proxmox guest setup.
*   [**21. Remnux VM Deployment**](21_REMNUX_VM_DEPLOYMENT.md)
    *   *Linux Analysis*: Setup guide for the dedicated Remnux node and Voodoo Gateway.
*   [**09. User Guide**](09_USER_GUIDE.md)
    *   *Usage*: How to submit samples, interact with VMs, and analyze forensic reports.

## 🏗️ Technical Architecture
*   [**02. Architecture & Logic**](02_ARCHITECTURE.md)
    *   *Design*: Data flow including the Hybrid Map-Reduce path and Remnux integration.
*   [**04. Hyper-Bridge & MCP**](04_HYPER_BRIDGE.md)
    *   *Orchestration*: How the backend works as an orchestration layer.
*   [**06. Frontend Dashboard**](06_FRONTEND_DASHBOARD.md)
    *   *Analyst UI*: React/Vite architecture and real-time Neural Report rendering.

## 🤖 AI & Intelligence
| Document | Description |
|---|---|
| [**03_AI_RAG.md**](03_AI_RAG.md) | Technical deep-dive into the Hybrid AI pipeline, Map-Reduce, and Prompt Engineering. |
| [**15_ANALYSIS.md**](15_ANALYSIS.md) | Analyst guide: Running Hybrid scans and interpreting the Neural Report. |
| [**20_AI_REPORTS.md**](20_AI_REPORTS.md) | Interpreting AI verdicts, MITRE Matrix, and Threat Scores. |

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
