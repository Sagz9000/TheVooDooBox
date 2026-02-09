# Analyst Guide: Running & Interpreting Scans

## 1. Submitting a Sample
1.  Navigate to the **Control Panel** (`http://localhost:3000`).
2.  Drag and drop your target binary (EXE/DLL) into the "Upload New Task" area.
3.  Click **Start Analysis**.

## 2. The Analysis Process (What Happens Next?)
- **Step 1**: The file is sent to the Sandbox VM.
- **Step 2**: The Kernel Driver monitors execution for ~60 seconds.
- **Step 3**: Headless Ghidra decompiles the binary in parallel.
- **Step 4**: The AI correlates the streams.

## 3. Interpreting the Forensic Report

The new AI-generated report is divided into four key sections:

### A. Executive Summary & Verdict
- **Verdict**: Color-coded (Green/Yellow/Red).
  - *Note: "Diagnostic Gamma" = Malicious.*
- **Threat Score**: A 0-100 confidence score.
- **Summary**: A high-level overview of the malware's intent.

### B. Forensic Reasoning (Chain of Thought) [NEW]
This scrollable console block reveals the **AI's internal monologue**. You can see exactly *why* it reached a conclusion.
- *Look for*: logic verification, hypothesis testing, and rule matching.

### C. Static Analysis Insights (Ghidra) [NEW]
This section lists specific code patterns found in the binary.
- *Example*: "Function `FUN_00401000` calls `InternetOpenUrlA`, correlating with the network traffic to `1.2.3.4`."

### D. Behavioral Timeline
An interactive list of events sorted by time.
- Click on **PID Buttons** to filter events by process.
- Events are tagged with Mitre ATT&CK tactics (e.g., `Persistence`, `Execution`).

## 4. Chat with Malware
Use the floating chat window to ask specific questions about the analysis:
- "What registry keys did it modify?"
- "Explain the persistence mechanism in detail."
- "Show me the decompiled code for function X."
