use sqlx::{Pool, Postgres};
use std::env;
use std::collections::HashMap;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde::de::{self, Deserializer};
use std::fs::File;
use std::io::Write;
use regex::Regex;

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

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct RelatedSample {
    pub name: String,
    pub similarity: f32,
}

// --- LLM Response Schema (Forensic) ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ForensicReport {
    pub verdict: Verdict, 
    pub malware_family: Option<String>,
    #[serde(deserialize_with = "deserialize_number")]
    pub threat_score: i32,
    pub executive_summary: String,
    pub behavioral_timeline: Vec<TimelineEvent>,
    pub artifacts: Artifacts,
    #[serde(default)]
    pub thinking: Option<String>,
    #[serde(default)]
    pub virustotal: Option<crate::virustotal::VirusTotalData>,
    #[serde(default)]
    pub related_samples: Vec<crate::memory::BehavioralFingerprint>,
}

fn deserialize_number<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    let v: serde_json::Value = serde::Deserialize::deserialize(deserializer)?;
    match v {
        serde_json::Value::Number(n) => n.as_i64().map(|i| i as i32).ok_or_else(|| de::Error::custom("Invalid number")),
        serde_json::Value::String(s) => s.parse::<i32>().or_else(|_| {
            // Extract first number found
            let re = Regex::new(r"(\d+)").unwrap();
            if let Some(caps) = re.captures(&s) {
                caps.get(1).unwrap().as_str().parse::<i32>().map_err(de::Error::custom)
            } else {
                Ok(0)
            }
        }),
        _ => Ok(0),
    }
}

fn deserialize_pid<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_number(deserializer)
}

fn default_threat_score() -> i32 { 0 }

/// Robustly attempts to repair truncated JSON by closing unclosed objects/arrays.
fn recover_truncated_json(input: &str) -> String {
    let mut output = input.trim().to_string();
    if output.is_empty() { return output; }
    
    let mut stack = Vec::new();
    let mut in_string = false;
    let mut escaped = false;

    for (_pos, c) in output.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' {
            escaped = true;
            continue;
        }
        if c == '"' {
            in_string = !in_string;
            continue;
        }
        if !in_string {
            if c == '{' || c == '[' {
                stack.push(c);
            } else if c == '}' || c == ']' {
                stack.pop();
            }
        }
    }

    // If we are mid-string, close it
    if in_string {
        output.push('"');
    }

    // If we have unbalanced open brackets, we might have a truncated field or item.
    // E.g. "... "behavioral_timeline": [" or "... "related_pid": 123"
    // We try to validly close the stack.
    while let Some(top) = stack.pop() {
        match top {
            '{' => {
                // If it ends with a comma or colon, it's a truncated key/val. We can't easily fix mid-val.
                // But we can try to close the object.
                output.push('}');
            }
            '[' => {
                output.push(']');
            }
            _ => {}
        }
    }

    output
}

