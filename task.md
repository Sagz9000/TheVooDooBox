# TheVooDooBox - Interactive Malware Analysis Engine

## Current Goal: Fix Ollama IP and Sandbox Orchestration 🛠️

- [x] **Fix Backend Configuration**
    - [x] Update Ollama IP from `192.168.50.60` to `192.168.50.98` in `backend/src/main.rs`. <!-- id: 0 -->
    - [x] Ensure `HOST_IP` and other environment variables are consistent.
- [x] **Diagnose Ghidra integration issues** <!-- id: 1 -->
- [x] **Implement Ghidra Findings Pipeline**
    - [x] Create `ghidra_findings` table in Postgres <!-- id: 3 -->
    - [x] Update `FunctionExport.java` to extract decompiled code <!-- id: 4 -->
    - [x] Implement `POST /ghidra/ingest` or similar in backend to save findings <!-- id: 5 -->
    - [x] Implement `GET /tasks/{id}/ghidra-findings` in backend <!-- id: 6 -->
- [x] **Restore & Fix Forensic Report** <!-- id: 7 -->
- [x] **Sandbox Orchestration & URL Tasks**
    - [x] Verify manual VM selection in `orchestrate_sandbox`. <!-- id: 2 -->
    - [x] Test URL detonation workflow via Agent. <!-- id: 3 -->
- [x] Implement Historical AI Analytics Support
    - [x] Add `GET /tasks/{id}/ai-report` endpoint in backend
    - [x] Add `POST /tasks/{id}/analyze` endpoint in backend
    - [x] Update frontend `voodooApi` with new methods
    - [x] Integrate automatic report loading in `ReportView`
    - [x] Update `AIInsightPanel` to support task-based manual triggers
- [x] Eliminate AI Hallucinations & Improve Context
    - [x] Implement real DB fetching for Ghidra findings in `ai_analysis.rs`
    - [x] Genericize prompt examples to prevent "anchoring"
    - [x] Include Ghidra findings in AI Chat context
    - [x] Verify isolation of context between different tasks
- [x] Stabilization & Code Quality
- [x] **Verification**
    - [x] Verify AI chat can connect to Ollama at the new IP. <!-- id: 4 -->
    - [x] Verify telemetry flows correctly during URL analysis. <!-- id: 5 -->
