# The VoodooBox Overview

![Lab Overview](../TheVooDooBox-main/pictures/overview.png)

**The VoodooBox** (v2.8) is an advanced **Hybrid AI** malware orchestration platform. It fuses kernel-level telemetry, static analysis, and LLM reasoning into a unified "Cyber-Rave" dashboard.

## Key Features (v2.8)

![Mission Control](../TheVooDooBox-main/pictures/missioncontrol.png)

### 1. Hybrid AI Analysis (Map-Reduce)
The platform uses a sophisticated **Map-Reduce** pipeline to balance privacy and intelligence:
- **Map Phase (Local)**: A local LLM (**llama.cpp** or Ollama) processes raw telemetry chunks in parallel to extract objective technical facts. No sensitive data leaves your network.
- **Reduce Phase (Cloud/Local)**: The aggregated facts are sent to a "Smart Model" (Gemini 3 Flash Preview or local DeepSeek via **llama.cpp**) to synthesize a final forensic verdict.
- **Configurable Modes**: Choose **Hybrid** (Best of both), **Local Only** (Air-gapped), or **Cloud Only** (Maximum reasoning).

### 2. Remnux Integration (Linux VM)
VoodooBox orchestrates a dedicated **Remnux Linux VM** to perform heavy-duty static analysis:
- **Floss**: Extracts obfuscated strings and stackstrings.
- **Capa**: Detects capabilities (e.g., "Check for Debugger", "Inject Code").
- **Manalyze & YARA**: Identifies packers and known malware signatures.
All results are streamed back to the VoodooBox dashboard in real-time.

### 3. The Neural Report
A next-generation report that replaces flat logs with actionable intelligence:
- **MITRE ATT&CK Matrix**: Auto-mapped tactics and techniques based on observed behavior.
- **Threat Score Rings**: Visual risk assessment (0-100).
- **Behavioral Timeline**: A chronological story of the infection chain.
- **Verdict**: definitive "Malicious", "Suspicious", or "Benign" judgment.

### 4. Interactive Activity Flow
- **Fishbone Diagram**: A real-time, interactive graph showing the process execution tree.
- **Deep Inspection**: Click any node to see loaded DLLs, registry keys, and network connections.

## Core Components

| Component | Function | Tech Stack |
| :--- | :--- | :--- |
| **Backend** | API, Orchestration, AI State | Rust (Actix-Web), PostgreSQL, Qdrant |
| **Frontend** | Analyst Console UI | React, TypeScript, TailwindCSS |
| **Sandbox** | Dynamic Execution | Windows 10/11 VM, Kernel Driver (Rust) |
| **Remnux** | Static Analysis Node | Remnux Linux VM, Node.js Gateway |
| **AI Engine** | Reasoning & Synthesis | Llama.cpp (Recommended) / Ollama + Gemini |

## Goals
- **Eliminate Noise**: Filter out OS background activity to focus on the "Patient Zero" lineage.
- **Automate Expertise**: Replace hours of manual reversing with minutes of AI-driven insight.
- **Visual Clarity**: Present complex data in a way that is immediately intuitively understood.
