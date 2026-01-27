# Reporting & AI Analysis Pipeline

TheVooDooBox is designed to transform thousands of raw kernel events into a single, actionable forensic report. This process involves sophisticated data aggregation, LLM-based triage, and automated document generation.

## 1. The Data Pipeline

The path from execution to report follows these logical stages:

1.  **Event Capture**: "The Eye" driver captures raw behavioral data.
2.  **Aggregation**: The backend filters noise and builds a **Process Lineage** (identifying the malware and all its descendants).
3.  **Context Enrichment**: Ghidra static findings (decompiled functions) are merged with the dynamic behavioral data.
4.  **Threat Corroboration**: VirusTotal intelligence is fetched and injected to validate findings.
5.  **AI Synthesis**: An LLM analyzes the hybrid context to produce a structured `ForensicReport`.
6.  **Artifact Generation**: The system compiles a professional PDF for human review.

## 2. Telemetry Aggregation (`ai_analysis.rs`)

To avoid overwhelming the AI, we use a specialized aggregation logic:

*   **Process Lineage Tracing**: We identify "Patient Zero" (the initial malware process) and recursively track every child process spawned during the session.
*   **High-Value Filtering**: Aggressively drops noise events. Only critical Sysmon IDs (1, 3, 8, 11) from descending lineages are preserved, reducing log volume by ~95%.
*   **PID Menu Generation**: The backend extracts all valid PIDs from the telemetry and injects them as a "Factual Cheat Sheet" into the AI prompt. This ensures the AI never hallucinates process IDs.

## 3. The AI Forensic Triage (Paranoid Mode)

The backend constructs a high-density JSON payload containing the aggregated process activity and Ghidra findings. This is analyzed by the **Elite Threat Hunter** persona:

### Behavioral Bias (Detective Mode)
The AI is instructed to assume the provided telemetry represents malicious activity. It scrutinizes "benign-looking" tool usage (like `powershell`, `certutil`, `bitsadmin`) for malicious context, ensuring it identifies threats that simpler models might miss.

### Data Fidelity (Clerk Mode)
While the analysis is "paranoid," the identifiers must be exact. The AI is strictly forbidden from using placeholder data and must map every observation back to the **PID Menu** provided in the prompt.

### Efficiency Rules
Reasoning is capped with a "Thinking Budget" to avoid loops, ensuring reports are generated within 45-120 seconds even on mid-range hardware.

### AI Output Structure
The AI is instructed to return a JSON object with:
*   **Verdict**: Malicious, Suspicious, or Benign (based on behavior, not signatures).
*   **Malware Family**: Identified threat actor or tool.
*   **Executive Summary**: A high-level technical narrative explaining the attack.
*   **Behavioral Timeline**: A chronological reconstruction of significant events with exact PID mappings.
*   **Extracted IOCs**: C2 IPs, domains, and paths of dropped files.

## 4. Automated PDF Reporting (`reports.rs`)

Once the AI report is finalized, the `genpdf` engine generates a forensic document.

### Report Components
*   **Visual Branding**: Custom header with the VoodooBox logo and task metadata.
*   **Verdict Panel**: Color-coded risk assessment (Red/Orange/Green).
*   **Interactive Timeline**: Table view of the attack stages identified by the AI.
*   **Process Tree**: A visual representation of the execution flow, highlighting suspicious PIDs in red.
*   **Threat Intelligence**: VirusTotal detection scores, behavior tags, and family labels.
*   **Artifact List**: Categorized list of Indicators of Compromise (IOCs) for rapid security team response.

![Forensic Report View](../TheVooDooBox-main/pictures/reportview.png)

## 5. Persistence & Retrieval

![Generated PDF Report](../TheVooDooBox-main/pictures/aigeneratedindicatorreport.png)

All reports are stored in the PostgreSQL `analysis_reports` table and the PDF files are saved locally to the `/reports` directory. Analysts can retrieve previous reports via:
*   **UI**: Clicking "View Report" on any completed task.
*   **API**: `GET /api/tasks/{task_id}/ai-report`
*   **FileSystem**: Browsing the persisted PDF volumes.
