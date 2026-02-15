# Analyst Guide: Running Investigations (v2.8)

## 1. Submitting a Sample

1.  Navigate to the **Dashboard** (`/`).
2.  Drag & Drop your malware (`.exe`, `.dll`, `.ps1`) into the "Upload Zone".
3.  **Analysis Configuration**:
    *   **Analysis Duration**: Default 120s (Increase for long-running malware).
    *   **AI Mode**:
        *   **Hybrid (Recommended)**: Private Map + Cloud Reason. Best balance.
        *   **Local Only**: Use this for highly sensitive samples. No data leaves the network.
        *   **Cloud Only**: Fastest reasoning, but sends raw telemetry to Gemini.

## 2. Monitoring Progress

Once submitted, the task moves to the **"Running Tasks"** list.
*   **Status Bar**: Indicates the current phase (Sandbox Execution -> Telemetry Stream -> AI Analysis).
*   **Console Output**: Watch the real-time logs for kernel driver events (`PROCESS_CREATE`, `IMAGE_LOAD`).

## 3. Interpreting the Forensic Report

The **Neural Report** tab is your primary view.

### A. Executive Summary & Verdict
The AI provides a definitive verdict (`Malicious`, `Suspicious`, `Benign`) and a confidence score.
*   **Threat Score**: 0-100 ring. >70 is critical.
*   **Summary**: A plain-English explanation of *why* the sample is malicious.

### B. MITRE ATT&CK Matrix
The AI maps observed behaviors to the MITRE framework.
*   **Tactic**: e.g., "Persistence".
*   **Technique**: e.g., "Registry Run Keys / Startup Folder".
*   **Evidence**: The specific API call or command line that triggered the detection.

### C. Behavioral Timeline
A chronological reconstruction of the attack chain.
*   **Timestamps**: Relative to start (e.g., `+00:02s`).
*   **Context**: Explains the sequence (e.g., "Dropper spawned PowerShell which downloaded payload").

### D. Static Analysis (Remnux)
If configured, this section shows deep static insights:
*   **Floss**: Obfuscated strings recovered from memory.
*   **Capa**: Malicious capabilities detected in the binary (e.g., "connects to C2").
*   **YARA**: Rule matches.

## 4. Activity Flow (Fishbone Diagram)

Switch to the **"Activity Flow"** tab for a visual investigation.
*   **Root Node**: The sample you submitted.
*   **Branches**: Child processes spawned by the malware.
*   **Interaction**: Click any node to see:
    *   **Network**: IPs/Domains contacted.
    *   **Files**: Dropped payloads.
    *   **Registry**: Persistence mechanisms.

## 5. Manual Actions

You can interact with the running VM directly:
*   **Terminate**: Kill a specific process ID.
*   **Input**: Send keystrokes or mouse clicks if the malware requires interaction.
*   **VNC**: View the VM desktop in real-time.
