# Overview & Vision

> [!CAUTION]
> **MALWARE ANALYSIS IS INHERENTLY DANGEROUS.** 
> This software is designed to execute malicious code. TheVooDooBox **DOES NOT** include built-in network protections by default. It is the operator's responsibility to ensure a hardened isolation perimeter.

## ⚠️ Safety & Network Isolation ⚠️

A secure malware lab requires multiple layers of defense. Running TheVooDooBox without an external firewall and network segmentation is **unsafe**.

### Recommended Hardening (e.g., via pfSense)
For a production-grade lab, we recommend the following setup within your **Proxmox** or virtualization environment:

*   **Dedicated Firewall (pfSense/OPNsense)**: Use a dedicated firewall VM to act as the gateway for your analysis environment.
*   **VLAN Segmentation**: Place all sandbox VMs in a strictly isolated VLAN. Use firewall rules to block all traffic from this VLAN to your internal LAN or other infrastructure.
*   **VPN Outbound**: If you require the malware to communicate with the internet (to monitor Command & Control), route the sandbox VLAN through a **VPN provider** at the firewall level. This prevents your public IP from being exposed to threat actors.
*   **Disabled Guest-to-Host Networking**: Prevent the guest from communicating with the Host Server's IP address. Communication should primarily happen via the **VirtIO Serial** interface, which is an out-of-band communication channel and significantly harder for malware to pivot through.

## What is TheVooDooBox?

"The Voodoo who-do, what you don't dare-to people." > Malware analysis is inherently a risk no one should have to take alone. TheVooDooBox acts as your automated orchestrator, handling the "don't dare-to" tasks by isolating the execution and interaction layers within a hardened Proxmox environment. By automating the detonation and behavioral capture, it strips the "voodoo" from malicious code—leaving only the actionable intelligence behind.

It provides a real-time window into the malware's execution, allowing analysts to:
*   **Watch** the infection execute live via a high-performance VNC/Spice stream.
*   **Interact** with the malware (click dialogs, solve CAPTCHAs, traverse file systems).
*   **Observe** kernel-level events (process creation, file modification, registry connection) as they happen, with millisecond latency.

## The "Why": Kernel-to-Pixel Streaming

Traditional malware analysis often suffers from the "Black Box" problem: you submit a sample, wait 10 minutes, and get a report. If the malware detected the sandbox and quit after 5 seconds, you wasted 10 minutes.

TheVooDooBox changes this paradigm:
1.  **Immediate Feedback**: You see the VM screen the moment the task starts.
2.  **Human-in-the-Loop**: If malware pauses for user input, you provide it.
3.  **Dynamic Telemetry**: A custom Kernel Driver ("The Eye") sits in the guest VM kernel, streaming events through a high-throughput VirtIO serial bridge directly to your browser. This bypasses user-mode hooks and anti-analysis checks that often defeat standard monitoring tools.

## Key Features

*   **Live Interaction**: Full mouse and keyboard control over the guest VM.
*   **The Eye (Kernel Driver)**: A bespoke Windows kernel driver that captures elusive behaviors like remote thread injection and driver loading.
*   **Ghidra Integration**: Automated static analysis pipeline that decompiles binary functions and correlates them with dynamic behavioral events.
*   **AI Analyst**: An integrated LLM (Large Language Model) assistant that provides real-time context, explains suspicious API calls, and summarizes forensic impact based on the active event stream.
