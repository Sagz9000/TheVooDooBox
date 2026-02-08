use sqlx::{Pool, Postgres};
use std::env;
use std::collections::HashMap;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use regex::Regex; // Added for cleaning <think> tags

// --- Raw DB Event ---
#[derive(sqlx::FromRow, Serialize, Deserialize, Debug, Clone)]
pub struct RawEvent {
    event_type: String,
    process_id: i32,
    parent_process_id: i32,
    process_name: String,
    details: String,
    timestamp: i64,
}

// --- Structured Analysis Context for LLM ---
// --- Structured Analysis Context for LLM ---
// (Moved AnalysisContext definition to below to avoid duplicates and ensure static_analysis field is present)

#[derive(Serialize, Debug, Clone)]
pub struct CriticalAlert {
    pub rule_name: String, 
    pub severity: String,
    pub details: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProcessSummary {
    pub pid: i32,
    pub ppid: i32,
    pub image_name: String,
    pub command_line: String,
    // Deduplicated activities
    pub file_activity: Vec<FileOp>,
    pub network_activity: Vec<NetworkOp>,
    pub registry_mods: Vec<RegistryOp>,
    pub behavior_tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileOp {
    pub path: String,
    pub action: String,
    pub is_executable: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NetworkOp {
    pub dest: String, // IP or Domain
    pub port: String,
    pub protocol: String,
    pub count: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegistryOp {
    pub key: String,
    pub value_name: String,
    pub data_preview: String,
}

// --- Legacy Types for main.rs compatibility ---
#[derive(Serialize, Deserialize, Debug)]
pub struct AnalysisRequest {
    pub processes: Vec<ProcessSummary>, // Simplified for legacy
    // Add other fields if main.rs populates them, but it seems to send {processes, events}
    // Checking main.rs usage: `req: web::Json<AnalysisRequest>` -> `req.into_inner()`
    // We need to see what `AnalysisRequest` looked like. Assuming generic JSON or similar.
    // Actually, based on main.rs line 1503: `req: web::Json<AnalysisRequest>`.
    // And line 1540: `serde_json::to_string(&req.into_inner())`. 
    // It's likely a struct that matches the frontend request.
    // Let's assume a generic Value or the specific fields. 
    // Frontend `getAIAnalysis` sends { processes: [...], events: [...] }.
    pub events: Vec<RawEvent>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AIReport {
    pub risk_score: i32,
    pub threat_level: String,
    pub summary: String,
    pub suspicious_pids: Vec<i32>,
    pub mitre_tactics: Vec<String>,
    pub recommendations: Vec<String>,
}

// --- LLM Response Schema (Forensic) ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ForensicReport {
    pub verdict: Verdict, 
    pub malware_family: Option<String>,
    pub threat_score: i32,
    pub executive_summary: String,
    pub behavioral_timeline: Vec<TimelineEvent>,
    pub artifacts: Artifacts,
    pub thinking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub virustotal: Option<crate::virustotal::VirusTotalData>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub related_samples: Vec<crate::memory::BehavioralFingerprint>,
}

fn default_threat_score() -> i32 { 0 }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum Verdict {
    Benign,
    Suspicious,
    Malicious,
}

impl ToString for Verdict {
    fn to_string(&self) -> String {
        match self {
            Verdict::Benign => "Benign".to_string(),
            Verdict::Suspicious => "Suspicious".to_string(),
            Verdict::Malicious => "Malicious".to_string(),
        }
    }
}

// --- Static Analysis Structures ---
#[derive(Serialize, Debug, Clone)]
pub struct StaticAnalysisData {
    pub functions: Vec<DecompiledFunction>,
    pub imported_dlls: Vec<String>,
    pub strings: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct DecompiledFunction {
    pub name: String,
    pub suspicious_tag: String, // e.g., "Network", "Injection", "Persistence"
    pub pseudocode: String,
}

const HIGH_RISK_APIS: &[(&str, &str)] = &[
    ("VirtualAlloc", "Process Injection/Memory Allocation"),
    ("WriteProcessMemory", "Process Injection/Tampering"),
    ("CreateRemoteThread", "Process Injection/Code Execution"),
    ("RegSetValueEx", "Persistence (Registry Mod)"),
    ("SetWindowsHookEx", "Keylogging/Spyware"),
    ("ShellExecute", "Execution/Lateral Movement"),
    ("InternetOpen", "Network Communication (C2)"),
    ("HttpSendRequest", "Exfiltration/C2"),
    ("GetProcAddress", "Dynamic API Resolving/Evasion"),
    ("IsDebuggerPresent", "Anti-Debugging/Evasion"),
    ("CryptEncrypt", "Ransomware/Cryptography"),
    ("AdjustTokenPrivileges", "Privilege Escalation"),
];

#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct AnalystNote {
    pub id: String,
    pub task_id: String,
    pub author: String,
    pub content: String,
    pub is_hint: bool,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone, sqlx::FromRow)]
pub struct TelemetryTag {
    pub task_id: String,
    pub event_id: i32,
    pub tag_type: String,
    pub comment: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct AnalysisContext {
    pub scan_id: String,
    pub generated_at: String,
    pub critical_alerts: Vec<CriticalAlert>,
    pub processes: Vec<ProcessSummary>,
    pub static_analysis: StaticAnalysisData,
    pub target_filename: String,
    pub patient_zero_pid: String,
    pub virustotal: Option<crate::virustotal::VirusTotalData>,
    pub analyst_notes: Vec<AnalystNote>,
    pub manual_tags: Vec<TelemetryTag>,
    pub related_samples: Vec<crate::memory::BehavioralFingerprint>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct TimelineEvent {
    pub timestamp_offset: String,
    pub stage: String, // "Execution", "Persistence", etc
    pub event_description: String,
    pub technical_context: String,
    pub related_pid: String, // Dynamic PID or "STATIC_ANALYSIS"
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Artifacts {
    #[serde(default)]
    pub dropped_files: Vec<String>,
    #[serde(default)]
    pub c2_ips: Vec<String>,
    #[serde(default)]
    pub c2_domains: Vec<String>,
    #[serde(default)]
    pub mutual_exclusions: Vec<String>,
    #[serde(default)]
    pub command_lines: Vec<String>,
}

// Fetch Ghidra analysis from the database
async fn fetch_ghidra_analysis(task_id: &String, pool: &Pool<Postgres>) -> StaticAnalysisData {
    let res = sqlx::query("SELECT function_name, decompiled_code FROM ghidra_findings WHERE task_id = $1")
        .bind(task_id)
        .fetch_all(pool)
        .await;

    match res {
        Ok(rows) => {
            use sqlx::Row;
            let functions: Vec<DecompiledFunction> = rows.into_iter().map(|row| {
                let name = row.get::<String, _>("function_name");
                let code = row.get::<String, _>("decompiled_code");

                // API Triage: Tag function based on high-risk signatures
                let mut tag = "Analyzed".to_string();
                for (api, label) in HIGH_RISK_APIS {
                    if name.contains(api) || code.contains(api) {
                        tag = label.to_string();
                        break;
                    }
                }

                DecompiledFunction {
                    name,
                    suspicious_tag: tag,
                    pseudocode: code,
                }
            }).collect();

            // Fetch unique DLLs/Strings could be added here if we had columns for them
            // For now, we provide the functions which contains the main bulk of technical context
            StaticAnalysisData {
                functions,
                imported_dlls: vec![],
                strings: vec![],
            }
        },
        Err(e) => {
            println!("[AI] Failed to fetch Ghidra findings for task {}: {}", task_id, e);
            StaticAnalysisData {
                functions: vec![],
                imported_dlls: vec![],
                strings: vec![],
            }
        }
    }
}

pub async fn generate_ai_report(
    task_id: &String, 
    pool: &Pool<Postgres>,
    ai_manager: &crate::ai::manager::AIManager
) -> Result<(), Box<dyn std::error::Error>> {

    // 1. Wait for Ghidra analysis if it's currently running
    println!("[AI] Checking Ghidra status for task {}...", task_id);
    let mut ghidra_ready = false;
    for i in 0..12 { // Wait up to 2 minutes (12 * 10s)
        let status: String = sqlx::query_scalar("SELECT ghidra_status FROM tasks WHERE id = $1")
            .bind(task_id)
            .fetch_one(pool)
            .await?;
        
        if status == "Analysis Complete" || status == "Failed" {
            ghidra_ready = true;
            break;
        }
        
        println!("[AI] Ghidra analysis for {} still pending (attempt {}/12). Waiting...", task_id, i+1);
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    }
    
    if !ghidra_ready {
        println!("[AI] Warning: Ghidra analysis timed out for task {}. Proceeding with partial data.", task_id);
    }

    // 2. Fetch Task Info (Target Filename and Hash)
    let task_row: (String, String) = sqlx::query_as("SELECT original_filename, file_hash FROM tasks WHERE id = $1")
        .bind(task_id)
        .fetch_one(pool)
        .await?;
    let target_filename = task_row.0;
    let file_hash = task_row.1;
    
    // Fetch VT Data (Cached or Fresh)
    let vt_data = crate::virustotal::get_cached_or_fetch(pool, &file_hash).await;

    // 2. Fetch Raw Telemetry (Dynamic)
    let rows = sqlx::query_as::<_, RawEvent>(
        "SELECT event_type, process_id, parent_process_id, process_name, details, timestamp 
         FROM events WHERE task_id = $1 ORDER BY timestamp ASC"
    )
    .bind(task_id)
    .fetch_all(pool)
    .await?;

    // Fetch Analyst Notes
    let analyst_notes: Vec<AnalystNote> = sqlx::query_as::<_, AnalystNote>(
        "SELECT author, content, is_hint FROM analyst_notes WHERE task_id = $1"
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Fetch Manual Tags
    let manual_tags: Vec<TelemetryTag> = sqlx::query_as::<_, TelemetryTag>(
        "SELECT event_id, tag_type, comment FROM telemetry_tags WHERE task_id = $1"
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if rows.is_empty() {
        return Ok(());
    }

    let exclude_ips_raw = env::var("EXCLUDE_IPS").unwrap_or_default();
    let exclude_ips: Vec<String> = exclude_ips_raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // 3. Aggregate Dynamic Data
    let mut context = aggregate_telemetry(task_id, rows, &target_filename, exclude_ips);
    context.virustotal = vt_data;
    context.analyst_notes = analyst_notes;
    context.manual_tags = manual_tags;

    // 4. Fetch Static Data (Ghidra)
    let mut static_data = fetch_ghidra_analysis(task_id, pool).await;
    
    // CAP context: Sort by significance (suspicious_tag != Analyzed) and limit to top 20 functions
    static_data.functions.sort_by(|a, b| {
        let a_is_suspicious = a.suspicious_tag != "Analyzed";
        let b_is_suspicious = b.suspicious_tag != "Analyzed";
        b_is_suspicious.cmp(&a_is_suspicious)
    });
    static_data.functions.truncate(20); 
    
    context.static_analysis = static_data;

    // 5. THE HIVE MIND: Generate Fingerprint and Query
    // Create a text representation of the current behavior for embedding
    let mut behavioral_text = format!("Target: {}. Root PID: {}. ", context.target_filename, context.patient_zero_pid);
    if !context.critical_alerts.is_empty() {
        behavioral_text.push_str("Critical Alerts: ");
        for alert in &context.critical_alerts {
            behavioral_text.push_str(&format!("{} ({}), ", alert.rule_name, alert.details));
        }
    }
    
    for proc in &context.processes {
        if !proc.network_activity.is_empty() {
             behavioral_text.push_str(&format!("Network: {:?}. ", proc.network_activity.iter().map(|n| &n.dest).collect::<Vec<_>>()));
        }
        if !proc.registry_mods.is_empty() {
             behavioral_text.push_str(&format!("Registry: {:?}. ", proc.registry_mods.iter().map(|r| &r.key).collect::<Vec<_>>()));
        }
    }

    println!("[HiveMind] Querying for similar samples...");
    let related_samples = crate::memory::query_similar_behaviors(behavioral_text.clone()).await.unwrap_or_default();
    if !related_samples.is_empty() {
        println!("[HiveMind] Found {} related samples.", related_samples.len());
    }
    context.related_samples = related_samples;

    // 6. Construct Hybrid Prompt
    // Extract valid PIDs for the "Menu" technique
    let valid_pids: Vec<String> = context.processes.iter().map(|p| p.pid.to_string()).collect();
    let pid_list_str = valid_pids.join(", ");

    // SAFETY CHECK: Minimal Data Warning (Balanced to avoid False Benign)
    let forced_benign_instruction = if context.processes.is_empty() || (context.processes.len() == 1 && context.processes[0].network_activity.is_empty() && context.processes[0].file_activity.is_empty()) {
        "ALERT: Telemetry is minimal. If the binary is suspicious (e.g. specialized tool or LOLBin), valid legitimate use often looks 'Benign'. However, if you see encoded commands or obfuscation, FLAG IT."
    } else {
        "INSTRUCTION: Pay close attention to processes spawned by the Target, especially if they are legitimate windows tools used as LOLBins (e.g. powershell, bitsadmin, cmd)."
    };

    // SAFETY: Aggressive Truncation for <8k Context Window
    let mut truncated_processes = context.processes.clone();
    
    // Sort by Relevance to keep interesting processes
    let root_pid = context.patient_zero_pid.parse::<i32>().unwrap_or(-1);
    truncated_processes.sort_by(|a, b| {
        let get_score = |p: &ProcessSummary| -> i32 {
             let mut score = 0;
             // Lineage Scoring
             if p.pid == root_pid { score += 5000; }
             if p.ppid == root_pid { score += 2000; }
             
             // Interest Scoring
             if !p.image_name.to_lowercase().contains("windows") && !p.image_name.to_lowercase().contains("system32") { 
                 score += 500; 
             }
             
             // Activity Scoring
             score += (p.network_activity.len() as i32) * 200; // High value on network
             score += (p.file_activity.len() as i32) * 50;
             score += (p.registry_mods.len() as i32) * 50;
             
             // Specific Suspicion Bonus
             if p.image_name.to_lowercase().contains("powershell") || p.image_name.to_lowercase().contains("cmd") || p.image_name.to_lowercase().contains("bitsadmin") {
                 if p.ppid == root_pid { score += 1000; } // LOLBin spawned by malware
             }
             
             score
        };
        get_score(b).cmp(&get_score(a))
    });

    // Increased limit to 30 processes for better context
    if truncated_processes.len() > 30 {
        truncated_processes.truncate(30);
    }
    for proc in &mut truncated_processes {
        // Network: External IPs first, then non-standard ports
        proc.network_activity.sort_by(|a, b| {
            let score = |n: &NetworkOp| {
                let mut s = 0;
                if !n.dest.starts_with("127.") && !n.dest.starts_with("192.168.") && !n.dest.starts_with("10.") { s += 100; }
                if n.port != "80" && n.port != "443" { s += 10; } // Non-standard ports slightly interesting
                s
            };
            score(b).cmp(&score(a))
        });
        if proc.network_activity.len() > 15 { proc.network_activity.truncate(15); }

        // File: Executables and sensitive paths first
        proc.file_activity.sort_by(|a, b| {
            let score = |f: &FileOp| {
                let mut s = 0;
                let path = f.path.to_lowercase();
                if f.is_executable || path.ends_with(".exe") || path.ends_with(".dll") || path.ends_with(".ps1") { s += 50; }
                if path.contains("\\users\\public\\") || path.contains("\\appdata\\") || path.contains("\\temp\\") { s += 20; }
                if path.contains("system32") { s -= 10; } // Noise reduction
                s
            };
            score(b).cmp(&score(a))
        });
        if proc.file_activity.len() > 15 { proc.file_activity.truncate(15); }

        // Registry: Persistence keys first
        proc.registry_mods.sort_by(|a, b| {
            let score = |r: &RegistryOp| {
                let mut s = 0;
                let key = r.key.to_lowercase();
                if key.contains("run") || key.contains("runonce") || key.contains("services") { s += 100; }
                s
            };
            score(b).cmp(&score(a))
        });
        if proc.registry_mods.len() > 15 { proc.registry_mods.truncate(15); }
    }

    let mut truncated_ghidra = context.static_analysis.clone();
    
    // Sort functions: Suspicious tags first
    truncated_ghidra.functions.sort_by(|a, b| {
        let score = |f: &DecompiledFunction| {
            if !f.suspicious_tag.is_empty() && f.suspicious_tag != "None" { 100 } else { 0 }
        };
        score(b).cmp(&score(a))
    });

    if truncated_ghidra.functions.len() > 15 {
        truncated_ghidra.functions.truncate(15);
    }
    for func in &mut truncated_ghidra.functions {
        if func.pseudocode.len() > 800 {
            func.pseudocode = func.pseudocode.chars().take(800).collect();
            func.pseudocode.push_str("\n...[TRUNCATED]");
        }
    }

    let sysmon_json = serde_json::to_string_pretty(&truncated_processes)?;
    let ghidra_json = serde_json::to_string_pretty(&truncated_ghidra)?;

    // Format VirusTotal Section
    let vt_section = if let Some(vt) = &context.virustotal {
        format!(
            r#"**DATA SOURCE 3: THREAT INTELLIGENCE (VIRUSTOTAL)**
- **SHA256:** {}
- **Detections:** {}
- **Threat Label:** {}
- **Family Labels:** {:?}
- **Sandox Behavior Tags:** {:?}
- **INSTRUCTION:** Use these Family Labels for attribution. Cross-reference the Sandbox Behavior Tags with the Dynamic Telemetry below. If VT detects 'debug-environment', look for IsDebuggerPresent in code or logs."#,
            vt.hash, vt.malicious_votes, vt.threat_label, vt.family_labels, vt.behavior_tags
        )
    } else {
        "**DATA SOURCE 3: THREAT INTELLIGENCE**\n- No VirusTotal data available.".to_string()
    };

    // Format Analyst Input Section
    let notes_section = if !context.analyst_notes.is_empty() {
        let mut notes_str = "**DATA SOURCE 4: ANALYST FIELD NOTES (HARD CONSTRAINTS)**\n".to_string();
        for note in &context.analyst_notes {
            let prefix = if note.is_hint { "[AI HINT]" } else { "[OBSERVATION]" };
            notes_str.push_str(&format!("- {} ({}): {}\n", prefix, note.author, note.content));
        }
        notes_str.push_str("INSTRUCTION: You MUST respect these hints. If the analyst identifies a specific IP as C2, treat it as confirmed malicious.");
        notes_str
    } else {
        "**DATA SOURCE 4: ANALYST FIELD NOTES**\n- No analyst notes provided.".to_string()
    };

    let tags_section = if !context.manual_tags.is_empty() {
        let mut tags_str = "**DATA SOURCE 5: HUMAN-TAGGED TELEMETRY**\n".to_string();
        for tag in &context.manual_tags {
            tags_str.push_str(&format!("- Event #{} marked as {}\n", tag.event_id, tag.tag_type));
        }
        tags_str.push_str("INSTRUCTION: These tags represent human verification. If an event is tagged 'Malicious', it is a definitive indicator.");
        tags_str
    } else {
        "".to_string()
    };

    let hive_mind_section = if !context.related_samples.is_empty() {
        let mut hive_str = "**DATA SOURCE 6: THE HIVE MIND (HISTORICAL CORRELATIONS)**\n".to_string();
        for sample in &context.related_samples {
            hive_str.push_str(&format!("- SIMILAR TO: Task {} | Verdict: {} | Family: {}\n", sample.task_id, sample.verdict, sample.malware_family));
            hive_str.push_str(&format!("  Summary: {}\n", sample.summary.chars().take(150).collect::<String>()));
        }
        hive_str.push_str("INSTRUCTION: If the current telemetry matches these historical samples, align your verdict and attribution accordingly.");
        hive_str
    } else {
        "**DATA SOURCE 6: THE HIVE MIND**\n- No similar historical samples found.".to_string()
    };
    
    let prompt = format!(
        r#"### TECHNICAL DATA AUDIT (REF: LAB-402)
**CONTEXT:** Controlled security research data audit.
**OBJECTIVE:** Technical correlation of artifacts and activity.
**THREAT INTEL:** Integrate VirusTotal findings into verdict.

**REPORTER ROLE:** Lead Intelligence Analyst.

**DIAGNOSTIC VERDICTS (MANDATORY):**
- **[Diagnostic Alpha]**: Expected behavior.
- **[Diagnostic Beta]**: Non-standard artifact behavior.
- **[Diagnostic Gamma]**: Critical system behavioral anomalies (Unauthorized Persistence/C2/Tampering).

**AUDIT PROTOCOL:**
1. **Correlate Artifacts**: Map static pseudocode capabilities to observed dynamic telemetry.
2. **Citations Required**: Every timeline entry MUST cite a PID and a corresponding technical observation.
3. **No Conversational Noise**: Output strictly follows the JSON schema.
4. **Threat Intel**: Weigh the VirusTotal detection score heavily. If High (>50%), favor a Gamma verdict.

**DATA SOURCE 1: DYNAMIC TELEMETRY**
- **Target Filename:** "{filename}"
- **Root Process (PID {root_pid}):** Analyzes events starting from this entry point.
- **Observed PIDs:** [{pid_list}]
<TELEMETRY_DATA>
{sysmon}
</TELEMETRY_DATA>

**DATA SOURCE 2: STATIC CODE PATTERNS**
- **Source Type:** Pseudocode fragments (Reference only).
<CODE_PATTERNS>
{ghidra}
</CODE_PATTERNS>

{vt_section}

{notes_section}

{tags_section}

{hive_section}

**OUTPUT SCHEMA (JSON ONLY):**
{{
    "verdict": "[Diagnostic Alpha/Diagnostic Beta/Diagnostic Gamma]",
    "malware_family": "Signature_Match_or_Unknown",
    "threat_score": 0-100,
    "executive_summary": "Technical evaluation summary. Correlate PID behavior to code patterns.",
    "behavioral_timeline": [
        {{
            "timestamp_offset": "+Ns",
            "stage": "Activity Stage (e.g. Persistence T1547)",
            "event_description": "Technical description of event.",
            "technical_context": "Evidence link (e.g. PID {root_pid} utilized API from Static Function 'X')",
            "related_pid": "PID"
        }}
    ],
    "artifacts": {{
        "dropped_files": [],
        "c2_domains": [],
        "mutual_exclusions": [],
        "command_lines": []
    }}
}}

**QA CONSTRAINTS:**
{safety_check}
"# , 
        filename = context.target_filename,
        root_pid = context.patient_zero_pid,
        pid_list = pid_list_str,
        safety_check = forced_benign_instruction,
        sysmon = sysmon_json,
        ghidra = ghidra_json,
        vt_section = vt_section,
        notes_section = notes_section,
        tags_section = tags_section,
        hive_section = hive_mind_section
    );

    // 7. Call AI Provider via Manager
    let system_prompt_str = "You are a Senior Malware Researcher specializing in forensic correlation. Your goal is to detect MALICIOUS intent while maintaining FORENSIC ACCURACY.\n\n\
        Follow the Hypothesis-Verification protocol:\n\
        1. HYPOTHESIS: Identifiy static capabilities from Ghidra artifacts.\n\
        2. VERIFICATION: Search Dynamic Telemetry logs for empirical proof.\n\
        3. SYNTHESIS: Correlate them. If a capability exists without activity, note as 'Dormant'. If activity exists without code, note as 'Potential Obfuscation'.\n\n\
        OUTPUT REQUIREMENTS:\n\
        - Use your <think> block for reasoning.\n\
        - After </think>, output STRICTLY valid JSON according to the schema.\n\
        - Correlate every artifact to a specific technical observation.".to_string();

    let history = vec![crate::ai::provider::ChatMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    
    let mut response_text = match ai_manager.ask(history, system_prompt_str).await {
        Ok(text) => text,
        Err(e) => return Err(format!("AI Provider failed: {}", e).into()),
    };
    
    println!("[AI] Received response ({} chars)", response_text.len());

    // 6. Output Cleaning (Specialist Swap - DeepSeek R1 Support)
    // Remove <think>...</think> blocks from reasoning models
    let re = Regex::new(r"(?s)<think>.*?</think>").unwrap();
    let cleaned_response = re.replace_all(&response_text, "");
    response_text = cleaned_response.trim().to_string();

    // Remove Markdown JSON blocks (Fix for "expected value at line 1 column 1")
    if response_text.starts_with("```") {
        let re_md = Regex::new(r"(?s)^```(?:json)?\s*(.*?)\s*```$").unwrap();
        if let Some(caps) = re_md.captures(&response_text) {
             if let Some(inner) = caps.get(1) {
                 response_text = inner.as_str().trim().to_string();
             }
        }
    }

    // 7. Neutral To Forensic Mapping (Internal Logic)
    // Map Diagnostic Alpha -> Benign, Diagnostic Beta -> Suspicious, Diagnostic Gamma -> Malicious
    response_text = response_text.replace("[Diagnostic Alpha]", "Benign")
                                .replace("[Diagnostic Beta]", "Suspicious")
                                .replace("[Diagnostic Gamma]", "Malicious")
                                .replace("Diagnostic Alpha", "Benign")
                                .replace("Diagnostic Beta", "Suspicious")
                                .replace("Diagnostic Gamma", "Malicious")
                                .replace("\"[Benign]\"", "\"Benign\"")
                                .replace("\"[Suspicious]\"", "\"Suspicious\"")
                                .replace("\"[Malicious]\"", "\"Malicious\"")
                                .replace("\"reasoning\":", "\"executive_summary\":")
                                .replace("INTERNAL_LOGIC_REVIEW", "STATIC_ANALYSIS");

    
    // 6. Extraction & Parsing
    let mut extracted_thinking = None;

    // Check for <think> tags (common in DeepSeek-R1)
    if let Some(start_idx) = response_text.find("<think>") {
        if let Some(end_idx) = response_text.find("</think>") {
            let thought_content = &response_text[start_idx + 7..end_idx];
            extracted_thinking = Some(thought_content.trim().to_string());
            // Remove the think block from the response before parsing JSON
            response_text = format!("{}{}", &response_text[..start_idx], &response_text[end_idx + 8..]);
        }
    }

    let report_result: Option<ForensicReport> = serde_json::from_str(&response_text).ok();
    
    let mut report = match report_result {
        Some(mut r) => {
            r.thinking = extracted_thinking;
            r
        },
        None => {
            // Regex Fallback
            println!("[AI] JSON Parsing Failed. Attempting Regex Fallback...");
            
            // Regex Extraction Patterns
            let re_verdict = Regex::new(r"(?i)\*\*Verdict:\*\*\s*(Custom|Benign|Suspicious|Malicious)").unwrap();
            let re_score = Regex::new(r"(?i)\*\*Threat Score:\*\*\s*(\d+)").unwrap();
            let re_summary = Regex::new(r"(?i)\*\*Executive Summary:\*\*\s*(.*?)(\n\n|\n\*\*|$)").unwrap();

            let verdict_str = re_verdict.captures(&response_text)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str())
                .unwrap_or("Suspicious"); // Default to Suspicious on parse failure

            let score = re_score.captures(&response_text)
                .and_then(|c| c.get(1))
                .and_then(|m| m.as_str().parse::<i32>().ok())
                .unwrap_or(50);

            let summary = re_summary.captures(&response_text)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().trim())
                .unwrap_or(&response_text); // Fallback to full text if summary not found

            let verdict_enum = match verdict_str.to_lowercase().as_str() {
                "benign" => Verdict::Benign,
                "malicious" => Verdict::Malicious,
                _ => Verdict::Suspicious,
            };

            println!("[AI] Regex Fallback Successful. Verdict: {:?}, Score: {}", verdict_enum, score);

            ForensicReport {
                verdict: verdict_enum,
                malware_family: None,
                threat_score: score,
                executive_summary: summary.to_string(),
                behavioral_timeline: vec![],
                artifacts: Artifacts {
                    dropped_files: vec![],
                    c2_ips: vec![],
                    c2_domains: vec![],
                    mutual_exclusions: vec![],
                    command_lines: vec![]
                },
                thinking: extracted_thinking,
                virustotal: None,
                related_samples: vec![],
            }
        }
    };

    // 7. DB Mapping (Best Effort)
    let mut suspicious_pids: Vec<i32> = report.behavioral_timeline.iter()
        .filter_map(|e| e.related_pid.parse::<i32>().ok())
        .collect();
    suspicious_pids.sort();
    suspicious_pids.dedup();
    let mitre_tactics: Vec<String> = report.behavioral_timeline.iter().map(|e| e.stage.clone()).collect();
    
    let mut recommendations = Vec::new();
    recommendations.extend(report.artifacts.c2_domains.iter().map(|d| format!("Block Domain: {}", d)));
    recommendations.extend(report.artifacts.dropped_files.iter().map(|f| format!("Delete File: {}", f)));
    
    // Inject VT Data into Report for Frontend
    report.virustotal = context.virustotal.clone(); // context holds the real data
    report.related_samples = context.related_samples.clone();
    
    // Serialize full forensic report as JSON
    let forensic_json = serde_json::to_string(&report)
        .unwrap_or_else(|_| "{}".to_string());
    
    sqlx::query(
        "INSERT INTO analysis_reports (task_id, risk_score, threat_level, summary, suspicious_pids, mitre_tactics, recommendations, forensic_report_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (task_id) DO UPDATE SET
         risk_score = EXCLUDED.risk_score,
         threat_level = EXCLUDED.threat_level,
         summary = EXCLUDED.summary,
         suspicious_pids = EXCLUDED.suspicious_pids,
         mitre_tactics = EXCLUDED.mitre_tactics,
         recommendations = EXCLUDED.recommendations,
         forensic_report_json = EXCLUDED.forensic_report_json,
         created_at = EXCLUDED.created_at"
    )
    .bind(task_id)
    .bind(report.threat_score as i32)
    .bind(report.verdict.to_string().to_uppercase())
    .bind(&report.executive_summary)
    .bind(&suspicious_pids)
    .bind(&mitre_tactics)
    .bind(&recommendations)
    .bind(&forensic_json)
    .bind(Utc::now().timestamp_millis())
    .execute(pool)
    .await?;
    
    // 8. Update Task Verdict
    let verdict_str = report.verdict.to_string(); 
    sqlx::query("UPDATE tasks SET verdict=$2, risk_score=$3 WHERE id=$1")
        .bind(task_id)
        .bind(verdict_str)
        .bind(report.threat_score as i32)
        .execute(pool)
        .await?;
    
    // 9. Generate PDF causing the "Detailed Activity Log" to match the AI's focused analysis
    let refined_context = AnalysisContext {
        processes: truncated_processes.clone(),
        static_analysis: truncated_ghidra.clone(), // Use sorted/truncated ghidra too
        ..context.clone()
    };

    match crate::reports::generate_pdf_file(task_id, &report, &refined_context) {
        Ok(pdf_bytes) => {
            let dir_path = "reports";
            if let Err(e) = std::fs::create_dir_all(dir_path) {
                println!("[AI] Failed to create reports directory: {}", e);
            }
            
            let file_path = format!("{}/{}.pdf", dir_path, task_id);
            match File::create(&file_path) {
                Ok(mut file) => {
                    if let Err(e) = file.write_all(&pdf_bytes) {
                        println!("[AI] Failed to write PDF to disk: {}", e);
                    } else {
                        println!("[AI] PDF Report saved to: {}", file_path);
                    }
                },
                Err(e) => println!("[AI] Failed to create PDF file: {}", e),
            }
        },
        Err(e) => println!("[AI] Failed to generate PDF: {}", e),
    }

    println!("[AI] Forensic Analysis Complete. Score: {}", report.threat_score);

    // 10. Store Fingerprint in The Hive Mind (Async, don't block heavily but wait for result)
    // We reuse the behavioral_text generated earlier for the embedding
    println!("[HiveMind] Storing fingerprint for Task {}...", task_id);
    let fingerprint = crate::memory::BehavioralFingerprint {
        task_id: task_id.clone(),
        verdict: report.verdict.to_string(),
        malware_family: report.malware_family.clone().unwrap_or("Unknown".to_string()),
        summary: report.executive_summary.clone(),
        tags: report.behavioral_timeline.iter().map(|t| t.stage.clone()).collect(),
    };
    
    if let Err(e) = crate::memory::store_fingerprint(fingerprint, behavioral_text).await {
        println!("[HiveMind] Failed to store fingerprint: {}", e);
    } else {
        println!("[HiveMind] Fingerprint stored successfully.");
    }

    Ok(())
}

// Helper to identify the relevant process tree (submission + children)
fn build_process_lineage(events: &[RawEvent], target_filename: &str) -> (std::collections::HashSet<i32>, i32) {
    let mut relevant_pids = std::collections::HashSet::new();
    let mut parent_map: HashMap<i32, i32> = HashMap::new();
    
    for evt in events {
        parent_map.insert(evt.process_id, evt.parent_process_id);
    }

    // Identify Patient Zero: First PROCESS_CREATE matching filename in Name ONLY
    // We strictly avoid checking 'details' (command line) because launchers like cmd.exe 
    // often contain the target name in arguments but are NOT the target process itself.
    let patient_zero = events.iter()
        .find(|e| e.event_type == "PROCESS_CREATE" && e.process_name.to_lowercase().ends_with(&target_filename.to_lowercase()));
        
    let root_pid = if let Some(pz) = patient_zero {
        pz.process_id
    } else {
        // Fallback: If no direct match, find the first non-noise PID
        // Improved Noise Filter: Use contains() to catch full paths (e.g. C:\Windows\System32\svchost.exe)
        events.iter()
            .filter(|e| !NOISE_PROCESSES.iter().any(|np| e.process_name.to_lowercase().contains(&np.to_lowercase())))
            .map(|e| e.process_id)
            .next()
            .unwrap_or(0)
    };
        
    if root_pid != 0 {
        relevant_pids.insert(root_pid);
        
        // 2. Transitive Closure: Find all descendants
        let mut changed = true;
        while changed {
            changed = false;
            for (child, parent) in &parent_map {
                if !relevant_pids.contains(child) && relevant_pids.contains(parent) {
                    relevant_pids.insert(*child);
                    changed = true;
                }
            }
        }
    }
    
    println!("[AI] Patient Zero Identified: {} (PID: {}). Total lineage: {} processes.", target_filename, root_pid, relevant_pids.len());
    (relevant_pids, root_pid)
}

const NOISE_PROCESSES: &[&str] = &[
    "voodoobox-agent.exe",
    "voodoobox-agent-windows.exe",
    "mallab-agent-windows.exe",
    "mallab-agent", // Linux/Generic variant
    "sysmon.exe",
    "sysmon64.exe",
    "conhost.exe",
    "searchindexer.exe",
    "taskhostw.exe",
    "mpcmdrun.exe",
    "msmpeng.exe",
    "chrome.exe",         // Often background noise unless specifically testing browser
    "discord.exe",
    "explorer.exe",       // Desktop noise
    "backgroundtaskhost.exe",
    "runtimebroker.exe",
    "svchost.exe",        // Although sometimes injected, usually noise unless directly spawned by malware
    "sihost.exe",
    "ctfmon.exe",
];

fn aggregate_telemetry(task_id: &String, raw_events: Vec<RawEvent>, target_filename: &str, exclude_ips: Vec<String>) -> AnalysisContext {
    let mut process_map: HashMap<i32, ProcessSummary> = HashMap::new();
    let mut critical_alerts: Vec<CriticalAlert> = Vec::new();

    let (relevant_pids, root_pid) = build_process_lineage(&raw_events, target_filename);

    for evt in &raw_events {
        let is_critical = matches!(evt.event_type.as_str(), "MEMORY_ANOMALY" | "PROCESS_TAMPER" | "REMOTE_THREAD");
        let is_relevant = relevant_pids.contains(&evt.process_id);

        // Logic Fix:
        // 1. If Critical -> Keep.
        // 2. If PID is Relevant (Patient Zero Lineage) -> Keep EVERYTHING.
        // 3. Else (Noise) -> Skip.
        if !is_critical && !is_relevant {
            continue; 
        }

        process_map.entry(evt.process_id).or_insert(ProcessSummary {
            pid: evt.process_id,
            ppid: evt.parent_process_id,
            image_name: evt.process_name.clone(),
            command_line: "Unknown".to_string(), // Default
            file_activity: Vec::new(),
            network_activity: Vec::new(),
            registry_mods: Vec::new(),
            behavior_tags: Vec::new(),
        });

        let proc = process_map.get_mut(&evt.process_id).unwrap();

        match evt.event_type.as_str() {
            "PROCESS_CREATE" => {
               // Parse Command Line
               // Format usually: "Process Created: c:\path\malware.exe Command Line: malware.exe -evil"
               if let Some(pos) = evt.details.find("Command Line: ") {
                   proc.command_line = evt.details[pos+14..].trim().to_string();
               } else {
                   proc.command_line = evt.details.clone();
               }
            },
            "NETWORK_CONNECT" | "NETWORK_DNS" => {
                // Parse details: "SYSMON: TCP 192.168.1.5:5433 -> 142.250.1.1:443" OR "SYSMON: DNS: query -> result"
                // Simplified fuzzy parsing for robustness
                let dest = if evt.details.contains("->") {
                    evt.details.split("->").nth(1).unwrap_or("unknown").trim().to_string()
                } else {
                    evt.details.clone()
                };

                // Filter out excluded IPs (e.g. backend)
                let ip_only = dest.split(':').next().unwrap_or(&dest);
                if exclude_ips.iter().any(|ex| ip_only == ex) {
                    continue;
                }
                
                // Deduplicate
                if let Some(existing) = proc.network_activity.iter_mut().find(|n| n.dest == dest) {
                    existing.count += 1;
                } else {
                    let port = if dest.contains(':') {
                        dest.split(':').last().unwrap_or("0").to_string()
                    } else { "0".to_string() };
                    
                    proc.network_activity.push(NetworkOp {
                        dest,
                        port,
                        protocol: if evt.event_type.contains("DNS") { "DNS".into() } else { "TCP".into() },
                        count: 1
                    });
                }
            },
            "FILE_CREATE" | "FILE_MODIFY" | "DOWNLOAD_DETECTED" | "ADS_CREATED" => {
                // Parse: "File Activity: C:\Path (SHA256...)"
                let path = if let Some(idx) = evt.details.find("File Activity: ") {
                    evt.details[idx+15..].split('(').next().unwrap_or("").trim().to_string()
                } else if let Some(idx) = evt.details.find("File Created: ") {
                    evt.details[idx+14..].trim().to_string()
                } else {
                    evt.details.clone()
                };
                
                let is_exe = path.to_lowercase().ends_with(".exe") || path.to_lowercase().ends_with(".ps1");
                
                // Deduplicate
                if !proc.file_activity.iter().any(|f| f.path == path) {
                     proc.file_activity.push(FileOp {
                        path, 
                        action: evt.event_type.clone(),
                        is_executable: is_exe
                    });
                }
            },
            "REGISTRY_SET" => {
                // Parse: "Registry Modified: HKLM\Key Value: 'Name' New Data: '...'"
                let key = evt.details.split("Value:").next().unwrap_or("").replace("Registry Modified:", "").trim().to_string();
                let val_name = evt.details.split("Value:").nth(1).unwrap_or("").split("Data:").next().unwrap_or("").replace("'", "").trim().to_string();
                
                proc.registry_mods.push(RegistryOp {
                    key,
                    value_name: val_name,
                    data_preview: evt.details.chars().take(100).collect(), // Limit length
                });
            },
            "MEMORY_ANOMALY" | "PROCESS_TAMPER" | "REMOTE_THREAD" => {
                critical_alerts.push(CriticalAlert {
                    rule_name: evt.event_type.clone(),
                    severity: "HIGH".to_string(),
                    details: format!("PID {}: {}", evt.process_id, evt.details)
                });
                proc.behavior_tags.push(evt.event_type.clone());
            },
            _ => {}
        }
    }

    AnalysisContext {
        scan_id: task_id.clone(),
        generated_at: Utc::now().to_rfc3339(),
        critical_alerts,
        processes: process_map.into_values().collect(),
        static_analysis: StaticAnalysisData {
            functions: vec![],
            imported_dlls: vec![],
            strings: vec![],
        },
        target_filename: target_filename.to_string(),
        patient_zero_pid: root_pid.to_string(),
        virustotal: None, // Will be populated in generate_ai_report
        analyst_notes: vec![],
        manual_tags: vec![],
        related_samples: vec![],
    }
}
