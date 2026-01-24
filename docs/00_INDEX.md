# Documentation Index

Welcome to TheVooDooBox Documentation. Use the links below to navigate the technical guides and user manuals.

## 🏁 Getting Started
*   [**01. Overview & Vision**](01_OVERVIEW.md)
    *   *What & Why*: The mission statement and critical safety/network isolation requirements.
*   [**05. Installation Guide**](05_INSTALLATION.md)
    *   *Deployment*: Step-by-step instructions for Docker host and Proxmox guest setup.
*   [**07. User Guide**](07_USER_GUIDE.md)
    *   *Usage*: How to submit samples, interact with VMs, and analyze forensic reports.

## 🏗️ Technical Architecture
*   [**02. Architecture & Logic**](02_ARCHITECTURE.md)
    *   *Design*: Data flow from Kernel Driver to React UI, including DB schema and API specs.
*   [**08. VNC & SPICE Integration**](08_VNC_SPICE_INTEGRATION.md)
    *   *Console*: Technical details on the WebSocket-to-TCP console relay mechanism.
*   [**09. Reporting & AI Analysis**](09_REPORTING_AI.md)
    *   *Workflow*: How telemetry is aggregated and synthesized into final PDF reports.

## 🤖 AI & Intelligence
*   [**03. AI Analyst & RAG**](03_AI_RAG.md)
    *   *Intelligence*: Hybrid RAG approach and the specific system prompts used for analysis.
*   [**13. Ollama Testing**](13_OLLAMA_TESTING.md)
    *   *Troubleshooting*: Verification steps for the local LLM integration.

## 🛡️ Sandbox & Agent Internals
*   [**04. Sandbox & Agent Internals**](04_SANDBOX_AND_AGENT.md)
    *   *Internals*: Deep dive into the Agent service and "The Eye" kernel driver structures.
*   [**11. Agent Deployment**](11_AGENT_DEPLOYMENT.md)
    *   *Deployment*: Detailed diagrams and steps for installing the agent in a sandbox.
*   [**14. Sandbox Guide**](14_SANDBOX_GUIDE.md)
    *   *Hardening*: Recommendations for VM optimization and software packages.

## 🛠️ Developer & Operations
*   [**06. Scripts Reference**](06_SCRIPTS.md)
    *   *Tooling*: Guide to the automation scripts in `/scripts` and `/sandbox_scripts`.
*   [**10. Agent Build & Deploy**](10_AGENT_BUILD_DEPLOY.md)
    *   *Cross-Compilation*: How to build the Rust agent for Windows targets.
*   [**12. Agent Troubleshooting**](12_AGENT_TROUBLESHOOTING.md)
    *   *Debug*: Solutions for common agent connectivity and execution issues.
