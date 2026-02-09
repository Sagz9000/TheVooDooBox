# The VoodooBox Overview

**The VoodooBox** (formerly Mallab v3) is an advanced, AI-driven malware analysis platform designed for modern threat research. It integrates dynamic sandboxing, static analysis, and large language model (LLM) reasoning into a single, cohesive workflow.

## Key Features

### 1. Unified Analysis Pipeline
The platform orchestrates a seamless analysis flow:
- **Dynamic Analysis**: Executes suspect binaries in a secure Windows Sandbox (Kernel Mode + User Mode telemetry).
- **Static Analysis**: Automatically decompiles code using **Ghidra** and extracts high-risk functions.
- **AI Synthesis**: Feeds telemetry and decompiled code into a specialized LLM (e.g., DeepSeek-R1) to generate a comprehensive forensic report.

### 2. "The Hive Mind" (Knowledge Graph)
The system learns from every analysis. Known malware families, behavioral patterns, and analyst tags are stored in a vector database, allowing the AI to spot trends and correlate new samples with historical data.

### 3. Advanced UI (The Analyst Console)
A retro-futuristic "Cyberpunk/Hacker" interface that provides:
- Real-time telemetry streaming (Process Tree, API Calls).
- Interactive forensic reports with "Chain of Thought" reasoning.
- Direct access to Ghidra decompilation.
- "Chat with Malware" functionality for Q&A about the sample.

## Core Components

| Component | Function | Tech Stack |
| :--- | :--- | :--- |
| **Backend** | API, Orchestration, AI Management | Rust (Actix-Web), PostgreSQL, Qdrant |
| **Frontend** | Analyst Console UI | React, TypeScript, TailwindCSS |
| **Sandbox** | Dynamic Execution Environment | Windows 10/11 VM, Kernel Driver (Rust) |
| **Ghidra** | Static Analysis Engine | Java, Headless Analyzer |
| **LLM Provider** | AI Reasoning | Ollama (Local) or Cloud API |

## Goals
- **Reduce Analyst Fatigue**: Automate the correlation of thousands of events.
- **Explainable AI**: Provide transparent "thinking" logs so analysts can verify the AI's conclusions.
- **Speed**: Go from sample submission to full report in under 2 minutes.
