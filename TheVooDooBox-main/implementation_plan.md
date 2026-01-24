# AI Hallucination & Context Isolation Fix

The current AI analysis pipeline is prone to hallucinations because it utilizes hardcoded mock data for Ghidra findings and incorporates overly specific examples in its prompts, which the LLM often mimics. Furthermore, the AI chat lacks specific context about Ghidra analysis for the current task.

## Proposed Changes

### [Backend] AI Analysis Engine (`backend/src/ai_analysis.rs`)

#### [MODIFY] [ai_analysis.rs](file:///d:/aitesting/maldocv1/backend/src/ai_analysis.rs)
- Remove hardcoded mock data from `fetch_ghidra_analysis`.
- Implement actual database query for `ghidra_findings` associated with the `task_id`.
- Update the prompt in `generate_ai_report`:
    - Genericize the JSON example (e.g., use `[FILENAME]`, `[PID]`, `[IP_ADDRESS]`).
    - Add explicit instructions: "STRICTLY use only the provided telemetry and static analysis data. Do NOT invent behaviors, filenames, or C2 addresses not found in the logs."
    - Improve the differentiation between static analysis context and dynamic telemetry context.

### [Backend] Core API (`backend/src/main.rs`)

#### [MODIFY] [main.rs](file:///d:/aitesting/maldocv1/backend/src/main.rs)
- Update `chat_handler`:
    - Fetch and include Ghidra findings for the current `task_id` in the AI prompt.
    - Improve the "Filtered Behavioral Telemetry" section to be more descriptive.
    - Ensure the "RECENTLY ANALYZED FILES" section doesn't confuse the model about the *current* target file.
- Update `ai_insight_handler`:
    - (Optional) If this endpoint is used for live sessions, ensure it doesn't leak context from other sessions if events are not correctly scoped (though it currently takes `events` as input).

## Verification Plan

### Automated Tests
- Run `manual analysis` via the UI for a fresh task.
- Verify the generated `AI Insight` report mentions the CORRECT filenames and PIDs as seen in the telemetry logs.
- Verify the report DOES NOT mention mock data (`opushutil.exe`, `malicious-c2.com`).

### Manual Verification
- Interaction with the AI Chat:
    - Ask: "What functions did Ghidra find in this binary?"
    - Verify it lists the actual functions analyzed for the current task.
- Verify the "RUN ANALYTICS" button in `ReportView` correctly triggers the updated pipeline.
