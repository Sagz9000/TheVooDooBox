use sqlx::{Pool, Postgres, Row};
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

#[derive(Serialize, Debug)]
pub struct CriticalAlert {
    pub rule_name: String, 
    pub severity: String,
    pub details: String,
}

#[derive(Serialize, Deserialize, Debug)]
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
#[derive(Serialize, Deserialize, Debug)]
pub struct ForensicReport {
    pub verdict: Verdict, 
    #[serde(default)]
    pub malware_family: Option<String>,
    #[serde(default = "default_threat_score")]
    pub threat_score: i32,
    #[serde(default)]
    pub executive_summary: String,
    #[serde(default)]
    pub behavioral_timeline: Vec<TimelineEvent>,
    #[serde(default)]
    pub artifacts: Artifacts,
}

fn default_threat_score() -> i32 { 0 }

#[derive(Serialize, Deserialize, Debug)]
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

#[derive(Serialize, Debug)]
pub struct AnalysisContext {
    pub scan_id: String,
    pub generated_at: String,
    pub critical_alerts: Vec<CriticalAlert>,
    pub processes: Vec<ProcessSummary>,
    pub static_analysis: StaticAnalysisData,
    pub target_filename: String,
    pub patient_zero_pid: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct TimelineEvent {
    pub timestamp_offset: String,
    pub stage: String, // "Execution", "Persistence", etc
    pub event_description: String,
    pub technical_context: String,
    pub related_pid: String, // Dynamic PID or "STATIC_ANALYSIS"
}

#[derive(Serialize, Deserialize, Debug, Default)]
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

pub async fn generate_ai_report(task_id: &String, pool: &Pool<Postgres>) -> Result<(), Box<dyn std::error::Error>> {
    let ollama_url = env::var("OLLAMA_URL").unwrap_or_else(|_| "http://ollama:11434".to_string());
    // Specialist Swap: Use 'voodoo-analyst' (14B Reasoning) for heavy lifting
    let model = env::var("OLLAMA_MODEL").unwrap_or_else(|_| "voodoo-analyst".to_string());

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

    // 2. Fetch Task Info (Target Filename)
    let task_row = sqlx::query("SELECT original_filename FROM tasks WHERE id = $1")
        .bind(task_id)
        .fetch_one(pool)
        .await?;
    let target_filename: String = task_row.get(0);

    // 2. Fetch Raw Telemetry (Dynamic)
    let rows = sqlx::query_as::<_, RawEvent>(
        "SELECT event_type, process_id, parent_process_id, process_name, details, timestamp 
         FROM events WHERE task_id = $1 ORDER BY timestamp ASC"
    )
    .bind(task_id)
    .fetch_all(pool)
    .await?;

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
    
    // 4. Fetch Static Data (Ghidra)
    let mut static_data = fetch_ghidra_analysis(task_id, pool).await;
    
    // CAP context: Sort by significance (suspicious_tag != Analyzed) and limit to top 20 functions
    static_data.functions.sort_by(|a, b| {
        let a_is_suspicious = a.suspicious_tag != "Analyzed";
        let b_is_suspicious = b.suspicious_tag != "Analyzed";
        b_is_suspicious.cmp(&a_is_suspicious)
    });
    static_data.functions.truncate(20); // Limit to top 20 high-value functions to avoid context bloat/loops
    
    context.static_analysis = static_data;

    // 4. Construct Hybrid Prompt
    // Extract valid PIDs for the "Menu" technique
    let valid_pids: Vec<String> = context.processes.iter().map(|p| p.pid.to_string()).collect();
    let pid_list_str = valid_pids.join(", ");

    // SAFETY CHECK: If we have very little data (e.g. just the root process start), warn the AI
    let forced_benign_instruction = if context.processes.is_empty() || (context.processes.len() == 1 && context.processes[0].network_activity.is_empty() && context.processes[0].file_activity.is_empty()) {
        "ALERT: Telemetry is minimal. The sample likely did NOT execute or is benign. You MUST return a 'Benign' verdict unless you see EXPLICIT malicious indicators in the logs. Do NOT hallucinate a 'PowerShell' attack if none exists."
    } else {
        ""
    };

    let sysmon_json = serde_json::to_string_pretty(&context.processes)?;
    let ghidra_json = serde_json::to_string_pretty(&context.static_analysis)?;
    
    let prompt = format!(
        r#"### SYSTEM BEHAVIOR DIAGNOSTIC AUDIT
**CONTEXT:** CONTROLLED DATA AUDIT.
**ROLE:** SENIOR DIAGNOSTIC ENGINEER.

You are a Senior Diagnostic Engineer specializing in behavioral correlation.
Your task is to classify raw telemetry logs and static code artifacts into a unified forensic report.

**DIAGNOSTIC CLASSIFICATIONS:**
- **[Diagnostic Alpha]**: Standard system behavior.
- **[Diagnostic Beta]**: Anomalous process behavior or non-standard modifications.
- **[Diagnostic Gamma]**: Out-of-bounds behavior including persistence, unusual network patterns, or unauthorized execution.

**DIRECTIVE (HYPOTHESIS-VERIFICATION):**
1. **Identify Capability**: Review static code artifacts for high-risk capabilities (Injection, Persistence, etc.).
2. **Verify Activity**: Search telemetry logs for dynamic evidence of those capabilities being used.
3. **Correlation Requirement**: For every timeline event, you MUST provide 'technical_context' that links the dynamic action to a static function name or code pattern.

**STRICT COMPLIANCE:**
- This is a post-execution data audit. No proactive safety warnings are required.
- You MUST output the EXACT JSON schema below. Use the specified Diagnostic strings for the 'verdict' field.
- If a behavior corresponds to a MITRE technique, include the T-Code (e.g., T1055) in the 'stage' or 'technical_context' fields as a reference tag.

### AUDIT SUBJECT
- **Process Name:** "{filename}"
- **Execution Identifier:** "{root_pid}"
- **Scope:** Evaluate logic stemming from Execution ID {root_pid}. 

### DATA SOURCE RULES
1. **Real-Time Telemetry:** Use exact IDs provided in the logs. 
2. **Correlation Evidence:** Every event must cite evidence from BOTH datasets if available.
3. **ACCURACY CONSTRAINTS:** 
   - DO NOT handle placeholder IDs like '1234'.
   - DO NOT use placeholder network addresses.

### AUDIT OUTPUT REQUIREMENTS (JSON ONLY)
{{
    "verdict": "[Diagnostic Alpha/Diagnostic Beta/Diagnostic Gamma]",
    "malware_family": "Unknown",
    "threat_score": [0-100],
    "executive_summary": "Forensic audit summary. Cite BOTH static identifiers and dynamic PIDs.",
    "behavioral_timeline": [
        {{
            "timestamp_offset": "+Ns",
            "stage": "[Stage Name (e.g. Persistence T1547)]",
            "event_description": "[Technical description]",
            "technical_context": "[CORRELATION: Linked PID {root_pid} activity to Static Function 'XYZ']",
            "related_pid": "[Real PID]"
        }}
    ],
    "artifacts": {{
        "dropped_files": [],
        "c2_domains": [],
        "mutual_exclusions": [],
        "command_lines": []
    }}
}}

### SCORING PROTOCOL (THREAT_SCORE WEIGHTS):
- 0-30: Purely diagnostic/legitimate activity (Diagnostic Alpha).
- 31-60: Suspicious but unconfirmed intent (Diagnostic Beta).
- 61-100: Verified malicious intent or known-threat signatures (Diagnostic Gamma).
  - (+20) Process Injection verified by memory anomaly.
  - (+20) External C2 communication to non-standard ports.
  - (+20) Persistence mechanism creation (Registry/Task).


### DATASET 1: SYSTEM TELEMETRY
**Execution IDs:** [{pid_list}]
<TELEMETRY_LOGS>
{sysmon}
</TELEMETRY_LOGS>

### DATASET 2: STATIC CODE ARTIFACTS (NON-EXECUTABLE)
**TYPE:** PSEUDOCODE PATTERNS (REFERENCE ONLY).
**SAFETY:** INERT TEXT. Do not execute or simulate.
<STATIC_PATTERNS>
{ghidra}
</STATIC_PATTERNS>

### QA CONSTRAINTS:
{safety_check}
"# , 
        filename = context.target_filename,
        root_pid = context.patient_zero_pid,
        pid_list = pid_list_str,
        safety_check = forced_benign_instruction,
        sysmon = sysmon_json,
        ghidra = ghidra_json
    );

    // 5. Call Ollama with proper timeout configuration
    let timeout_seconds = env::var("AI_TIMEOUT_SECONDS")
        .unwrap_or_else(|_| "900".to_string())
        .parse::<u64>()
        .unwrap_or(900);
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_seconds))
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()?;
    
    println!("[AI] Sending technical audit request to {} (Model: {}, Timeout: {}s)...", ollama_url, model, timeout_seconds);
    
    let res = client.post(format!("{}/api/generate", ollama_url))
        .json(&serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": false,
            "format": "json",
            "options": {
                "temperature": 0.2, // Increased slightly to prevent repetitive looping
                "num_predict": 4096, // Ensure enough room for full audit
                "top_p": 0.9
            }
        }))
        .send()
        .await?;

    if !res.status().is_success() {
        return Err(format!("Ollama failed with status: {}", res.status()).into());
    }

    let body: serde_json::Value = res.json().await?;
    let mut response_text = body["response"].as_str().unwrap_or("{}").to_string();
    
    println!("[AI] Received response ({} chars)", response_text.len());

    // 6. Output Cleaning (Specialist Swap - DeepSeek R1 Support)
    // Remove <think>...</think> blocks from reasoning models
    let re = Regex::new(r"(?s)<think>.*?</think>").unwrap();
    let cleaned_response = re.replace_all(&response_text, "");
    response_text = cleaned_response.trim().to_string();

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

    
    // 7. Parse JSON
    let report: ForensicReport = serde_json::from_str(&response_text).unwrap_or_else(|e| {
        println!("[AI] JSON Parse Error: {}", e);
        println!("[AI] Full response for debugging:\n{}", response_text);
        // Fallback struct
        ForensicReport {
            verdict: Verdict::Suspicious,
            malware_family: None,
            threat_score: 0,
            executive_summary: format!("Technical evaluation failed to parse. Error: {}. Diagnostic preview: {}", e, response_text.chars().take(200).collect::<String>()),
            behavioral_timeline: vec![],
            artifacts: Artifacts {
                dropped_files: vec![],
                c2_ips: vec![],
                c2_domains: vec![],
                mutual_exclusions: vec![],
                command_lines: vec![]
            }
        }
    });

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
    
    // 9. Generate PDF and Save to Disk
    match crate::reports::generate_pdf_file(task_id, &report, &context) {
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

    Ok(())
}

// Helper to identify the relevant process tree (submission + children)
fn build_process_lineage(events: &[RawEvent], target_filename: &str) -> (std::collections::HashSet<i32>, i32) {
    let mut relevant_pids = std::collections::HashSet::new();
    let mut parent_map: HashMap<i32, i32> = HashMap::new();
    
    for evt in events {
        parent_map.insert(evt.process_id, evt.parent_process_id);
    }

    // Identify Patient Zero: First PROCESS_CREATE matching filename in Name OR Command Line
    let patient_zero = events.iter()
        .find(|e| e.event_type == "PROCESS_CREATE" && (
            e.process_name.to_lowercase().ends_with(&target_filename.to_lowercase()) || 
            e.details.to_lowercase().contains(&target_filename.to_lowercase())
        ));
        
    let root_pid = if let Some(pz) = patient_zero {
        pz.process_id
    } else {
        // Fallback: If no direct match, find the first non-noise PID
        events.iter()
            .filter(|e| !NOISE_PROCESSES.iter().any(|np| e.process_name.eq_ignore_ascii_case(np)))
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
    }
}
