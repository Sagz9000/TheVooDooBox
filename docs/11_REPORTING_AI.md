# Reporting & AI Analysis Pipeline

TheVooDooBox is designed to transform thousands of raw kernel events into a single, actionable forensic report. This process involves sophisticated data aggregation, LLM-based triage, and automated document generation.

## 1. The Data Pipeline

The path from execution to report follows these logical stages:

1.  **Event Capture**: "The Eye" driver captures raw behavioral data.
2.  **Aggregation**: The backend filters noise and builds a **Process Lineage** (identifying the malware and all its descendants).
3.  **Context Enrichment**: Ghidra static findings (decompiled functions) are merged with the dynamic behavioral data.
4.  **AI Synthesis**: An LLM analyzes the hybrid context to produce a structured `ForensicReport`.
5.  **Artifact Generation**: The system compiles a professional PDF for human review.

## 2. Telemetry Aggregation (`ai_analysis.rs`)

To avoid overwhelming the AI, we use a specialized aggregation logic:

*   **Process Lineage Tracing**: We identify "Patient Zero" (the initial malware process) and recursively track every child process spawned during the session.
*   **Noise Filtering**: Common system processes (e.g., `explorer.exe`, `svchost.exe`) are excluded unless they are directly involved in suspicious activity like remote thread injection.
*   **Data Deduplication**: Frequent events like repeated registry reads are collapsed into summary counts to maintain a concise analysis context.

## 3. The AI Forensic Triage

The backend constructs a high-density JSON payload containing the aggregated process activity and Ghidra findings. This is sent to the LLM with a strictly defined output schema.

### AI Output Structure
The AI is instructed to return a JSON object with:
*   **Verdict**: Malicious, Suspicious, or Benign.
*   **Malware Family**: Identified threat actor or tool (if discernible).
*   **Executive Summary**: A high-level technical narrative explaining the attack.
*   **Behavioral Timeline**: A chronological reconstruction of significant events (e.g., "Persistence via `HKLM\...\Run`").
*   **Extracted IOCs**: C2 IPs, domains, and paths of dropped files.

## 4. Automated PDF Reporting (`reports.rs`)

Once the AI report is finalized, the `genpdf` engine generates a forensic document.

### Report Components
*   **Visual Branding**: Custom header with the VoodooBox logo and task metadata.
*   **Verdict Panel**: Color-coded risk assessment (Red/Orange/Green).
*   **Interactive Timeline**: Table view of the attack stages identified by the AI.
*   **Process Tree**: A visual representation of the execution flow, highlighting suspicious PIDs in red.
*   **Artifact List**: Categorized list of Indicators of Compromise (IOCs) for rapid security team response.

![Forensic Report View](../TheVooDooBox-main/pictures/reportview.png)

## 5. Persistence & Retrieval

![Generated PDF Report](../TheVooDooBox-main/pictures/aigeneratedindicatorreport.png)

All reports are stored in the PostgreSQL `analysis_reports` table and the PDF files are saved locally to the `/reports` directory. Analysts can retrieve previous reports via:
*   **UI**: Clicking "View Report" on any completed task.
*   **API**: `GET /api/tasks/{task_id}/ai-report`
*   **FileSystem**: Browsing the persisted PDF volumes.