/// Last resort: Use Regex to extract individual TimelineEvent objects from a broken JSON string.
fn extract_timeline_via_regex(text: &str) -> Vec<TimelineEvent> {
    let mut events = Vec::new();
    // This regex looks for individual { ... } objects that look like TimelineEvents
    let re_event = Regex::new(r#"(?s)\{\s*"timestamp_offset":\s*"(?P<ts>[^"]+)"\s*,\s*"stage":\s*"(?P<stage>[^"]+)"\s*,\s*"event_description":\s*"(?P<desc>[^"]+)"\s*,\s*"technical_context":\s*"(?P<ctx>[^"]+)"\s*,\s*"related_pid":\s*(?P<pid>[^,\s}]+)\s*\}"#).unwrap();

    for caps in re_event.captures_iter(text) {
        let ts = caps.name("ts").map(|m| m.as_str().to_string()).unwrap_or_default();
        let stage = caps.name("stage").map(|m| m.as_str().to_string()).unwrap_or_default();
        let desc = caps.name("desc").map(|m| m.as_str().to_string()).unwrap_or_default();
        let ctx = caps.name("ctx").map(|m| m.as_str().to_string()).unwrap_or_default();
        let pid_str = caps.name("pid").map(|m| m.as_str().replace("\"", "")).unwrap_or_default();
        
        // Use a simple number extraction for the PID string
        let pid = pid_str.chars().filter(|c| c.is_digit(10)).collect::<String>().parse::<i32>().unwrap_or(0);

        events.push(TimelineEvent {
            timestamp_offset: ts,
            stage,
            event_description: desc,
            technical_context: ctx,
            related_pid: pid,
        });
    }
    events
}

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
    #[serde(deserialize_with = "deserialize_pid")]
    pub related_pid: i32, // Dynamic PID
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

    // Aggressive Truncation for <8k Context Window
    let mut truncated_processes = context.processes.clone();
    
    // Sort by Relevance to keep interesting processes
    let root_pid_num = context.patient_zero_pid.parse::<i32>().unwrap_or(-1);
    truncated_processes.sort_by(|a, b| {
        let get_score = |p: &ProcessSummary| -> i32 {
             let mut score = 0;
             // Lineage Scoring
             if p.pid == root_pid_num { score += 5000; }
             if p.ppid == root_pid_num { score += 2000; }
             
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
                 if p.ppid == root_pid_num { score += 1000; } // LOLBin spawned by malware
             }
             
             score
        };
        get_score(b).cmp(&get_score(a))
    });

    // Moderate limit: 10 processes to save tokens
    if truncated_processes.len() > 10 {
        truncated_processes.truncate(10);
    }
    for proc in &mut truncated_processes {
        // Network: External IPs first
        proc.network_activity.sort_by(|a, b| {
            let score = |n: &NetworkOp| {
                let mut s = 0;
                if !n.dest.starts_with("127.") && !n.dest.starts_with("192.168.") && !n.dest.starts_with("10.") { s += 100; }
                if n.port != "80" && n.port != "443" { s += 10; }
                s
            };
            score(b).cmp(&score(a))
        });
        if proc.network_activity.len() > 8 { proc.network_activity.truncate(8); }

        // File: Executables first
        proc.file_activity.sort_by(|a, b| {
            let score = |f: &FileOp| {
                let mut s = 0;
                let path = f.path.to_lowercase();
                if f.is_executable || path.ends_with(".exe") || path.ends_with(".dll") || path.ends_with(".ps1") { s += 50; }
                if path.contains("\\users\\public\\") || path.contains("\\appdata\\") || path.contains("\\temp\\") { s += 20; }
                s
            };
            score(b).cmp(&score(a))
        });
        if proc.file_activity.len() > 8 { proc.file_activity.truncate(8); }

        // Registry
        if proc.registry_mods.len() > 8 { proc.registry_mods.truncate(8); }
    }

    let mut truncated_ghidra = context.static_analysis.clone();
    
    // Sort functions: Suspicious tags first
    truncated_ghidra.functions.sort_by(|a, b| {
        let score = |f: &DecompiledFunction| {
            if !f.suspicious_tag.is_empty() && f.suspicious_tag != "None" { 100 } else { 0 }
        };
        score(b).cmp(&score(a))
    });

    if truncated_ghidra.functions.len() > 12 {
        truncated_ghidra.functions.truncate(12);
    }
    for func in &mut truncated_ghidra.functions {
        if func.pseudocode.len() > 600 {
            func.pseudocode = func.pseudocode.chars().take(600).collect();
            func.pseudocode.push_str("\n...[TRUNCATED]");
        }
    }

    let sysmon_json = serde_json::to_string_pretty(&truncated_processes).unwrap_or_default();
    let ghidra_json = serde_json::to_string_pretty(&truncated_ghidra.functions).unwrap_or_default();
    
    let vt_section = if let Some(vt) = &context.virustotal {
        format!("**DATA SOURCE 3: THREAT INTEL (VIRUSTOTAL)**\n- Detections: {}\n- Label: {}\n- Family: {:?}\n- Behavior: {:?}", 
            vt.malicious_votes, vt.threat_label, vt.family_labels, vt.behavior_tags)
    } else {
        "**DATA SOURCE 3: THREAT INTEL**\n- No VirusTotal data found for this hash.".to_string()
    };

    // Format Analyst Input Section
    let notes_section = if !context.analyst_notes.is_empty() {
        let mut notes_str = "**DATA SOURCE 4: ANALYST FIELD NOTES**\n".to_string();
        for note in &context.analyst_notes {
            let prefix = if note.is_hint { "[AI HINT]" } else { "[OBSERVATION]" };
            notes_str.push_str(&format!("- {} ({}): {}\n", prefix, note.author, note.content));
        }
        notes_str.push_str("INSTRUCTION: You MUST respect these hints.");
        notes_str
    } else {
        "".to_string()
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

    let hive_section = if !context.related_samples.is_empty() {
        let mut hive_str = "**DATA SOURCE 6: THE HIVE MIND (HISTORICAL CORRELATIONS)**\n".to_string();
        for sample in &context.related_samples {
            hive_str.push_str(&format!("- SIMILAR TO: Task {} | Verdict: {} | Family: {}\n", sample.task_id, sample.verdict, sample.malware_family));
            hive_str.push_str(&format!("  Summary: {}\n", sample.summary.chars().take(150).collect::<String>()));
        }
        hive_str
    } else {
        "".to_string()
    };
    
    let prompt = format!(
        r#"### TECHNICAL DATA AUDIT (REF: LAB-402)
OBJECTIVE: Technical correlation of artifacts and activity.
DIAGNOSTIC VERDICTS: [Diagnostic Alpha], [Diagnostic Beta], [Diagnostic Gamma].

DATA SOURCE 1: DYNAMIC TELEMETRY
- Target: "{filename}" (PID {root_pid})
- Observed PIDs: [{pid_list}]
<TELEMETRY_DATA>
{sysmon}
</TELEMETRY_DATA>

DATA SOURCE 2: STATIC CODE PATTERNS
<CODE_PATTERNS>
{ghidra}
</CODE_PATTERNS>

{vt_section}
{notes_section}
{tags_section}
{hive_section}

OUTPUT SCHEMA (JSON ONLY):
{{
    "verdict": "[Diagnostic Alpha/Diagnostic Beta/Diagnostic Gamma]",
    "malware_family": "String",
    "threat_score": 0-100,
    "executive_summary": "Technical evaluation summary.",
    "behavioral_timeline": [
        {{
            "timestamp_offset": "+Ns",
            "stage": "Activity Stage",
            "event_description": "Technical description.",
            "technical_context": "Evidence link.",
            "related_pid": 123
        }}
    ],
    "artifacts": {{ "dropped_files": [], "c2_domains": [], "mutual_exclusions": [], "command_lines": [] }}
}}
"# , 
        filename = context.target_filename,
        root_pid = context.patient_zero_pid,
        pid_list = pid_list_str,
        sysmon = sysmon_json,
        ghidra = ghidra_json,
        vt_section = vt_section,
        notes_section = notes_section,
        tags_section = tags_section,
        hive_section = hive_section
    );

    // 7. Call AI Provider via Manager
    let system_prompt_str = "You are a Senior Malware Researcher. Output strictly follows the JSON schema. \
        Avoid preamble, avoid markdown fences if possible, just output the JSON object. \
        Correlate telemetry to code patterns.".to_string();

    let history = vec![crate::ai::provider::ChatMessage {
        role: "user".to_string(),
        content: prompt,
    }];
    
    let mut response_text = match ai_manager.ask(history, system_prompt_str).await {
        Ok(text) => text,
        Err(e) => return Err(format!("AI Provider failed: {}", e).into()),
    };
    
    println!("[AI] Received response ({} chars)", response_text.len());

    // 6. Extraction & Parsing
    let mut extracted_thinking = None;

    // STEP A: CRITICAL FIX - Detect if the response is a JSON string containing escaped JSON
    // Check this FIRST, because if the whole response is double-encoded, <think> tags and JSON are hidden inside
    if response_text.trim().starts_with('"') && response_text.trim().ends_with('"') {
        // Try to parse as a JSON string first
        if let Ok(unescaped) = serde_json::from_str::<String>(&response_text) {
            println!("[AI] Detected double-encoded response, unescaping...");
            response_text = unescaped.trim().to_string();
        }
    }

    // STEP B: Extract <think> tags (Common in DeepSeek-R1)
    if let Some(start_idx) = response_text.find("<think>") {
        if let Some(end_idx) = response_text.find("</think>") {
            let thought_content = &response_text[start_idx + 7..end_idx];
            extracted_thinking = Some(thought_content.trim().to_string());
            println!("[AI] Extracted 'Thinking' process ({} chars)", thought_content.len());
            
            // Remove the think block from the response before parsing JSON
            response_text = format!("{}{}", &response_text[..start_idx], &response_text[end_idx + 8..]);
        }
    } else {
        // Fallback: Try Regex
        let re_think = Regex::new(r"(?s)<think>(.*?)</think>").unwrap();
        if let Some(caps) = re_think.captures(&response_text) {
            if let Some(thought) = caps.get(1) {
                extracted_thinking = Some(thought.as_str().trim().to_string());
                println!("[AI] Extracted 'Thinking' process via Regex ({} chars)", thought.as_str().len());
                response_text = re_think.replace(&response_text, "").to_string();
            }
        }
    }
    
    response_text = response_text.trim().to_string();
    // --- ROBUST JSON PARSING PIPELINE ---
    let mut current_json = response_text.clone();
    let mut report_result: Option<ForensicReport> = None;

    for pass in 0..4 {
        let trimmed = current_json.trim();
        if trimmed.is_empty() { break; }

        // 1. Try direct parse
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if value.is_object() {
                // It's a valid object! Try to map to ForensicReport
                if let Ok(r) = serde_json::from_value::<ForensicReport>(value) {
                    report_result = Some(r);
                    break;
                }
            } else if let Some(inner_str) = value.as_str() {
                // It's a string containing JSON! Unescape and try again
                println!("[AI] Detected string-wrapped JSON (Pass {}), unescaping...", pass);
                current_json = inner_str.trim().to_string();
                continue;
            }
        }

        // 2. If parsing failed, try to find bounds { ... }
        if let Some(start) = current_json.find('{') {
            if let Some(end) = current_json.rfind('}') {
                if end > start {
                    let extracted = &current_json[start..=end];
                    // If it looks escaped, clean it manually
                    if extracted.contains("\\\"") {
                        current_json = extracted.replace("\\\"", "\"")
                                               .replace("\\n", "\n")
                                               .replace("\\r", "");
                    } else {
                        current_json = extracted.to_string();
                    }
                    
                    // Re-clean common neural/logic markers that might be inside the JSON
                    current_json = current_json.replace("[Diagnostic Alpha]", "Benign")
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
                    
                    if pass < 2 { continue; } // Try parsing the cleaned version
                }
            }
        }

        // 3. Last Resort: Try to repair truncated JSON
        if pass == 2 {
            println!("[AI] JSON still failing (Pass 2). Attempting truncated repair...");
            current_json = recover_truncated_json(&current_json);
            continue;
        }

        break;
    }
    
    let mut report = match report_result {
        Some(mut r) => {
            r.thinking = extracted_thinking;
            r
        },
        None => {
            // Regex Fallback
            println!("[AI] JSON Parsing Failed. Attempting Regex Fallback and Salvage...");
            
            // Regex Extraction Patterns for Summary
            let re_verdict = Regex::new(r"(?i)\*\*Verdict:\*\*\s*(Custom|Benign|Suspicious|Malicious|Diagnostic Alpha|Diagnostic Beta|Diagnostic Gamma)").unwrap();
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
                s if s.contains("benign") || s.contains("alpha") => Verdict::Benign,
                s if s.contains("malicious") || s.contains("gamma") => Verdict::Malicious,
                _ => Verdict::Suspicious,
            };

            // --- TIMELINE SALVAGE ---
            // If JSON failed, we use Regex to find every valid { timestamp, stage... } block in the raw text
            let salvaged_timeline = extract_timeline_via_regex(&response_text);
            if !salvaged_timeline.is_empty() {
                println!("[AI] Salvaged {} timeline events from fragmented response.", salvaged_timeline.len());
            }

            println!("[AI] Regex Fallback Result - Verdict: {:?}, Score: {}, Salvaged Items: {}", verdict_enum, score, salvaged_timeline.len());

            ForensicReport {
                verdict: verdict_enum,
                malware_family: None,
                threat_score: score,
                executive_summary: summary.to_string(),
                behavioral_timeline: salvaged_timeline,
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
        .map(|e| e.related_pid)
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
