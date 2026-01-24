# TheVooDooBox: Interactive Malware Analysis Engine

> **"From Logging to Streaming"**

TheVooDooBox is a research prototype designed to replicate the **real-time, interactive experience** of platforms Unlike traditional sandboxes (Cuckoo/CAPE) that rely on batch processing and post-execution logs, TheVooDooBox focuses on instantaneous "Kernel-to-Pixel" streaming.

## 🚀 Key Features

*   **Live Interaction**: Control the malware execution flow. Click buttons, solve CAPTCHAs, and explore the file system *while* the malware is running.
*   **Real-Time Telemetry**: See "Process Created", "DNS Request", and "File Dropped" events on your dashboard the moment they happen (milliseconds latency).
*   **Kernel-Level Monitoring**: A custom Windows Kernel Driver ("The Eye") captures events at the source, bypassing user-mode hooks.
*   **High-Performance Bridge**: A Rust-based backend ("Hyper-Bridge") ingests millions of driver events and streams them via WebSockets to the UI.
*   **Ghidra Intelligence**: Integrated static analysis. Automatically decompile functions and view assembly for any uploaded binary, cross-referencing static findings with dynamic behavior.

## 🖼️ Gallery

### Analysis Queue & Task Management
![Analysis Queue](./pictures/queueanalys.png)

### Live Forensic Timeline
![Detonation Timeline](./pictures/consolestream.png)

### Detailed Analysis Report
![Analyst Report](./pictures/reportview.png)

### Analyst Multi-Window Workspace
![Lab View](./pictures/labview.png)

## 🏗️ Architecture

```mermaid
graph TD
    subgraph "Guest VM (Windows)"
        Malware[Malware.exe] --> Kernel
        Kernel --> Driver["'The Eye' (Kernel Driver)"]
        Driver -- "VirtIO Serial (Raw Bytes)" --> VirtIO[VirtIO Port]
    end

    subgraph "Host (Docker)"
        VirtIO --> Socket[QEMU Socket]
        Socket --> Bridge["'Hyper-Bridge' (Rust)"]
        Bridge -- "WebSockets (JSON)" --> API
    end

    subgraph "Analyst Browser"
        API --> UI[React Dashboard]
        VNC[VNC/Spice] <--> UI
    end
```

## 🛠️ Technology Stack

*   **Kernal Driver**: C/C++ (Windows Driver Kit)
*   **Backend Bridge**: Rust (Tokio, Actix)
*   **Frontend**: React, TypeScript, TailwindCSS
*   **Infrastructure**: QEMU/KVM, Docker, Postgres

## 🚦 Status: PROTOTYPE (Functional)
The system is now functional, providing real-time telemetry and forensic analysis capabilities.

## 📥 Getting Started
(Coming Soon)
