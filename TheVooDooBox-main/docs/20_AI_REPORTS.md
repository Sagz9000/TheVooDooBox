# Understanding AI Forensic Reports

## The Verdict System

The AI assigns one of three verdicts to every analyzed binary:

1.  **[Diagnostic Alpha] (Benign)**
    - **Color**: Green
    - **Meaning**: No malicious indicators found. Safe to run.
    - *Common in*: Valid Signed Installers, System Tools.

2.  **[Diagnostic Beta] (Suspicious)**
    - **Color**: Yellow
    - **Meaning**: Anomalous behavior detected (e.g., modifying registry keys, network connections to unknown IPs), but no definitive malicious payload.
    - *Action*: Proceed with caution. Further manual analysis recommended.

3.  **[Diagnostic Gamma] (Malicious)**
    - **Color**: Red
    - **Meaning**: Confirmed malicious activity (e.g., C2 beaconing, Ransomware encryption, Process Injection).
    - *Action*: Isolate and remediate immediately.

## Threat Score Calculation

The Threat Score (0-100) is a weighted average based on:
- **Heuristics**: Number of high-severity Sysmon events (Process Create, Network Connect).
- **Static Analysis**: Presence of high-risk APIs (e.g., `VirtualAlloc`, `CreateRemoteThread`).
- **AI Confidence**: The LLM's internal certainty based on the correlation of evidence.

## Leveraging "Chain of Thought"

The **Forensic Reasoning** section in the report is your window into the AI's logic. Use it to:
- **Verify**: Check if the AI hallucinated a connection or correctly cited a PID.
- **Learn**: Understanding *why* a set of API calls is considered malicious.
- **Debug**: If the AI gives a wrong verdict, the reasoning log will usually reveal the flawed assumption.
b
## Dealing with "Unknown" Families

If the AI cannot identify a specific malware family (e.g., "Emotet"), it will label the family as **"Unknown"** but still provide a verdict based on behavior. This is common for novel or custom malware.
