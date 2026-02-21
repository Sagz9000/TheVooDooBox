use actix_web::{get, post, delete, web, App, HttpResponse, HttpServer, Responder};
use dotenv::dotenv;
use std::env;
use std::fs;
use sqlx::{postgres::PgPoolOptions, Pool, Postgres, Row};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};

mod proxmox;
mod stream;
mod spice_relay;
mod vnc_relay;
mod ai;
mod ai_analysis;
mod reports;
mod virustotal; // Registered
mod remnux;
mod progress_stream;
mod notes;
mod detox_api;
mod memory;
mod action_manager;
use ai_analysis::{AnalysisRequest, AIReport, ManualAnalysisRequest};
use ai::manager::{AIManager, ProviderType};
use ai::provider::{ChatMessage};
use tokio_stream::StreamExt;
use ai::manager::StreamEvent;


#[derive(serde::Deserialize)]
pub struct ChatRequest {
    pub message: String,
    pub history: Vec<ChatMessage>,
    pub task_id: Option<String>,
    pub page_context: Option<String>,
}


// ConfigRequest moved down to line ~1350 for better grouping with its handlers

const NOISE_PROCESSES: &[&str] = &[
    "voodoobox-agent-windows.exe",
    "voodoobox-agent.exe",
    "officeclicktorun.exe",
    "conhost.exe",
    "svchost.exe",
    "lsass.exe",
    "services.exe",
    "wininit.exe",
    "smss.exe",
    "csrss.exe",
    "winlogon.exe",
    "spoolsv.exe",
    "searchindexer.exe",
    "taskhostw.exe",
    "sppsvc.exe",
    "fontdrvhost.exe",
    "dwm.exe",
    "ctfmon.exe",
    "taskmgr.exe",
    "mallab-agent.exe",
    "mallab-agent"
];

#[get("/health")]
async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({ "status": "ok", "service": "hyper-bridge" }))
}

#[get("/vms")]
async fn list_all_vms(client: web::Data<proxmox::ProxmoxClient>) -> impl Responder {
    match client.get_nodes().await {
        Ok(nodes) => {
            println!("[PROXMOX] Found {} nodes", nodes.len());
            let mut all_vms = Vec::new();
            for node in nodes {
                println!("[PROXMOX] Fetching VMs for node: {}", node.node);
                match client.get_vms(&node.node).await {
                    Ok(vms) => {
                        println!("[PROXMOX] Node {} has {} VMs", node.node, vms.len());
                        for vm in vms {
                            let vm_json = serde_json::json!({
                                "vmid": vm.vmid,
                                "name": vm.name,
                                "status": vm.status,
                                "node": node.node,
                                "cpus": vm.cpus,
                                "maxmem": vm.maxmem
                            });
                            all_vms.push(vm_json);
                        }
                    },
                    Err(e) => {
                         println!("[PROXMOX] Failed to fetch VMs for node {}: {}", node.node, e);
                    }
                }
            }
            println!("[PROXMOX] Returning total {} VMs to frontend", all_vms.len());
            HttpResponse::Ok().json(all_vms)
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[post("/vms/{node}/{vmid}/status")]
async fn vm_control(
    client: web::Data<proxmox::ProxmoxClient>,
    path: web::Path<(String, u64)>,
    req: web::Json<serde_json::Value>
) -> impl Responder {
    let (node, vmid) = path.into_inner();
    let action = req["action"].as_str().unwrap_or("start");
    match client.vm_action(&node, vmid, action).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({ "status": "success", "action": action })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[post("/vms/{node}/{vmid}/revert")]
async fn vm_revert(
    client: web::Data<proxmox::ProxmoxClient>,
    path: web::Path<(String, u64)>,
    req: web::Json<serde_json::Value>
) -> impl Responder {
    let (node, vmid) = path.into_inner();
    let snapshot = req["snapshot"].as_str().unwrap_or("GOLD_IMAGE");
    match client.rollback_snapshot(&node, vmid, snapshot).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({ "status": "success", "snapshot": snapshot })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[post("/vms/{node}/{vmid}/vnc")]
async fn vnc_proxy(
    client: web::Data<proxmox::ProxmoxClient>, 
    path: web::Path<(String, u64)>
) -> impl Responder {
    let (node, vmid) = path.into_inner();
    match client.create_vnc_proxy(&node, vmid).await {
        Ok(ticket) => HttpResponse::Ok().json(ticket),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[post("/vms/{node}/{vmid}/spice")]
async fn spice_proxy(
    client: web::Data<proxmox::ProxmoxClient>, 
    path: web::Path<(String, u64)>
) -> impl Responder {
    let (node, vmid) = path.into_inner();
    match client.create_spice_proxy(&node, vmid).await {
        Ok(ticket) => HttpResponse::Ok().json(ticket),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

use actix_web::{HttpRequest, Error};
use actix_web_actors::ws;

#[derive(serde::Deserialize)]
struct SpiceWsQuery {
    host: Option<String>,
}

#[get("/vms/{node}/{vmid}/spice-ws")]
async fn spice_websocket(
    req: HttpRequest,
    stream: web::Payload,
    client: web::Data<proxmox::ProxmoxClient>,
    path: web::Path<(String, u64)>,
    query: web::Query<SpiceWsQuery>,
) -> Result<HttpResponse, Error> {
    let (node, vmid) = path.into_inner();
    
    // Determine target host and proxy.
    // We need to extract the password from the ticket obtained in the ELSE block.
    // The previous logic was: `let (target_host, proxy_ip) = ...`
    // We need: `let (target_host, proxy_ip, password) = ...`
    
    let (target_host, proxy_ip, _password) = if let Some(h) = &query.host {
         let proxmox_url = std::env::var("PROXMOX_URL").unwrap_or("https://localhost:8006".to_string());
         let host_ip = proxmox_url.replace("https://", "").replace("http://", "").split(':').next().unwrap_or("localhost").to_string();
         (h.clone(), host_ip, "nopass".to_string())
    } else {
        match client.create_spice_proxy(&node, vmid).await {
            Ok(t) => {
                let h = t.host.unwrap_or("localhost".to_string());
                let p = t.proxy;
                // Use password if available, else ticket
                let pass = t.password.or(t.ticket).unwrap_or_default();
                (h, p, pass)
            },
            Err(e) => {
                 return Ok(HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })));
            }
        }
    };

    let proxy_addr = format!("{}:3128", proxy_ip);
    let target_port = 61000; 

    println!("[SPICE_WS] Initiating relay: Proxy={}, Target={}:{}", proxy_addr, target_host, target_port);

    // Use the API Token (auth_header) for the Proxy Authentication
    // The "password" variable previously held the Spice Password, which is useless for the Proxy.
    // We repurpose the 4th argument of SpiceRelay::new to be the PROXY credentials.
    let proxy_auth = client.auth_header.clone(); 

    let relay = spice_relay::SpiceRelay::new(proxy_addr, target_host, target_port, proxy_auth);
    ws::WsResponseBuilder::new(relay, &req, stream)
        .protocols(&["binary"])
        .start()
}

#[derive(serde::Deserialize)]
struct VncWsQuery {
    port: String,
    ticket: String,
    host: Option<String>,
}

#[get("/vms/{node}/{vmid}/vnc-ws")]
async fn vnc_websocket(
    req: HttpRequest,
    stream: web::Payload,
    client: web::Data<proxmox::ProxmoxClient>,
    path: web::Path<(String, u64)>,
    query: web::Query<VncWsQuery>,
) -> Result<HttpResponse, Error> {
    let (node, vmid) = path.into_inner();
    
    // Use the ticket provided by the client (who fetched it via POST /vnc)
    // This ensures the frontend has the password (ticket) for the RFB client.
    
    let port = &query.port;
    let auth_ticket = &query.ticket;
    
    // Resolve Host
    let host = if let Some(h) = &query.host {
        h.clone()
    } else {
        // Fallback to PROXMOX_URL host
         let proxmox_url = std::env::var("PROXMOX_URL").unwrap_or("https://localhost:8006".to_string());
         proxmox_url
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split(':')
            .next()
            .unwrap_or("localhost")
            .to_string()
    };
    
    let target_wss = format!(
        "wss://{}:8006/api2/json/nodes/{}/qemu/{}/vncwebsocket?port={}&vncticket={}", 
        host, node, vmid, port, urlencoding::encode(auth_ticket)
    );
    
    println!("[VNC_WS] Proxying to: wss://{}:8006/... (Port {})", host, port);
    
    // 3. Start Relay with API Token for Upstream Auth
    let api_auth = client.auth_header.clone();
    let relay = vnc_relay::VncRelay::new(target_wss, api_auth);
    
    ws::WsResponseBuilder::new(relay, &req, stream)
        .protocols(&["binary"])
        .start()
}

use tokio::net::TcpListener;
use tokio::io::{AsyncBufReadExt, BufReader, AsyncWriteExt};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use std::collections::HashMap;

pub struct AgentSession {
    pub tx: mpsc::UnboundedSender<String>,
    pub active_task_id: Option<String>,
    pub hostname: Option<String>,
    pub connected_at: std::time::Instant,
}

pub struct AgentManager {
    pub sessions: Mutex<HashMap<String, AgentSession>>,
}

impl AgentManager {
    fn new() -> Self {
        Self { 
            sessions: Mutex::new(HashMap::new()),
        }
    }

    async fn register(&self, id: String, tx: mpsc::UnboundedSender<String>) {
        self.sessions.lock().await.insert(id, AgentSession {
            tx,
            active_task_id: None,
            hostname: None,
            connected_at: std::time::Instant::now(),
        });
    }

    async fn remove(&self, id: &str) {
        self.sessions.lock().await.remove(id);
    }

    // Set task ID for a specific session (by ID or first available if none assigned)
    async fn bind_task_to_session(&self, session_id: String, task_id: String) {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            session.active_task_id = Some(task_id.clone());
            println!("[AGENT] Task {} bound to session {}", task_id, session_id);
        }
    }

    // Helper to get the first active task ID found (for legacy global endpoints)
    async fn get_any_active_task_id(&self) -> Option<String> {
        let sessions = self.sessions.lock().await;
        for session in sessions.values() {
            if let Some(ref tid) = session.active_task_id {
                return Some(tid.clone());
            }
        }
        None
    }

    async fn broadcast_command(&self, cmd: &str) {
        let sessions = self.sessions.lock().await;
        for session in sessions.values() {
            let _ = session.tx.send(cmd.to_string());
        }
    }

    async fn send_command_to_session(&self, session_id: &str, cmd: &str) {
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(session_id) {
            let _ = session.tx.send(cmd.to_string());
        }
    }

    pub async fn find_session_by_vm_name(&self, vm_name: &str) -> Option<String> {
        let sessions = self.sessions.lock().await; 
        for (id, session) in sessions.iter() {
            if let Some(h) = &session.hostname {
                // Determine if we want exact or loose matching.
                // For now, let's assume exact match or contains.
                if h.eq_ignore_ascii_case(vm_name) {
                    return Some(id.clone());
                }
            }
        }
        None
    }

    async fn _clear_sessions(&self) {
        let mut sessions = self.sessions.lock().await;
        sessions.clear();
        println!("[AGENT] All sessions cleared.");
    }
}

#[derive(Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct RawAgentEvent {
    pub id: Option<i32>,
    pub event_type: String,
    pub process_id: i32,
    pub parent_process_id: i32,
    pub process_name: String,
    pub details: String,
    pub decoded_details: Option<String>,
    pub timestamp: i64,
    pub task_id: Option<String>,
    pub digital_signature: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Task {
    pub id: String,
    pub filename: String,
    pub original_filename: String,
    pub file_hash: String,
    pub status: String,
    pub verdict: Option<String>,
    pub risk_score: Option<i32>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub ghidra_status: Option<String>,
    pub verdict_manual: Option<bool>,
    pub sandbox_id: Option<String>,
    pub remnux_status: Option<String>,
    pub remnux_report: Option<serde_json::Value>,
}

async fn start_tcp_listener(
    broadcaster: Arc<stream::Broadcaster>, 
    manager: Arc<AgentManager>,
    pool: Pool<Postgres>
) {
    let listener = TcpListener::bind("0.0.0.0:9001").await.expect("Failed to bind TCP port 9001");
    println!("Agent TCP Listener active on :9001");

    loop {
        let (socket, addr) = listener.accept().await.unwrap();
        let broadcaster = broadcaster.clone();
        let manager = manager.clone();
        let pool = pool.clone();
        let session_id = addr.to_string();
        
        tokio::spawn(async move {
            let (rx_socket, mut tx_socket) = tokio::io::split(socket);
            let (tx_cmd, mut rx_cmd) = mpsc::unbounded_channel::<String>();
            
            manager.register(session_id.clone(), tx_cmd).await;
            println!("Agent connected: {}", session_id);

            let mut reader = BufReader::new(rx_socket);
            let mut line = String::new();
            
            loop {
                tokio::select! {
                    res = reader.read_line(&mut line) => {
                        match res {
                            Ok(0) => break, 
                            Ok(_) => {
                                let trimmed = line.trim();
                                if let Ok(mut evt) = serde_json::from_str::<RawAgentEvent>(trimmed) {
                                    let p_name = evt.process_name.to_lowercase();
                                    let is_registry = evt.event_type.starts_with("REG_");

                                    if !is_registry && NOISE_PROCESSES.iter().any(|&n| p_name.contains(n)) {
                                        line.clear();
                                        continue;
                                    }

                                // Get the current active task for THIS session
                                let current_task_id = {
                                    let sessions = manager.sessions.lock().await;
                                    sessions.get(&session_id).and_then(|s| s.active_task_id.clone())
                                };
                                evt.task_id = current_task_id.clone();

                                    if let Some(ref tid) = evt.task_id {
                                        println!("[TELEMETRY] Captured event for Task {}: {} ({})", tid, evt.event_type, evt.process_name);
                                    } else {
                                        println!("[TELEMETRY] Captured global event (No Task ID): {} ({})", evt.event_type, evt.process_name);
                                    }

                                    let db_res = sqlx::query(
                                        "INSERT INTO events (event_type, process_id, parent_process_id, process_name, details, decoded_details, timestamp, task_id, session_id, digital_signature) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id"
                                    )
                                    .bind(&evt.event_type)
                                    .bind(&evt.process_id)
                                    .bind(&evt.parent_process_id)
                                    .bind(&evt.process_name)
                                    .bind(&evt.details)
                                    .bind(&evt.decoded_details)
                                    .bind(&evt.timestamp)
                                    .bind(&evt.task_id)
                                    .bind(&session_id)
                                    .bind(&evt.digital_signature)
                                    .fetch_one(&pool)
                                    .await;

                                    match db_res {
                                        Ok(row) => {
                                            // 2. Update event with generated ID
                                            let generated_id: i32 = row.get("id");
                                            evt.id = Some(generated_id);

                                            // 3. Broadcast enriched event WITH ID
                                            if let Ok(json) = serde_json::to_string(&evt) {
                                                broadcaster.send_message(&json);
                                            }
                                        },
                                        Err(e) => {
                                            println!("[DATABASE] Error inserting event: {}", e);
                                            // Fallback: Broadcast without ID if DB fails (unlikely, but preserves liveness)
                                            if let Ok(json) = serde_json::to_string(&evt) {
                                                broadcaster.send_message(&json);
                                            }
                                        }
                                    }
                                }
                                line.clear();
                            }
                            Err(_) => break,
                        }
                    }
                    Some(cmd) = rx_cmd.recv() => {
                        if let Err(_) = tx_socket.write_all(format!("{}\n", cmd).as_bytes()).await {
                            break;
                        }
                    }
                }
            }
            manager.remove(&session_id).await;
            println!("Agent disconnected: {}", session_id);
        });
    }
}

#[derive(Deserialize)]
struct TerminationRequest {
    pid: i32,
}

#[derive(Deserialize)]
struct ExecRequest {
    path: String,
    args: Option<Vec<String>>,
    vmid: Option<u64>,
    node: Option<String>,
}

#[derive(Deserialize)]
pub struct PivotRequest {
    pub path: String,
}

#[derive(Deserialize)]
struct UrlRequest {
    url: String,
    analysis_duration: Option<u64>,
    vmid: Option<u64>,
    node: Option<String>,
}

#[post("/vms/actions/terminate")]
async fn terminate_process(
    manager: web::Data<Arc<AgentManager>>,
    req: web::Json<TerminationRequest>
) -> impl Responder {
    let cmd = serde_json::json!({
        "command": "KILL",
        "pid": req.pid
    }).to_string();
    
    manager.broadcast_command(&cmd).await;
    HttpResponse::Ok().json(serde_json::json!({ "status": "sent", "pid": req.pid }))
}

#[derive(Deserialize)]
struct TaskQuery {
    task_id: Option<String>,
    search: Option<String>,
}

use actix_multipart::Multipart;
use futures::TryStreamExt;
use std::time::Duration;

#[post("/vms/actions/submit")]
async fn submit_sample(
    ai_manager: web::Data<AIManager>,
    manager: web::Data<Arc<AgentManager>>,
    client: web::Data<proxmox::ProxmoxClient>,
    pool: web::Data<Pool<Postgres>>,
    progress_broadcaster: web::Data<Arc<progress_stream::ProgressBroadcaster>>,
    mut payload: Multipart,
) -> Result<HttpResponse, actix_web::Error> {
    let mut filename = String::new();
    let mut original_filename = String::new();
    let mut sha256_hash = String::new();
    let mut analysis_duration_seconds = 300; // Default 5 minutes
    let mut target_vmid: Option<u64> = None;
    let mut target_node: Option<String> = None;
    let mut analysis_mode = "quick".to_string(); // Default to quick
    
    // Iterate over multipart stream
    while let Ok(Some(mut field)) = TryStreamExt::try_next(&mut payload).await {
        let content_disposition = field.content_disposition();
        let name_opt = content_disposition.as_ref().and_then(|cd| cd.get_filename());
        let field_name = content_disposition.as_ref().and_then(|cd| cd.get_name()).unwrap_or("");

        if let Some(name) = name_opt {
            original_filename = name.to_string();
            // User requested NO renaming. Only stripping directory traversal characters for safety.
            filename = name.replace("..", "").replace("/", "").replace("\\", "");
            
            let upload_dir = "./uploads";
            let _ = std::fs::create_dir_all(upload_dir);
            
            let filepath = format!("{}/{}", upload_dir, filename);
            
            let mut f = tokio::fs::File::create(&filepath).await
                .map_err(|e| actix_web::error::ErrorInternalServerError(e))?;
            
            let mut hasher = Sha256::new();

            while let Ok(Some(chunk)) = TryStreamExt::try_next(&mut field).await {
                f.write_all(&chunk).await
                    .map_err(|e| actix_web::error::ErrorInternalServerError(e))?;
                hasher.update(&chunk);
            }
            
            let result = hasher.finalize();
            sha256_hash = format!("{:x}", result);
            
            // Trigger VirusTotal Lookup (Background)
            let vt_pool = pool.get_ref().clone();
            let vt_hash = sha256_hash.clone();
            actix_web::rt::spawn(async move {
                let _ = virustotal::get_cached_or_fetch(&vt_pool, &vt_hash).await;
            });
        } else if field_name == "analysis_duration" {
            let mut value_bytes = Vec::new();
            while let Ok(Some(chunk)) = TryStreamExt::try_next(&mut field).await {
                value_bytes.extend_from_slice(&chunk);
            }
            if let Ok(value_str) = String::from_utf8(value_bytes) {
                 if let Ok(minutes) = value_str.trim().parse::<u64>() {
                     analysis_duration_seconds = minutes * 60;
                     println!("[SUBMISSION] Setting analysis duration to {} seconds ({} minutes)", analysis_duration_seconds, minutes);
                 }
            }
        } else if field_name == "vmid" {
            let mut value_bytes = Vec::new();
            while let Ok(Some(chunk)) = TryStreamExt::try_next(&mut field).await {
                value_bytes.extend_from_slice(&chunk);
            }
            if let Ok(value_str) = String::from_utf8(value_bytes) {
                let trimmed = value_str.trim();
                println!("[SUBMISSION] Received vmid field: '{}'", trimmed);
                if let Ok(vmid) = trimmed.parse::<u64>() {
                    target_vmid = Some(vmid);
                }
            }
        } else if field_name == "node" {
            let mut value_bytes = Vec::new();
            while let Ok(Some(chunk)) = TryStreamExt::try_next(&mut field).await {
                value_bytes.extend_from_slice(&chunk);
            }
            if let Ok(value_str) = String::from_utf8(value_bytes) {
                let node = value_str.trim().to_string();
                target_node = Some(node);
            }
        } else if field_name == "analysis_mode" {
            let mut value_bytes = Vec::new();
            while let Ok(Some(chunk)) = TryStreamExt::try_next(&mut field).await {
                value_bytes.extend_from_slice(&chunk);
            }
            if let Ok(value_str) = String::from_utf8(value_bytes) {
                let mode = value_str.trim().to_lowercase();
                if mode == "deep" {
                    analysis_mode = "deep".to_string();
                }
                println!("[SUBMISSION] Received analysis_mode field: '{}'", mode);
            }
        }
    }
    
    println!("[SUBMISSION] Final selection - VMID: {:?}, Node: {:?}", target_vmid, target_node);
    
    if filename.is_empty() {
        return Ok(HttpResponse::BadRequest().body("No file uploaded"));
    }
    
    let host_ip = std::env::var("HOST_IP").unwrap_or_else(|_| "192.168.50.11".to_string()); // Default to local host
    let download_url = format!("http://{}:8080/uploads/{}", host_ip, filename);
    
    // Create Task Record
    // Use timestamp as ID to guarantee uniqueness and avoid collision bugs
    let created_at = Utc::now().timestamp_millis();
    let task_id = created_at.to_string();
    
    let filepath = format!("{}/{}", "./uploads", filename);
    
    let _ = sqlx::query(
        "INSERT INTO tasks (id, filename, original_filename, file_hash, status, created_at, sandbox_id, file_path) VALUES ($1, $2, $3, $4, 'Queued', $5, $6, $7)"
    )
    .bind(&task_id)
    .bind(&filename)
    .bind(&original_filename)
    .bind(&sha256_hash)
    .bind(created_at)
    .bind(target_vmid.map(|id| id.to_string()))
    .bind(&filepath)
    .execute(pool.get_ref())
    .await;
    
    // Check if task exists (debugging)
    let check = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks WHERE id = $1")
        .bind(&task_id)
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or(0);
        
    println!("[DEBUG] Task {} created. DB Row Count: {}", task_id, check);

    println!("Sample uploaded: {}. Initiating Sandbox Orchestration (Task: {})...", filename, task_id);
    
    // Trigger Ghidra Static Analysis (Parallel Background)
    let ghidra_filename = filename.clone();
    let ghidra_task_id = task_id.clone();
    let ghidra_pool = pool.get_ref().clone(); 
    actix_web::rt::spawn(async move {
        trigger_ghidra_background(ghidra_filename, ghidra_task_id, ghidra_pool).await;
    });

    // Trigger Remnux Analysis (Parallel Background)
    let remnux_filename = filename.clone();
    let remnux_task_id = task_id.clone();
    let remnux_pool = pool.get_ref().clone();
    let remnux_filepath = format!("./uploads/{}", filename);
    actix_web::rt::spawn(async move {
        remnux::trigger_scan(remnux_pool, remnux_task_id, remnux_filename, remnux_filepath).await;
    });

    // Spawn Analysis Job
    let manager = manager.get_ref().clone(); 
    let client = client.get_ref().clone();
    let pool = pool.get_ref().clone();
    let ai_manager = ai_manager.get_ref().clone();
    let url_clone = download_url.clone();
    let task_id_clone = task_id.clone();
    let mode_clone = analysis_mode.clone();
    let progress_bc: Arc<progress_stream::ProgressBroadcaster> = progress_broadcaster.get_ref().clone();
    
    actix_web::rt::spawn(async move {
        orchestrate_sandbox(client, manager, pool, ai_manager, task_id_clone, url_clone, original_filename.clone(), analysis_duration_seconds, target_vmid, target_node, false, mode_clone, progress_bc).await;
    });
    
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "status": "analysis_queued",
        "task_id": task_id,
        "filename": filename,
        "mode": analysis_mode,
        "url": download_url,
        "message": "Orchestration started: Reverting VM -> Starting -> Detonating"
    })))
}

async fn orchestrate_sandbox(
    client: proxmox::ProxmoxClient,
    manager: Arc<AgentManager>,
    pool: Pool<Postgres>,
    ai_manager: AIManager,
    task_id: String,
    target_url: String, // Can be download URL or Detonation URL
    original_filename: String,
    duration_seconds: u64,
    manual_vmid: Option<u64>,
    manual_node: Option<String>,
    is_url_task: bool,
    analysis_mode: String,
    progress: Arc<progress_stream::ProgressBroadcaster>,
) {

    // 1. Identify Sandbox VM
    let mut node_name = String::new();
    let mut vmid = 0;
    let mut vm_name = String::new();
    let snapshot = "clean_sand";



    if let (Some(mvmid), Some(mnode)) = (manual_vmid, manual_node) {
        println!("[ORCHESTRATOR] Using MANUALLY selected VM: {} on node {}", mvmid, mnode);
        vmid = mvmid;
        node_name = mnode;
        vm_name = format!("vm{}", vmid); // Fallback name
    } else {
        println!("[ORCHESTRATOR] Searching for available Sandbox VM (Pattern: 'sand/sandbox' or ID 300-399)...");
        // Try to discover an available sandbox VM
        if let Ok(nodes) = client.get_nodes().await {
            'discovery: for node in nodes {
                if let Ok(vms) = client.get_vms(&node.node).await {
                    for vm in vms {
                        let is_sandbox_range = vm.vmid >= 300 && vm.vmid < 400;
                        let has_sandbox_name = if let Some(name) = &vm.name {
                            let lower_name = name.to_lowercase();
                            lower_name.contains("sand") || lower_name.contains("sandbox")
                        } else {
                            false
                        };

                        if is_sandbox_range || has_sandbox_name {
                            node_name = node.node.clone();
                            vmid = vm.vmid;
                            vm_name = vm.name.clone().unwrap_or_else(|| format!("vm{}", vmid));
                            println!("[ORCHESTRATOR] Auto-selected VM: {} ({}) on node {}", vmid, vm_name, node_name);
                            break 'discovery;
                        }
                    }
                }
            }
        }
    }

    if vmid == 0 {
        println!("[ORCHESTRATOR] CRITICAL ERROR: No Sandbox VM found or specified. Aborting.");
        let _ = sqlx::query("UPDATE tasks SET status='Failed (No VM Available)' WHERE id=$1")
            .bind(&task_id).execute(&pool).await;
        return;
    }
    
    let node = &node_name;
    println!("[ORCHESTRATOR] Starting analysis for Task {} on VM {} ({})", task_id, vmid, vm_name);

    // Update Sandbox Identity in DB
    let sandbox_label = format!("{} [{}]", vm_name, vmid);
    let _ = sqlx::query("UPDATE tasks SET sandbox_id=$2 WHERE id=$1")
        .bind(&task_id)
        .bind(&sandbox_label)
        .execute(&pool)
        .await;

    // Update Status: Preparing
    let _ = sqlx::query("UPDATE tasks SET status='Preparing Environment' WHERE id=$1")
        .bind(&task_id).execute(&pool).await;
    progress.send_progress(&task_id, "preparing", "Preparing sandbox environment", 5);

    // 2. Revert to 'clean' snapshot
    println!("[ORCHESTRATOR] Step 1: Reverting to '{}' snapshot...", snapshot);
    let _ = sqlx::query("UPDATE tasks SET status='Reverting Sandbox' WHERE id=$1").bind(&task_id).execute(&pool).await;
    progress.send_progress(&task_id, "reverting", "Reverting to clean snapshot", 10);
    if let Err(e) = client.rollback_snapshot(node, vmid, snapshot).await {
        println!("[ORCHESTRATOR] Warning: Snapshot rollback failed: {}. Attempting to Stop/Start instead.", e);
        let _ = client.vm_action(node, vmid, "stop").await;
        tokio::time::sleep(Duration::from_secs(5)).await;
    } else {
        // Wait for rollback to process
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    
    // 3. Start VM
    println!("[ORCHESTRATOR] Step 2: Starting VM...");
    let _ = sqlx::query("UPDATE tasks SET status='Starting VM' WHERE id=$1").bind(&task_id).execute(&pool).await;
    progress.send_progress(&task_id, "starting_vm", "Booting sandbox VM", 15);
    
    // Environment selection or validation could happen here
    let orchestration_start = std::time::Instant::now();

    if let Err(e) = client.vm_action(node, vmid, "start").await {
        println!("[ORCHESTRATOR] Error starting VM: {}", e);
    }
    
    // 4. Wait for Agent Handshake
    println!("[ORCHESTRATOR] Step 3: Waiting for Agent connection (max 90s)...");
    let _ = sqlx::query("UPDATE tasks SET status='Waiting for Agent' WHERE id=$1").bind(&task_id).execute(&pool).await;
    progress.send_progress(&task_id, "waiting_agent", "Waiting for agent handshake", 25);
    
    let mut bound_session_id: Option<String> = None;
    
    while orchestration_start.elapsed().as_secs() < 90 {
        // Find a session that connected AFTER orchestration started and isn't busy
        let sessions = manager.sessions.lock().await;
        for (id, session) in sessions.iter() {
            if session.active_task_id.is_none() && session.connected_at >= orchestration_start {
                bound_session_id = Some(id.clone());
                break;
            }
        }
        
        if let Some(ref sid) = bound_session_id {
            // Found our session!
            println!("[ORCHESTRATOR] Session {} assigned to Task {}", sid, task_id);
            break;
        }
        
        if orchestration_start.elapsed().as_secs() % 10 == 0 {
             println!("[ORCHESTRATOR] Still waiting for agent to connect... ({}s elapsed)", orchestration_start.elapsed().as_secs());
        }
        drop(sessions);
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    
    let session_id = match bound_session_id {
        Some(sid) => {
            manager.bind_task_to_session(sid.clone(), task_id.clone()).await;
            
            // BACKFILL TELEMETRY:
            // Ensure any events that arrived from this session BEFORE the task was bound 
            // are now retroactively assigned to this task.
            println!("[ORCHESTRATOR] Backfilling task_id for early events from session {}", sid);
            let _ = sqlx::query("UPDATE events SET task_id=$1 WHERE session_id=$2 AND task_id IS NULL")
                .bind(&task_id)
                .bind(&sid)
                .execute(&pool)
                .await;
                
            sid
        },
        None => {
            println!("[ORCHESTRATOR] CRITICAL ERROR: No free agent connected within timeout. Aborting analysis.");
            let _ = sqlx::query("UPDATE tasks SET status='Failed (Agent Timeout)' WHERE id=$1")
                .bind(&task_id).execute(&pool).await;
            return;
        }
    };
    
    // 5. DETONATION PHASE: Send payload only to the bound session
    println!("[ORCHESTRATOR] Step 3.1: Sending detonation command to agent...");
    let _ = sqlx::query("UPDATE tasks SET status='Detonating Sample' WHERE id=$1").bind(&task_id).execute(&pool).await;
    progress.send_progress(&task_id, "detonating", "Executing payload in sandbox", 40);
    
    // Update Status: Running
    let _ = sqlx::query("UPDATE tasks SET status='Running' WHERE id=$1")
        .bind(&task_id).execute(&pool).await;
    progress.send_progress(&task_id, "running", "Monitoring telemetry collection", 50);

    // 5. Send Payload
    let cmd = if is_url_task {
        serde_json::json!({
            "command": "EXEC_URL",
            "url": target_url,
            "task_id": task_id
        }).to_string()
    } else {
        serde_json::json!({
            "command": "DOWNLOAD_EXEC",
            "url": target_url,
            "filename": original_filename,
            "vm_id": vmid,
            "vm_name": vm_name
        }).to_string()
    };
    
    // Send ONLY to the session assigned to this VM/Task
    manager.send_command_to_session(&session_id, &cmd).await;
    println!("[ORCHESTRATOR] Detonation command sent to VM {} (Session {}): {}", vm_name, session_id, cmd);
    
    // 6. Monitor Phase
    println!("[ORCHESTRATOR] Step 4: Monitoring Analysis Phase Initiated ({}s)...", duration_seconds); 
    tokio::time::sleep(Duration::from_secs(duration_seconds)).await;
    
    // 7. Cleanup - STOP VM IMMEDIATELY after analysis duration
    println!("[ORCHESTRATOR] Step 5: Analysis Complete. Waiting 5s for trailing telemetry...");
    progress.send_progress(&task_id, "collecting", "Collecting trailing telemetry", 75);
    tokio::time::sleep(Duration::from_secs(5)).await;

    println!("[ORCHESTRATOR] Step 6: Stopping and reverting VM...");
    progress.send_progress(&task_id, "stopping_vm", "Cleaning up sandbox", 80);
    if let Err(e) = client.vm_action(node, vmid, "stop").await {
        println!("[ORCHESTRATOR] Warning: Failed to stop VM {}: {}", vmid, e);
    }
    
    if let Err(e) = client.rollback_snapshot(node, vmid, snapshot).await {
        println!("[ORCHESTRATOR] CRITICAL: Failed to rollback VM {} ({}) to {}: {}", vmid, vm_name, snapshot, e);
    } else {
        println!("[ORCHESTRATOR] SUCCESS: VM {} ({}) reverted to {} state.", vmid, vm_name, snapshot);
    }



    // 8. Generate AI Report (can take up to 10 minutes - VM is already stopped)
    println!("[ORCHESTRATOR] Step 7: Generating AI Analysis Report (Mode: {})...", analysis_mode);
    progress.send_progress(&task_id, "ai_analysis", "Generating AI forensic report", 85);
    if let Err(e) = ai_analysis::generate_ai_report(&task_id, &pool, &ai_manager, manager.clone(), true, &analysis_mode).await {
        println!("[ORCHESTRATOR] Failed to generate AI report: {}", e);
    } else {
        println!("[ORCHESTRATOR] AI Analysis Report generated successfully.");
    }

    // Update Status: Completed
    let _ = sqlx::query("UPDATE tasks SET status='Completed', completed_at=$2 WHERE id=$1")
        .bind(&task_id)
        .bind(Utc::now().timestamp_millis())
        .execute(&pool)
        .await;
    progress.send_progress(&task_id, "completed", "Analysis complete", 100);

    // Clear active task binding for this session
    {
        let mut sessions = manager.sessions.lock().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            session.active_task_id = None;
            println!("[AGENT] Task {} cleared from session {}", task_id, session_id);
        }
    }
}

#[post("/vms/actions/exec-binary")]
async fn exec_binary(
    manager: web::Data<Arc<AgentManager>>,
    client: web::Data<proxmox::ProxmoxClient>,
    req: web::Json<ExecRequest>
) -> impl Responder {
    let cmd = serde_json::json!({
        "command": "EXEC_BINARY",
        "path": req.path,
        "args": req.args
    }).to_string();
    
    if let (Some(vmid), Some(node)) = (req.vmid, &req.node) {
        // Targeted execution
        if let Ok(vms) = client.get_vms(node).await {
            if let Some(vm) = vms.into_iter().find(|v| v.vmid == vmid) {
                if let Some(name) = &vm.name {
                     if let Some(session_id) = manager.find_session_by_vm_name(name).await {
                         manager.send_command_to_session(&session_id, &cmd).await;
                          return HttpResponse::Ok().json(serde_json::json!({ "status": "sent", "path": req.path, "target": name }));
                     }
                }
            }
        }
        // Fallback if session not found but manual target specified
         return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Target VM session not found" }));
    }

    // Default broadcast
    manager.broadcast_command(&cmd).await;
    HttpResponse::Ok().json(serde_json::json!({ "status": "broadcast", "path": req.path }))
}

#[post("/vms/actions/pivot")]
pub async fn pivot_binary(
    manager: web::Data<Arc<AgentManager>>,
    req: web::Json<PivotRequest>
) -> impl Responder {
    let cmd = serde_json::json!({
        "command": "UPLOAD_PIVOT",
        "path": req.path
    }).to_string();
    
    manager.broadcast_command(&cmd).await;
    HttpResponse::Ok().json(serde_json::json!({ "status": "sent", "path": req.path }))
}

#[post("/vms/telemetry/pivot-upload")]
pub async fn pivot_upload(
    ai_manager: web::Data<AIManager>,
    manager: web::Data<Arc<AgentManager>>,
    client: web::Data<proxmox::ProxmoxClient>,
    pool: web::Data<Pool<Postgres>>,
    progress_broadcaster: web::Data<Arc<progress_stream::ProgressBroadcaster>>,
    mut payload: Multipart,
) -> Result<HttpResponse, actix_web::Error> {
    // This is similar to submit_sample but used for pivoting
    // I can reuse the logic by refactoring later, but for now I'll just write it
    let mut filename = String::new();
    let mut original_filename = String::new();
    let mut sha256_hash = String::new();
    
    while let Ok(Some(mut field)) = TryStreamExt::try_next(&mut payload).await {
        let content_disposition = field.content_disposition();
        if let Some(name) = content_disposition.and_then(|cd| cd.get_filename()) {
            original_filename = name.to_string();
            filename = format!("pivot_{}_{}", Utc::now().timestamp_millis(), name.replace("..", "").replace("/", "").replace("\\", ""));
            
            let upload_dir = "./uploads";
            let _ = std::fs::create_dir_all(upload_dir);
            let filepath = format!("{}/{}", upload_dir, filename);
            
            let mut f = tokio::fs::File::create(&filepath).await
                .map_err(|e| actix_web::error::ErrorInternalServerError(e))?;
            
            let mut hasher = Sha256::new();
            while let Ok(Some(chunk)) = TryStreamExt::try_next(&mut field).await {
                f.write_all(&chunk).await
                    .map_err(|e| actix_web::error::ErrorInternalServerError(e))?;
                hasher.update(&chunk);
            }
            let result = hasher.finalize();
            sha256_hash = format!("{:x}", result);

            // Trigger VirusTotal Lookup (Background)
            let vt_pool = pool.get_ref().clone();
            let vt_hash = sha256_hash.clone();
            actix_web::rt::spawn(async move {
                let _ = virustotal::get_cached_or_fetch(&vt_pool, &vt_hash).await;
            });
        }
    }

    if filename.is_empty() {
        return Ok(HttpResponse::BadRequest().body("No file uploaded"));
    }

    let host_ip = std::env::var("HOST_IP").unwrap_or_else(|_| "192.168.50.196".to_string());
    let download_url = format!("http://{}:8080/uploads/{}", host_ip, filename);
    let task_id = Utc::now().timestamp_millis().to_string();

    let filepath = format!("{}/{}", "./uploads", filename);

    // Insert task
    let _ = sqlx::query(
        "INSERT INTO tasks (id, filename, original_filename, file_hash, status, created_at, file_path) VALUES ($1, $2, $3, $4, 'Queued', $5, $6)"
    )
    .bind(&task_id)
    .bind(&filename)
    .bind(&original_filename)
    .bind(&sha256_hash)
    .bind(Utc::now().timestamp_millis())
    .bind(&filepath)
    .execute(pool.get_ref())
    .await;

    // Spawn analysis
    let manager = manager.get_ref().clone();
    let client = client.get_ref().clone();
    let pool = pool.get_ref().clone();
    let ai_manager = ai_manager.get_ref().clone();
    let url_clone = download_url.clone();
    let task_id_clone = task_id.clone();
    let progress_bc: Arc<progress_stream::ProgressBroadcaster> = progress_broadcaster.get_ref().clone();
    
    actix_web::rt::spawn(async move {
        orchestrate_sandbox(client, manager, pool, ai_manager, task_id_clone, url_clone, original_filename.clone(), 300, None, None, false, "quick".to_string(), progress_bc).await;
    });

    Ok(HttpResponse::Ok().json(serde_json::json!({ "status": "pivoted", "task_id": task_id })))
}

#[post("/vms/actions/exec-url")]
async fn exec_url(
    ai_manager: web::Data<AIManager>,
    manager: web::Data<Arc<AgentManager>>,
    client: web::Data<proxmox::ProxmoxClient>,
    pool: web::Data<Pool<Postgres>>,
    progress_broadcaster: web::Data<Arc<progress_stream::ProgressBroadcaster>>,
    req: web::Json<UrlRequest>
) -> impl Responder {
    // Create Task Record for URL Analysis
    let created_at = Utc::now().timestamp_millis();
    let task_id = created_at.to_string();
    
    // Use URL as the "filename" for tracking purposes
    let url_display = if req.url.len() > 100 {
        format!("{}...", &req.url[..97])
    } else {
        req.url.clone()
    };
    
    let vmid = req.vmid;
    let _ = sqlx::query(
        "INSERT INTO tasks (id, filename, original_filename, file_hash, status, created_at, sandbox_id) VALUES ($1, $2, $3, $4, 'Queued', $5, $6)"
    )
    .bind(&task_id)
    .bind(&format!("URL: {}", url_display))
    .bind(&req.url)
    .bind("N/A")  // No file hash for URL analysis
    .bind(created_at)
    .bind(vmid.map(|id: u64| id.to_string()))
    .execute(pool.get_ref())
    .await;
    
    println!("[URL Analysis] Task {} created for URL: {}", task_id, req.url);
    
    let duration = req.analysis_duration.unwrap_or(5) * 60;
    
    // Spawn Analysis Job
    let manager_clone = manager.get_ref().clone(); 
    let client_clone = client.get_ref().clone();
    let pool_clone = pool.get_ref().clone();
    let ai_manager = ai_manager.get_ref().clone();
    let url = req.url.clone();
    let task_id_clone = task_id.clone();
    let node = req.node.clone();
    let progress_bc: Arc<progress_stream::ProgressBroadcaster> = progress_broadcaster.get_ref().clone();
    
    actix_web::rt::spawn(async move {
        orchestrate_sandbox(client_clone, manager_clone, pool_clone, ai_manager, task_id_clone, url, "URL_Detonation".to_string(), duration, vmid, node, true, "quick".to_string(), progress_bc).await;
    });

    HttpResponse::Ok().json(serde_json::json!({ 
        "status": "analysis_queued", 
        "url": req.url,
        "task_id": task_id,
        "message": "URL analysis task created and orchestration initiated"
    }))
}

#[derive(Deserialize)]
struct VerdictOverride {
    verdict: String,
}

#[post("/tasks/{id}/verdict")]
async fn update_task_verdict(
    pool: web::Data<Pool<Postgres>>,
    path: web::Path<String>,
    req: web::Json<VerdictOverride>
) -> impl Responder {
    let id = path.into_inner();
    let risk_score = if req.verdict == "Malicious" { 100 } else { 0 };

    let res = sqlx::query("UPDATE tasks SET verdict=$2, risk_score=$3, verdict_manual=true WHERE id=$1")
        .bind(&id)
        .bind(&req.verdict)
        .bind(risk_score)
        .execute(pool.get_ref())
        .await;

    match res {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({ "status": "success", "verdict": req.verdict })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[get("/tasks")]
async fn list_tasks(pool: web::Data<Pool<Postgres>>) -> impl Responder {
    let tasks = sqlx::query_as::<_, Task>(
        "SELECT id, filename, original_filename, file_hash, status, verdict, risk_score, created_at, completed_at, ghidra_status, verdict_manual, sandbox_id, remnux_status, remnux_report FROM tasks ORDER BY created_at DESC"
    )
    .fetch_all(pool.get_ref())
    .await;

    match tasks {
        Ok(t) => HttpResponse::Ok().json(t),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[delete("/tasks/{id}")]
async fn delete_task(
    pool: web::Data<Pool<Postgres>>,
    path: web::Path<String>
) -> impl Responder {
    let id = path.into_inner();
    
    // Get filename first to delete the actual file
    let task = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = $1")
        .bind(&id)
        .fetch_optional(pool.get_ref())
        .await;

    match task {
        Ok(Some(t)) => {
            // Delete Associated Binary File
            let file_path = format!("./uploads/{}", t.filename);
            if let Err(e) = tokio::fs::remove_file(&file_path).await {
                println!("[DATABASE] Warning: Failed to delete file {}: {}", file_path, e);
            }
            
            // Delete Associatied Screenshots Folder
            let screenshot_dir = format!("./screenshots/{}", id);
            let _ = tokio::fs::remove_dir_all(&screenshot_dir).await;
            
            // Delete from Database
            if let Err(e) = sqlx::query("DELETE FROM tasks WHERE id = $1")
                .bind(&id)
                .execute(pool.get_ref())
                .await {
                println!("[DATABASE] Error deleting task {}: {}", id, e);
                return HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }));
            }
            
            // Also delete associated events
            let _ = sqlx::query("DELETE FROM events WHERE task_id = $1").bind(&id).execute(pool.get_ref()).await;
            
            println!("[DATABASE] Task {} and associated data deleted.", id);
            HttpResponse::Ok().json(serde_json::json!({ "status": "success", "message": "Task and data deleted" }))
        }
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({ "error": "Task not found" })),
        Err(e) => {
            println!("[DATABASE] Error fetching task for deletion: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

#[post("/tasks/purge")]
async fn purge_all(pool: web::Data<Pool<Postgres>>) -> impl Responder {
    println!("[SYSTEM] Purge All initiated...");
    
    // 1. Clear Database Tables
    let _ = sqlx::query("DELETE FROM tasks").execute(pool.get_ref()).await;
    let _ = sqlx::query("DELETE FROM events").execute(pool.get_ref()).await;
    
    // 2. Clear Files
    let _ = tokio::fs::remove_dir_all("./uploads").await;
    let _ = tokio::fs::create_dir_all("./uploads").await;
    let _ = tokio::fs::remove_dir_all("./screenshots").await;
    let _ = tokio::fs::create_dir_all("./screenshots").await;
    
    let _ = tokio::fs::remove_dir_all("./screenshots").await;
    let _ = tokio::fs::create_dir_all("./screenshots").await;
    
    println!("[SYSTEM] Purge complete: Database and files cleared.");
    HttpResponse::Ok().json(serde_json::json!({ "status": "success", "message": "All data cleared" }))
}

#[get("/vms/telemetry/history")]
async fn get_history(
    pool: web::Data<Pool<Postgres>>,
    query: web::Query<TaskQuery>
) -> impl Responder {
    let events = if let Some(tid) = &query.task_id {
        if let Some(search) = &query.search {
            sqlx::query_as::<_, RawAgentEvent>(
                "SELECT id, event_type, process_id, parent_process_id, process_name, details, decoded_details, timestamp, task_id 
                 FROM events 
                 WHERE task_id = $1 
                 AND to_tsvector('english', process_name || ' ' || details || ' ' || COALESCE(decoded_details, '')) @@ websearch_to_tsquery('english', $2)
                 ORDER BY timestamp DESC LIMIT 2000"
            )
            .bind(tid)
            .bind(search)
            .fetch_all(pool.get_ref())
            .await
        } else {
            sqlx::query_as::<_, RawAgentEvent>(
                "SELECT id, event_type, process_id, parent_process_id, process_name, details, decoded_details, timestamp, task_id 
                 FROM events 
                 WHERE task_id = $1 
                 ORDER BY timestamp DESC LIMIT 2000"
            )
            .bind(tid)
            .fetch_all(pool.get_ref())
            .await
        }
    } else {
        if let Some(search) = &query.search {
            sqlx::query_as::<_, RawAgentEvent>(
                "SELECT id, event_type, process_id, parent_process_id, process_name, details, decoded_details, timestamp, task_id 
                 FROM events 
                 WHERE to_tsvector('english', process_name || ' ' || details || ' ' || COALESCE(decoded_details, '')) @@ websearch_to_tsquery('english', $1)
                 ORDER BY timestamp DESC LIMIT 2000"
            )
            .bind(search)
            .fetch_all(pool.get_ref())
            .await
        } else {
            sqlx::query_as::<_, RawAgentEvent>(
                "SELECT id, event_type, process_id, parent_process_id, process_name, details, decoded_details, timestamp, task_id FROM events ORDER BY timestamp DESC LIMIT 2000"
            )
            .fetch_all(pool.get_ref())
            .await
        }
    };

    match events {
        Ok(evts) => HttpResponse::Ok().json(evts),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[post("/vms/telemetry/screenshot")]
async fn upload_screenshot(
    mut payload: Multipart,
    manager: web::Data<Arc<AgentManager>>
) -> Result<HttpResponse, Error> {
    let task_id = manager.get_any_active_task_id().await.unwrap_or_else(|| "unsorted".to_string());
    let task_dir = format!("./screenshots/{}", task_id);
    let _ = tokio::fs::create_dir_all(&task_dir).await;
    
    while let Ok(Some(mut field)) = TryStreamExt::try_next(&mut payload).await {
        let name = match field.content_disposition().and_then(|cd| cd.get_filename()) {
            Some(n) => n.to_string(),
            None => format!("screenshot_{}.png", Utc::now().timestamp_millis()),
        };
        let path = format!("{}/{}", task_dir, name);
        let mut f = tokio::fs::File::create(&path).await
            .map_err(|e| actix_web::error::ErrorInternalServerError(e))?;

        while let Ok(Some(chunk)) = TryStreamExt::try_next(&mut field).await {
            f.write_all(&chunk).await
                .map_err(|e| actix_web::error::ErrorInternalServerError(e))?;
        }
    }

    Ok(HttpResponse::Ok().json(serde_json::json!({ "status": "success" })))
}

#[get("/vms/telemetry/screenshots")]
async fn list_screenshots(query: web::Query<TaskQuery>) -> impl Responder {
    let mut files = Vec::new();
    let base_path = if let Some(tid) = &query.task_id {
        format!("./screenshots/{}", tid)
    } else {
        "./screenshots".to_string()
    };

    if let Ok(entries) = std::fs::read_dir(&base_path) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                // If we are listing the root, don't show directories
                if query.task_id.is_some() || !entry.path().is_dir() {
                    files.push(name);
                }
            }
        }
    }
    HttpResponse::Ok().json(files)
}

// Vector Search Helper
async fn query_vector_db(query: &str, n_results: usize) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let chroma_url = env::var("CHROMADB_URL").unwrap_or_else(|_| "http://chromadb:8000".to_string());
    let client = reqwest::Client::new();
    
    // Resolve Collection UUID via Name
    let col_uuid = match memory::get_collection_id(&client, &chroma_url, "malware_knowledge").await {
        Ok(id) => id,
        Err(_) => return Ok(vec![]), // Collection doesn't exist or isn't reachable
    };

    // Query using UUID
    let response = client
        .post(format!("{}/api/v2/collections/{}/query", chroma_url, col_uuid))
        .json(&serde_json::json!({
            "query_texts": [query],
            "n_results": n_results,
            "include": ["documents", "metadatas"]
        }))
        .send()
        .await;
    
    match response {
        Ok(resp) => {
            if resp.status().is_success() {
                match resp.json::<serde_json::Value>().await {
                    Ok(results) => {
                        let documents = results["documents"][0]
                            .as_array()
                            .unwrap_or(&vec![])
                            .iter()
                            .filter_map(|d| d.as_str().map(String::from))
                            .collect();
                        Ok(documents)
                    }
                    Err(_) => Ok(vec![]),
                }
            } else {
                Ok(vec![])
            }
        }
        Err(_) => Ok(vec![]),
    }
}

#[derive(Deserialize)]
struct ConfigRequest {
    provider: String,
    gemini_key: Option<String>,
    gemini_model: Option<String>,
    ollama_url: Option<String>,
    ollama_model: Option<String>,
    anthropic_key: Option<String>,
    anthropic_model: Option<String>,
    openai_key: Option<String>,
    openai_model: Option<String>,
    copilot_token: Option<String>,
    copilot_model: Option<String>,
}

#[post("/vms/ai/config")]
async fn set_ai_config(
    req: web::Json<ConfigRequest>,
    ai_manager: web::Data<AIManager>
) -> impl Responder {
    let provider = match req.provider.to_lowercase().as_str() {
        "gemini" => ProviderType::Gemini,
        "anthropic" => ProviderType::Anthropic,
        "openai" => ProviderType::OpenAI,
        "copilot" => ProviderType::Copilot,
        _ => ProviderType::Ollama, // Default fallback
    };

    ai_manager.switch_provider(
        provider, 
        req.gemini_key.clone(), 
        req.gemini_model.clone(),
        req.ollama_url.clone(), 
        req.ollama_model.clone(),
        req.anthropic_key.clone(),
        req.anthropic_model.clone(),
        req.openai_key.clone(),
        req.openai_model.clone(),
        req.copilot_token.clone(),
        req.copilot_model.clone()
    ).await;
    
    HttpResponse::Ok().json(serde_json::json!({ "status": "success", "provider": req.provider }))
}

#[get("/vms/ai/config")]
async fn get_ai_config(ai_manager: web::Data<AIManager>) -> impl Responder {
    let config = ai_manager.get_config().await;
    HttpResponse::Ok().json(config)
}

#[derive(Deserialize)]
struct AIModeRequest {
    mode: String,
}

#[post("/vms/ai/mode")]
async fn set_ai_mode(
    req: web::Json<AIModeRequest>,
    ai_manager: web::Data<AIManager>
) -> impl Responder {
    let mode = crate::ai::manager::AIMode::from_str(&req.mode);
    ai_manager.set_ai_mode(mode.clone()).await;
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "ai_mode": mode.to_str()
    }))
}

#[get("/vms/ai/mode")]
async fn get_ai_mode_handler(ai_manager: web::Data<AIManager>) -> impl Responder {
    let mode = ai_manager.get_ai_mode().await;
    HttpResponse::Ok().json(serde_json::json!({
        "ai_mode": mode.to_str()
    }))
}

#[post("/vms/ai/chat")]
async fn chat_handler(
    req: web::Json<ChatRequest>,
    ai_manager: web::Data<AIManager>,
    manager: web::Data<Arc<AgentManager>>,
    pool: web::Data<Pool<Postgres>>
) -> impl Responder {

    // Fetch recent analysis context
    let recent_tasks = sqlx::query_as::<_, Task>(
        "SELECT id, filename, original_filename, file_hash, status, verdict, risk_score, created_at, completed_at, ghidra_status, verdict_manual FROM tasks ORDER BY created_at DESC LIMIT 5"
    )
    .fetch_all(pool.get_ref())
    .await
    .unwrap_or_default();

    // Determine target task for context (prioritize requested task_id over global active)
    let target_task_id = if let Some(tid) = &req.task_id {
        Some(tid.clone())
    } else {
        manager.get_any_active_task_id().await
    };
    
    // Fetch Task Filename if we have a Task ID
    let mut target_filename = String::new();
    if let Some(tid) = &target_task_id {
         let row = sqlx::query("SELECT original_filename FROM tasks WHERE id = $1")
             .bind(tid)
             .fetch_optional(pool.get_ref())
             .await
             .unwrap_or(None);
         if let Some(r) = row {
             use sqlx::Row;
             target_filename = r.get("original_filename");
         }
    }

    let telemetry_events = if let Some(tid) = &target_task_id {
        sqlx::query_as::<_, RawAgentEvent>(
            "SELECT id, event_type, process_id, parent_process_id, process_name, details, decoded_details, timestamp, task_id, digital_signature 
             FROM events 
             WHERE task_id = $1 
             ORDER BY timestamp ASC LIMIT 500"
        )
        .bind(tid)
        .fetch_all(pool.get_ref())
        .await
        .unwrap_or_default()
    } else {
        Vec::new()
    };
    
    // Fallback: Global search also needs decoded_details
    let telemetry_events = if telemetry_events.is_empty() && target_task_id.is_none() {
        sqlx::query_as::<_, RawAgentEvent>(
            "SELECT id, event_type, process_id, parent_process_id, process_name, details, decoded_details, timestamp, task_id, digital_signature FROM events ORDER BY timestamp DESC LIMIT 200"
        )
        .fetch_all(pool.get_ref())
        .await
        .unwrap_or_default()
    } else {
        telemetry_events
    };

    // Patient Zero / Lineage Filtering
    let filtered_events: Vec<&RawAgentEvent> = if target_task_id.is_some() && !target_filename.is_empty() {
         let mut parent_map: std::collections::HashMap<i32, i32> = std::collections::HashMap::new();
         for evt in &telemetry_events {
             parent_map.insert(evt.process_id, evt.parent_process_id);
         }

         // Find Patient Zero: First PROCESS_CREATE matching filename
         let patient_zero = telemetry_events.iter()
            .find(|e| e.event_type == "PROCESS_CREATE" && e.process_name.to_lowercase().ends_with(&target_filename.to_lowercase()));
         
         let root_pid = if let Some(pz) = patient_zero {
             pz.process_id
         } else {
             // Fallback: If no direct match, find the first non-noise PID
             telemetry_events.iter()
                .filter(|e| !NOISE_PROCESSES.iter().any(|np| e.process_name.to_lowercase().contains(np)))
                .map(|e| e.process_id)
                .next()
                .unwrap_or(0)
         };

         let mut relevant_pids = std::collections::HashSet::new();
         if root_pid != 0 {
             relevant_pids.insert(root_pid);
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

         // Filter events by lineage
         telemetry_events.iter()
            .filter(|e| relevant_pids.contains(&e.process_id) || relevant_pids.contains(&e.parent_process_id))
            .collect()
    } else {
        // Global / No Task Fallback: Use standard noise filtering
        telemetry_events.iter()
            .filter(|e| !NOISE_PROCESSES.iter().any(|np| e.process_name.to_lowercase().contains(np)))
            .take(100)
            .collect()
    };

    // Fetch Ghidra findings for the target task
    let ghidra_findings: Vec<GhidraFunction> = if let Some(tid) = &target_task_id {
        sqlx::query_as::<_, GhidraFunction>(
            "SELECT function_name, entry_point, decompiled_code, assembly FROM ghidra_findings WHERE task_id = $1"
        )
        .bind(tid)
        .fetch_all(pool.get_ref())
        .await
        .unwrap_or_default()
    } else {
        vec![]
    };

    // --- High-Density Optimization: Prioritize Suspicious Functions ---
    let mut prioritized_ghidra = ghidra_findings;
    if !prioritized_ghidra.is_empty() {
        let high_risk_keywords = vec![
            "VirtualAlloc", "WriteProcessMemory", "CreateRemoteThread", 
            "RegSetValueEx", "InternetOpen", "HttpSendRequest", 
            "GetProcAddress", "IsDebuggerPresent", "CryptEncrypt", "ShellExecute"
        ];

        prioritized_ghidra.sort_by_key(|f| {
            let mut score = 0;
            let code_lower = f.decompiled_code.to_lowercase();
            let name_lower = f.function_name.to_lowercase();
            
            for &kw in &high_risk_keywords {
                let kw_lower = kw.to_lowercase();
                if code_lower.contains(&kw_lower) { score += 5; }
                if name_lower.contains(&kw_lower) { score += 10; }
            }
            std::cmp::Reverse(score) // Highest score first
        });

        // Limit to top 20 functions to preserve context window
        if prioritized_ghidra.len() > 20 {
            prioritized_ghidra.truncate(20);
        }
    }


    let mut context_summary = String::new();
    
    // Add task summary
    if !recent_tasks.is_empty() {
        context_summary.push_str("### SYSTEM CONTEXT: RECENTLY ANALYZED FILES\n");
        for t in &recent_tasks {
            context_summary.push_str(&format!(
                "- {} (SHA256: {}) - Status: {}, Verdict: {} (Risk Score: {})
", 
                t.original_filename, t.file_hash, t.status, t.verdict.as_deref().unwrap_or("Pending"), t.risk_score.unwrap_or(0)
            ));
        }
        context_summary.push_str("\n");
    }

    // Add Ghidra Insight
    if !prioritized_ghidra.is_empty() {
        context_summary.push_str("### STATIC ANALYSIS (Top Forensic Findings):\n");
        for func in &prioritized_ghidra {
            context_summary.push_str(&format!(
                "- Function: {} @ {}\n  Code Snippet: {}\n",
                func.function_name,
                func.entry_point,
                func.decompiled_code.chars().take(200).collect::<String>().replace("\n", " ")
            ));
        }
        context_summary.push_str("\n");
    }

    // Add telemetry summary
    if !filtered_events.is_empty() {
        context_summary.push_str("BEHAVIORAL TELEMETRY DATA (Filtered - Malicious Activity Only):\n");
        context_summary.push_str("Benign Windows processes have been filtered out. Analyze this data to understand malicious behavior:\n\n");
        
        // Safety: Limit telemetry in context if too large
        let telemetry_limit = if prioritized_ghidra.is_empty() { 300 } else { 150 };
        for (idx, evt) in filtered_events.iter().take(telemetry_limit).enumerate() {
            context_summary.push_str(&format!(
                "{}. [{}] PID:{} PPID:{} Process:'{}' - {}\n",
                idx + 1,
                evt.event_type,
                evt.process_id,
                evt.parent_process_id,
                evt.process_name,
                evt.details
            ));
        }
    } else {
        context_summary.push_str("No relevant telemetry events captured (all events were filtered as benign system activity).\n");
    }

    // Query Vector Database for relevant malware knowledge
    let vector_context = if !req.message.is_empty() {
        let mut vector_results = Vec::new();
        
        let req_msg = req.message.clone();
        // Query with different perspectives for better coverage
        let queries = vec![
            req_msg.clone(),
            format!("malware technique: {}", req_msg),
            format!("MITRE ATT&CK: {}", req_msg),
        ];
        
        for query in queries {
            if let Ok(docs) = query_vector_db(&query, 2).await {
                vector_results.extend(docs);
            }
        }
        
        // Deduplicate and limit results
        vector_results.sort();
        vector_results.dedup();
        vector_results.truncate(5);
        
        if !vector_results.is_empty() {
            let mut vctx = String::from("\n\nRELEVANT MALWARE INTELLIGENCE (Vector DB):\n");
            vctx.push_str("The following knowledge has been retrieved from the malware intelligence database:\n\n");
            for (idx, doc) in vector_results.iter().enumerate() {
                vctx.push_str(&format!("{}. {}\n\n", idx + 1, doc));
            }
            vctx
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    
    context_summary.push_str(&vector_context);

    // --- FORENSIC MEMORY: Inject AI + Analyst Notes ---
    if let Some(tid) = &req.task_id {
        let notes: Vec<(String, String, bool)> = sqlx::query_as(
            "SELECT author, content, is_hint FROM analyst_notes WHERE task_id = $1 ORDER BY created_at ASC"
        )
        .bind(tid)
        .fetch_all(pool.get_ref())
        .await
        .unwrap_or_default();

        if !notes.is_empty() {
            context_summary.push_str("\n\n### FORENSIC MEMORY (AI + Analyst Notes)\n");
            context_summary.push_str("These are observations from previous analysis passes and human analysts. Reference them for continuity.\n\n");
            for (idx, (author, content, is_hint)) in notes.iter().enumerate() {
                let prefix = if *is_hint { "🔍 AI Insight" } else { "📝 Analyst Note" };
                context_summary.push_str(&format!("{}. [{}] ({}): {}\n", idx + 1, prefix, author, content));
            }
        }
    }

    // Add explicit page context if provided
    if let Some(pc) = &req.page_context {
        context_summary.push_str("\n\nCURRENT ANALYST VIEW CONTEXT (Screen Data):\n");
        context_summary.push_str(pc);
        context_summary.push_str("\n");
    }

    // Safety Cap: Hard limit removed for Map-Reduce, but kept as sanity check (100k)
    if context_summary.len() > 100000 {
        context_summary.truncate(100000);
        context_summary.push_str("\n... [CONTEXT TRUNCATED] ...");
    }

    // SYSTEM PROMPT
    let system_prompt = format!(
"## VooDooBox Intelligence Core | System Prompt
You are the VooDooBox AI, a high-fidelity forensic analysis node. 
Analyze the provided context and respond to the user's query.

FORMATTING RULES:
1. You MUST enclose your internal reasoning in <think> tags before your final answer.
2. The final answer should be clear and concise.

Example:
<think>
User asks about file X. I see it in the context...
</think>
The file X appears to be malicious...

CONTEXT SUMMARY:
{}
", context_summary);

    let use_map_reduce = context_summary.len() > 10000;
    let ai_manager_clone = ai_manager.get_ref().clone();
    let history_clone = req.history.clone();
    let message_clone = req.message.clone();

    let stream = if use_map_reduce {
         ai_manager_clone.map_reduce_ask(
             history_clone,
             context_summary,
             message_clone
         )
    } else {
        let (tx, rx): (tokio::sync::mpsc::Sender<Result<StreamEvent, Box<dyn std::error::Error + Send + Sync>>>, _) = tokio::sync::mpsc::channel(1);
        
        let sys_prompt_final = system_prompt; 
        let mut history_final = req.history.clone();
        history_final.push(crate::ai::provider::ChatMessage {
            role: "user".to_string(),
            content: req.message.clone(),
        }); 

        tokio::spawn(async move {
            println!("[AI] Starting chat stream. Prompt len: {}", sys_prompt_final.len());
            let _ = tx.send(Ok(StreamEvent::Thought("Analyzing...".to_string()))).await;
            println!("[AI] Sent 'Analyzing' event to stream");

            match ai_manager_clone.ask(history_final, sys_prompt_final).await {
                Ok(response) => {
                    println!("[AI] Received response from provider (len: {})", response.len());
                    
                    let mut response_text = response.clone();
                    
                    // CRITICAL FIX: Detect if the response is double-encoded (wrapped in quotes)
                    if response_text.trim().starts_with('"') && response_text.trim().ends_with('"') {
                         if let Ok(unescaped) = serde_json::from_str::<String>(&response_text) {
                             println!("[AI] Detected double-encoded chat response, unescaping...");
                             response_text = unescaped.trim().to_string();
                         }
                    }

                    let mut final_text = response_text.clone();
                    
                    // Extraction with priority to simple find, fallback to regex
                    let mut extracted = false;
                    if let Some(start_idx) = response_text.find("<think>") {
                        if let Some(end_idx) = response_text.find("</think>") {
                            let thought = &response_text[start_idx + 7..end_idx];
                            let _ = tx.send(Ok(StreamEvent::Thought(thought.trim().to_string()))).await;
                            final_text = format!("{}{}", &response_text[..start_idx], &response_text[end_idx + 8..]).trim().to_string();
                            extracted = true;
                        }
                    }
                    
                    if !extracted {
                        let re_think = regex::Regex::new(r"(?s)<think>(.*?)</think>").unwrap();
                        if let Some(caps) = re_think.captures(&response_text) {
                            if let Some(thought) = caps.get(1) {
                                let _ = tx.send(Ok(StreamEvent::Thought(thought.as_str().trim().to_string()))).await;
                                final_text = re_think.replace(&response_text, "").to_string().trim().to_string();
                            }
                        }
                    }
                    
                    let _ = tx.send(Ok(StreamEvent::Final(final_text))).await;
                    println!("[AI] Sent Final response to stream");
                },
                Err(e) => {
                    println!("[AI] Ask failed: {}", e);
                    let _ = tx.send(Err(e)).await;
                }
            }
        });
        tokio_stream::wrappers::ReceiverStream::new(rx)
    };
    
    let sse_stream = stream.map(|result| {
        match result {
            Ok(event) => {
                match serde_json::to_string(&event) {
                    Ok(json) => Ok::<_, actix_web::Error>(web::Bytes::from(format!("data: {}\n\n", json))),
                    Err(_) => Ok(web::Bytes::from(format!("data: {{\"type\":\"error\",\"content\":\"Serialization Error\"}}\n\n"))),
                }
            },
            Err(e) => {
                 Ok(web::Bytes::from(format!("data: {{\"type\":\"error\",\"content\":\"{}\"}}\n\n", e)))
            }
        }
    });

    HttpResponse::Ok()
        .content_type("text/event-stream")
        .streaming(sse_stream)
}


#[post("/vms/analysis/ai-insight")]
async fn ai_insight_handler(
    req: web::Json<AnalysisRequest>,
    ai_manager: web::Data<AIManager>,
) -> impl Responder {
    let prompt = format!(
        "## Forensic Insight Protocol\n\
\n\
Analyze the evidence according to the following rules:\n\
1. FOCUS: Anomalous parent-child relations, LOLBins (certutil, etc), and registry persistence.\n\
2. ACCURACY: Extract EXACT PIDs. Citations required.\n\
3. VERDICT: Use Risk Score (0-100) and MITRE TTP IDs (e.g., T1055).\n\n\
<EVIDENCE>\n\
{}\n\
</EVIDENCE>\n\
\n\
Return ONLY RAW JSON.",
        serde_json::to_string(&req.into_inner()).unwrap_or_default()
    );

    match ai_manager.ask(vec![], prompt).await {
        Ok(ai_text) => {
            let clean_json = ai_text.trim_matches(|c| c == '`' || c == '\n' || c == ' ');
            let clean_json = clean_json.strip_prefix("json").unwrap_or(clean_json).trim();
            
            match serde_json::from_str::<ai_analysis::AIReport>(clean_json) {
                Ok(report) => HttpResponse::Ok().json(report),
                Err(e) => {
                    eprintln!("[AI_INSIGHT_ERROR] Failed to parse JSON: {}. Text: {}", e, ai_text);
                    HttpResponse::InternalServerError().body(format!("Failed to parse AI response: {}", e))
                }
            }
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

async fn trigger_ghidra_background(filename: String, task_id: String, pool: Pool<Postgres>) {
    // 1. Set status to Running in DB immediately
    let _ = sqlx::query("UPDATE tasks SET ghidra_status = 'Analysis Running' WHERE id = $1")
        .bind(&task_id)
        .execute(&pool)
        .await;

    let ghidra_api = env::var("GHIDRA_API_INTERNAL").unwrap_or_else(|_| "http://ghidra:8000".to_string());
    let client = reqwest::Client::new();
    
    let payload = serde_json::json!({
        "binary_name": filename,
        "task_id": task_id
    });

    println!("[GHIDRA] Triggering background analysis for {} (Task: {})", filename, task_id);
    
    match client.post(format!("{}/analyze", ghidra_api))
        .json(&payload)
        .send()
        .await {
            Ok(_) => println!("[GHIDRA] Background analysis queued successfully."),
            Err(e) => {
                println!("[GHIDRA] Failed to queue background analysis: {}", e);
                // Mark as failed so UI doesn't hang
                let _ = sqlx::query("UPDATE tasks SET ghidra_status = 'Failed' WHERE id = $1")
                    .bind(&task_id)
                    .execute(&pool)
                    .await;
            }
        }
}

#[post("/ghidra/analyze")]
async fn ghidra_analyze(req: web::Json<serde_json::Value>) -> impl Responder {
    let client = reqwest::Client::new();
    let ghidra_api = env::var("GHIDRA_API_INTERNAL").unwrap_or_else(|_| "http://ghidra:8000".to_string());
    
    let res = client.post(format!("{}/analyze", ghidra_api))
        .json(&req.into_inner())
        .send()
        .await;

    match res {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.json::<serde_json::Value>().await.unwrap_or_default();
            HttpResponse::build(status).json(body)
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[get("/ghidra/binary/{name}/functions")]
async fn ghidra_functions(path: web::Path<String>) -> impl Responder {
    let name = path.into_inner();
    let client = reqwest::Client::new();
    let ghidra_api = env::var("GHIDRA_API_INTERNAL").unwrap_or_else(|_| "http://ghidra:8000".to_string());
    
    let res = client.get(format!("{}/binary/{}/functions", ghidra_api, name))
        .send()
        .await;

    match res {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.json::<serde_json::Value>().await.unwrap_or_default();
            HttpResponse::build(status).json(body)
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[get("/ghidra/binary/{name}/decompile/{address}")]
async fn ghidra_decompile(path: web::Path<(String, String)>) -> impl Responder {
    let (name, address) = path.into_inner();
    let client = reqwest::Client::new();
    let ghidra_api = env::var("GHIDRA_API_INTERNAL").unwrap_or_else(|_| "http://ghidra:8000".to_string());
    
    let res = client.get(format!("{}/binary/{}/decompile/{}", ghidra_api, name, address))
        .send()
        .await;

    match res {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.json::<serde_json::Value>().await.unwrap_or_default();
            HttpResponse::build(status).json(body)
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[derive(serde::Deserialize)]
struct GhidraIngestBatch {
    task_id: Option<String>,
    binary_name: String,
    functions: Vec<GhidraFunction>,
}

#[derive(sqlx::FromRow, serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct GhidraFunction {
    pub function_name: String,
    pub entry_point: String,
    pub decompiled_code: String,
    pub assembly: String,
}

#[post("/ghidra/ingest")]
async fn ghidra_ingest(
    req: web::Json<GhidraIngestBatch>,
    pool: web::Data<Pool<Postgres>>
) -> Result<HttpResponse, actix_web::Error> {
    let batch = req.into_inner();
    let task_id = batch.task_id.unwrap_or_else(|| "unsorted".to_string());
    println!("[GHIDRA] Ingesting {} functions for Task {}", batch.functions.len(), task_id);
    let now = Utc::now().timestamp_millis();

    if batch.functions.is_empty() {
        return Ok(HttpResponse::Ok().json(serde_json::json!({ "status": "no_data" })));
    }

    // --- Optimization: Bulk Insert using UNNEST ---
    // Prepare vectors for columnar binding
    let mut function_names = Vec::with_capacity(batch.functions.len());
    let mut entry_points = Vec::with_capacity(batch.functions.len());
    let mut decompiled_codes = Vec::with_capacity(batch.functions.len());
    let mut assemblies = Vec::with_capacity(batch.functions.len());

    for func in batch.functions {
        function_names.push(func.function_name);
        entry_points.push(func.entry_point);
        decompiled_codes.push(func.decompiled_code);
        assemblies.push(func.assembly);
    }

    // Execute single query with UNNEST
    // We use DISTINCT ON (u.fn_name) to ensure that if the input batch contains duplicates,
    // we only attempt to insert one of them, allowing ON CONFLICT to work without crashing.
    let res = sqlx::query(
        "INSERT INTO ghidra_findings (task_id, binary_name, function_name, entry_point, decompiled_code, assembly, timestamp)
         SELECT DISTINCT ON (u.fn_name) $1, $2, u.fn_name, u.ep, u.dc, u.asm, $3
         FROM UNNEST($4::text[], $5::text[], $6::text[], $7::text[]) 
         AS u(fn_name, ep, dc, asm)
         ON CONFLICT (task_id, function_name) DO UPDATE 
         SET decompiled_code = EXCLUDED.decompiled_code, 
             assembly = EXCLUDED.assembly,
             timestamp = EXCLUDED.timestamp"
    )
    .bind(&task_id)
    .bind(&batch.binary_name)
    .bind(now)
    .bind(&function_names)
    .bind(&entry_points)
    .bind(&decompiled_codes)
    .bind(&assemblies)
    .execute(pool.get_ref())
    .await;

    match res {
        Ok(_) => Ok(HttpResponse::Ok().json(serde_json::json!({ "status": "success" }))),
        Err(e) => {
            println!("[GHIDRA] Bulk Insert Failed: {}", e);
            Err(actix_web::error::ErrorInternalServerError(e))
        }
    }
}

#[derive(serde::Deserialize)]
struct GhidraIngestComplete {
    task_id: String,
}

#[post("/ghidra/ingest/complete")]
async fn ghidra_ingest_complete(
    req: web::Json<GhidraIngestComplete>,
    pool: web::Data<Pool<Postgres>>
) -> impl Responder {
    let task_id = &req.task_id;
    println!("[GHIDRA] Received COMPLETION SIGNAL for Task {}", task_id);
    
    let res = sqlx::query("UPDATE tasks SET ghidra_status = 'Analysis Complete' WHERE id = $1")
        .bind(task_id)
        .execute(pool.get_ref())
        .await;

    match res {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({ "status": "completed" })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[get("/ghidra/scripts")]
async fn ghidra_list_scripts() -> impl Responder {
    // Proxy to Ghidra service
    let client = reqwest::Client::new();
    let res = client.get("http://ghidra:8000/scripts")
        .send()
        .await;

    match res {
        Ok(resp) => {
            let body = resp.text().await.unwrap_or_else(|_| "[]".to_string());
            HttpResponse::Ok()
                .content_type("application/json")
                .body(body)
        },
        Err(e) => {
             println!("Failed to fetch scripts from Ghidra: {}", e);
             HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Ghidra offline" }))
        }
    }
}

#[post("/ghidra/run-script")]
async fn ghidra_run_script(req: web::Json<serde_json::Value>) -> impl Responder {
    let client = reqwest::Client::new();
    let res = client.post("http://ghidra:8000/run-script")
        .json(&req.into_inner())
        .send()
        .await;

    match res {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
            HttpResponse::build(status)
                .content_type("application/json")
                .body(body)
        },
        Err(_) => HttpResponse::InternalServerError().body("Ghidra connection failed")
    }
}

#[get("/tasks/{id}/ghidra-findings")]
async fn get_ghidra_findings(
    path: web::Path<String>,
    pool: web::Data<Pool<Postgres>>
) -> impl Responder {
    let task_id = path.into_inner();
    let res = sqlx::query("SELECT function_name, entry_point, decompiled_code, assembly FROM ghidra_findings WHERE task_id = $1")
        .bind(task_id)
        .fetch_all(pool.get_ref())
        .await;
    
    match res {
        Ok(rows) => {
            use sqlx::Row;
            let findings: Vec<serde_json::Value> = rows.into_iter().map(|row| {
                serde_json::json!({
                    "function_name": row.get::<String, _>("function_name"),
                    "entry_point": row.get::<String, _>("entry_point"),
                    "decompiled_code": row.get::<String, _>("decompiled_code"),
                    "assembly": row.get::<String, _>("assembly")
                })
            }).collect();
            HttpResponse::Ok().json(findings)
        },
        Err(e) => HttpResponse::InternalServerError().body(e.to_string())
    }
}

#[get("/tasks/{id}/ai-report")]
async fn get_ai_report(
    path: web::Path<String>,
    pool: web::Data<Pool<Postgres>>
) -> impl Responder {
    let task_id = path.into_inner();
    let res = sqlx::query("SELECT risk_score, threat_level, summary, suspicious_pids, mitre_tactics, recommendations, forensic_report_json FROM analysis_reports WHERE task_id = $1")
        .bind(task_id)
        .fetch_optional(pool.get_ref())
        .await;
    
    match res {
        Ok(Some(row)) => {
            use sqlx::Row;
            // Try to return the full forensic report if available (preferred)
            if let Ok(json_str) = row.try_get::<String, _>("forensic_report_json") {
                let mut current_json = json_str;
                // Robust Unescape Loop: AI or DB sometimes double-wraps JSON in quotes
                for _ in 0..3 {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&current_json) {
                        if parsed.is_object() {
                            return HttpResponse::Ok().json(parsed);
                        } else if let Some(inner_str) = parsed.as_str() {
                            current_json = inner_str.to_string();
                            continue;
                        }
                    }
                    break;
                }
            }

            // Fallback to legacy partial fields
            let report = serde_json::json!({
                "risk_score": row.get::<i32, _>("risk_score"),
                "threat_level": row.get::<String, _>("threat_level"),
                "summary": row.get::<String, _>("summary"),
                "suspicious_pids": row.get::<Vec<i32>, _>("suspicious_pids"),
                "mitre_tactics": row.get::<Vec<String>, _>("mitre_tactics"),
                "recommendations": row.get::<Vec<String>, _>("recommendations")
            });
            HttpResponse::Ok().json(report)
        },
        Ok(None) => HttpResponse::NotFound().body("No AI report found for this task"),
        Err(e) => {
            eprintln!("[AI] Database fetch error: {}", e);
            HttpResponse::InternalServerError().body(e.to_string())
        }
    }
}

#[post("/tasks/{id}/analyze")]
async fn trigger_task_analysis(
    path: web::Path<String>,
    req: web::Json<ManualAnalysisRequest>,
    ai_manager: web::Data<AIManager>,
    manager: web::Data<Arc<AgentManager>>,
    pool: web::Data<Pool<Postgres>>
) -> impl Responder {
    let task_id = path.into_inner();
    let auto_response = req.auto_response.unwrap_or(true); // Default to true if not specified, or false? Let's say true for now.
    println!("[AI] Manual analysis trigger for task: {} (Auto-Response: {})", task_id, auto_response);
    
    let mode = req.mode.clone().unwrap_or_else(|| "quick".to_string());
    match ai_analysis::generate_ai_report(&task_id, pool.get_ref(), &ai_manager, manager.get_ref().clone(), auto_response, &mode).await {
        Ok(_) => {
            // After generation, fetch the full forensic report JSON
            let res = sqlx::query("SELECT forensic_report_json FROM analysis_reports WHERE task_id = $1")
                .bind(&task_id)
                .fetch_optional(pool.get_ref())
                .await;

            match res {
                Ok(Some(row)) => {
                    use sqlx::Row;
                    let forensic_json: String = row.get("forensic_report_json");
                    
                    let mut current_json = forensic_json;
                    let mut final_report = None;
                    
                    // Robust Unescape Loop
                    for _ in 0..3 {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&current_json) {
                            if parsed.is_object() {
                                final_report = Some(parsed);
                                break;
                            } else if let Some(inner_str) = parsed.as_str() {
                                current_json = inner_str.to_string();
                                continue;
                            }
                        }
                        break;
                    }

                    if let Some(report) = final_report {
                        HttpResponse::Ok().json(report)
                    } else {
                        println!("[AI] Failed to parse forensic report JSON as object.");
                        HttpResponse::InternalServerError().body("Failed to parse report")
                    }
                },
                _ => HttpResponse::InternalServerError().body("Report generated but failed to retrieve")
            }
        },
        Err(e) => {
            println!("[AI] Manual analysis failed for Task {}: {}", task_id, e);
            HttpResponse::InternalServerError().body(format!("Analysis failed: {}", e))
        }
    }
}



#[post("/tasks/{id}/report/pdf")]
async fn generate_pdf_report(
    path: web::Path<String>,
    body: web::Json<serde_json::Value>
) -> impl Responder {
    let task_id = path.into_inner();
    let file_path = format!("reports/{}.pdf", task_id);

    // Ensure reports directory exists
    let _ = std::fs::create_dir_all("reports");

    // Check if pre-generated (high quality) report exists
    if std::path::Path::new(&file_path).exists() {
        match fs::read(&file_path) {
            Ok(bytes) => {
                println!("[PDF] Serving cached report for {}", task_id);
                return HttpResponse::Ok()
                    .content_type("application/pdf")
                    .body(bytes);
            },
            Err(e) => {
                println!("[PDF] Failed to read cached report: {}", e);
            }
        }
    }

    // Fallback: On-the-fly generation if cached file is missing
    let json_val = body.into_inner();
    
    // 1. Try Legacy AIReport
    if let Ok(legacy_report) = serde_json::from_value::<AIReport>(json_val.clone()) {
        println!("[PDF] Generating legacy PDF for {}", task_id);
        match reports::generate_pdf(task_id.clone(), legacy_report) {
            Ok(pdf_bytes) => return HttpResponse::Ok().content_type("application/pdf").body(pdf_bytes),
            Err(e) => println!("[PDF] Legacy generation failed: {}", e),
        }
    }
    
    // 2. Try New ForensicReport (Requires re-generation logic or minimal template)
    // For now, if we have a ForensicReport, we return 404 but with a better message 
    // because full Forensic PDF requires AnalysisContext which isn't in the POST body.
    // However, we can at least log that we received it.
    if let Ok(_) = serde_json::from_value::<ai_analysis::ForensicReport>(json_val) {
        println!("[PDF] Received ForensicReport for {}, but cached PDF is missing and on-the-fly generation for ForensicReport is pending implementation.", task_id);
        return HttpResponse::NotFound().body("Forensic PDF not found. Please re-run analysis to generate it.");
    }

    HttpResponse::NotFound().body("Report PDF not found and could not be generated from fallback")
}

async fn init_db() -> Pool<Postgres> {
    let database_url = match env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            // Fallback: try to construct it manually from env vars if somehow missing
            let user = env::var("POSTGRES_USER").unwrap_or_else(|_| "voodoobox".to_string());
            let pass = env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "voodoobox_secure".to_string());
            let db_name = env::var("POSTGRES_DB").unwrap_or_else(|_| "voodoobox_telemetry".to_string());
            // URL encode the password to handle special characters (#, @, etc)
            let encoded_pass = urlencoding::encode(&pass);
            format!("postgres://{}:{}@db:5432/{}", user, encoded_pass, db_name)
        }
    };

    println!("[DATABASE] Attempting connection. URL Structure: {}... (password masked)", 
        database_url.split('@').next().unwrap_or("???"));

    // Install the drivers manually if using Any
    sqlx::any::install_default_drivers();

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .unwrap_or_else(|e| {
            // Safe Debugging: Show scheme and end of URL, mask password
            let masked = if let Some((prefix, suffix)) = database_url.split_once('@') {
                 let scheme_part = prefix.split(':').next().unwrap_or("???");
                 format!("{}://***:***@{}", scheme_part, suffix)
            } else {
                 "INVALID_FORMAT_NO_AT_SYMBOL".to_string()
            };
            panic!("Failed to connect to Database. URL structure: '{}'. Error: {}", masked, e);
        });

    println!("[DATABASE] Connection established. Creating tables...");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS events (
            id SERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            process_id INTEGER NOT NULL,
            parent_process_id INTEGER NOT NULL,
            process_name TEXT NOT NULL,
            details TEXT NOT NULL,
            decoded_details TEXT,
            timestamp BIGINT NOT NULL,
            task_id TEXT
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create events table");

    println!("[DATABASE] Events table ready.");

    // Migration for existing events table
    let _ = sqlx::query("ALTER TABLE events ADD COLUMN IF NOT EXISTS task_id TEXT").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE events ADD COLUMN IF NOT EXISTS decoded_details TEXT").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE events ADD COLUMN IF NOT EXISTS session_id TEXT").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE events ADD COLUMN IF NOT EXISTS digital_signature TEXT").execute(&pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_events_search ON events USING GIN (to_tsvector('english', process_name || ' ' || details || ' ' || COALESCE(decoded_details, '')))").execute(&pool).await;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            original_filename TEXT NOT NULL DEFAULT '',
            file_hash TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            verdict TEXT,
            risk_score INTEGER,
            created_at BIGINT NOT NULL,
            completed_at BIGINT,
            ghidra_status TEXT DEFAULT 'Not Started',
            verdict_manual BOOLEAN DEFAULT FALSE,
            sandbox_id TEXT
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create tasks table");

    // Migrations
    let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sandbox_id TEXT").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS file_path TEXT").execute(&pool).await;

    println!("[DATABASE] Tasks table ready.");

    // Explicitly add columns if they don't exist (Migration for existing DBs)
    let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS original_filename TEXT DEFAULT ''").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS file_hash TEXT DEFAULT ''").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ghidra_status TEXT DEFAULT 'Not Started'").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verdict_manual BOOLEAN DEFAULT FALSE").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remnux_status TEXT DEFAULT 'Not Started'").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remnux_report JSONB").execute(&pool).await;

    println!("[DATABASE] Task table migrations complete.");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS ghidra_findings (
            id SERIAL PRIMARY KEY,
            task_id TEXT NOT NULL,
            binary_name TEXT NOT NULL,
            function_name TEXT NOT NULL,
            entry_point TEXT NOT NULL,
            decompiled_code TEXT NOT NULL,
            assembly TEXT NOT NULL,
            timestamp BIGINT NOT NULL
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create analysis_reports table");

    // Analyst Notes Table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS analyst_notes (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            author TEXT DEFAULT 'analyst',
            content TEXT NOT NULL,
            is_hint BOOLEAN DEFAULT FALSE,
            created_at BIGINT
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create analyst_notes table");

    // Telemetry Tags Table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS telemetry_tags (
            task_id TEXT NOT NULL,
            event_id INTEGER NOT NULL,
            tag_type TEXT NOT NULL,
            comment TEXT,
            PRIMARY KEY (task_id, event_id)
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create telemetry_tags table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS analysis_reports (
            id SERIAL PRIMARY KEY,
            task_id TEXT NOT NULL UNIQUE,
            risk_score INTEGER,
            threat_level TEXT,
            summary TEXT,
            suspicious_pids INTEGER[],
            mitre_tactics TEXT[],
            recommendations TEXT[],
            forensic_report_json TEXT DEFAULT '{}',
            created_at BIGINT
        )"
    )
    .execute(&pool)
    .await
    .expect("Failed to create analysis_reports table");

    println!("[DATABASE] Analysis Reports table ready.");
    
    // Initialize VirusTotal Cache
    if let Err(e) = virustotal::init_db(&pool).await {
         println!("[VT] DB Init Error: {}", e);
    }
    
    // Migration for forensic_report_json
    let _ = sqlx::query("ALTER TABLE analysis_reports ADD COLUMN IF NOT EXISTS forensic_report_json TEXT DEFAULT '{}'").execute(&pool).await;

    // Enforce UNIQUE constraint on task_id for existing tables
    // 1. Clean up duplicates (keep most recent)
    let _ = sqlx::query(
        "DELETE FROM analysis_reports a
         USING analysis_reports b
         WHERE a.id < b.id AND a.task_id = b.task_id"
    ).execute(&pool).await;

    // 2. Add the unique constraint if it doesn't exist
    let _ = sqlx::query(
        "DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'analysis_reports_task_id_key'
            ) THEN
                ALTER TABLE analysis_reports ADD CONSTRAINT analysis_reports_task_id_key UNIQUE (task_id);
            END IF;
        END $$;"
    ).execute(&pool).await;

    println!("[DATABASE] Analysis Reports migrations complete.");

    // ── ExtensionDetox Tables ──
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS detox_publishers (
            id SERIAL PRIMARY KEY,
            publisher_id TEXT UNIQUE NOT NULL,
            publisher_name TEXT NOT NULL,
            display_name TEXT,
            domain TEXT,
            is_domain_verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )"
    ).execute(&pool).await.expect("Failed to create detox_publishers table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS detox_extensions (
            id SERIAL PRIMARY KEY,
            extension_id TEXT NOT NULL,
            version TEXT NOT NULL,
            display_name TEXT,
            short_desc TEXT,
            vsix_hash_sha256 TEXT,
            published_date TEXT,
            last_updated TEXT,
            install_count INTEGER DEFAULT 0,
            average_rating REAL DEFAULT 0.0,
            publisher_id INTEGER REFERENCES detox_publishers(id),
            scan_state TEXT DEFAULT 'QUEUED',
            latest_state TEXT DEFAULT 'pending',
            risk_score REAL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(extension_id, version)
        )"
    ).execute(&pool).await.expect("Failed to create detox_extensions table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS detox_scan_history (
            id SERIAL PRIMARY KEY,
            extension_db_id INTEGER NOT NULL REFERENCES detox_extensions(id),
            scan_type TEXT NOT NULL DEFAULT 'static',
            started_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            ai_vibe_score REAL,
            static_score REAL,
            behavioral_score REAL,
            trust_score REAL,
            composite_score REAL,
            risk_score REAL,
            findings_json JSONB,
            raw_ai_response TEXT
        )"
    ).execute(&pool).await.expect("Failed to create detox_scan_history table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS detox_blocklist (
            id SERIAL PRIMARY KEY,
            extension_id TEXT UNIQUE NOT NULL,
            removal_date TEXT,
            removal_type TEXT,
            synced_at TIMESTAMPTZ DEFAULT NOW()
        )"
    ).execute(&pool).await.expect("Failed to create detox_blocklist table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS detox_iocs (
            id SERIAL PRIMARY KEY,
            scan_history_id INTEGER NOT NULL REFERENCES detox_scan_history(id),
            ioc_type TEXT NOT NULL,
            ioc_value TEXT NOT NULL,
            context TEXT,
            vt_detection INTEGER,
            discovered_at TIMESTAMPTZ DEFAULT NOW()
        )"
    ).execute(&pool).await.expect("Failed to create detox_iocs table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS detox_static_findings (
            id SERIAL PRIMARY KEY,
            scan_history_id INTEGER NOT NULL REFERENCES detox_scan_history(id),
            finding_type TEXT NOT NULL,
            severity TEXT DEFAULT 'info',
            file_path TEXT,
            line_number INTEGER,
            description TEXT NOT NULL,
            raw_match TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )"
    ).execute(&pool).await.expect("Failed to create detox_static_findings table");

    println!("[DATABASE] ExtensionDetox tables ready.");

    // --- Ghidra Findings Migration ---
    // 1. Clean up duplicates (keep most recent)
    let res_clean = sqlx::query(
        "DELETE FROM ghidra_findings a
         USING ghidra_findings b
         WHERE a.id < b.id AND a.task_id = b.task_id AND a.function_name = b.function_name"
    ).execute(&pool).await;
    
    if let Err(e) = res_clean {
        println!("[DATABASE] Warning: Failed to clean up Ghidra duplicates: {}", e);
    }

    // 2. Add Unique Index for ON CONFLICT support
    let res_index = sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ghidra_findings_task_func ON ghidra_findings (task_id, function_name)"
    ).execute(&pool).await;

    if let Err(e) = res_index {
        println!("[DATABASE] Critical: Failed to create unique index for Ghidra findings: {}", e);
        // We panic here because without this index, ingestion WILL fail
        panic!("Database migration failed: Could not create unique index on ghidra_findings");
    }

    println!("[DATABASE] Ghidra Findings migrations complete.");

    pool
}

#[derive(Deserialize)]
struct HistoryQuery {
    task_id: String,
    search: Option<String>,
}

#[get("/vms/telemetry/history")]
async fn get_telemetry_history(
    query: web::Query<HistoryQuery>,
    pool_data: web::Data<Pool<Postgres>>,
) -> impl Responder {
    let task_id = &query.task_id;
    let pool = pool_data.get_ref();

    let rows = if let Some(search_term) = &query.search {
        if search_term.is_empty() {
             sqlx::query_as::<_, RawAgentEvent>(
                "SELECT * FROM events WHERE task_id = $1 ORDER BY timestamp ASC"
            )
            .bind(task_id)
            .fetch_all(pool)
            .await
        } else {
            sqlx::query_as::<_, RawAgentEvent>(
                "SELECT * FROM events WHERE task_id = $1 AND to_tsvector('english', process_name || ' ' || details) @@ websearch_to_tsquery('english', $2) ORDER BY timestamp ASC"
            )
            .bind(task_id)
            .bind(search_term)
            .fetch_all(pool)
            .await
        }
    } else {
        sqlx::query_as::<_, RawAgentEvent>(
            "SELECT * FROM events WHERE task_id = $1 ORDER BY timestamp ASC"
        )
        .bind(task_id)
        .fetch_all(pool)
        .await
    };

    match rows {
        Ok(events) => HttpResponse::Ok().json(events),
        Err(e) => {
            eprintln!("History fetch error: {}", e);
            HttpResponse::InternalServerError().body(e.to_string())
        }
    }
}


#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    env_logger::init();
    
    // Ensure uploads directory exists
    std::fs::create_dir_all("./uploads")?;
    std::fs::create_dir_all("./screenshots")?;

    let pool = init_db().await;
    
    // Initialize VirusTotal Cache Table
    if let Err(e) = virustotal::init_db(&pool).await {
        println!("[VIRUSTOTAL] Failed to initialize VT cache: {}", e);
    }
    
    let pool_data = web::Data::new(pool.clone());

    let proxmox_url = env::var("PROXMOX_URL").expect("PROXMOX_URL must be set");
    let proxmox_user = env::var("PROXMOX_USER").expect("PROXMOX_USER must be set");
    let proxmox_token_id = env::var("PROXMOX_TOKEN_ID").expect("PROXMOX_TOKEN_ID must be set");
    let proxmox_token_secret = env::var("PROXMOX_TOKEN_SECRET").expect("PROXMOX_TOKEN_SECRET must be set");

    let client = proxmox::ProxmoxClient::new(
        proxmox_url,
        proxmox_user,
        proxmox_token_id,
        proxmox_token_secret,
    );

    let broadcaster = Arc::new(stream::Broadcaster::new());
    let broadcaster_data = web::Data::new(broadcaster.clone());

    let progress_broadcaster = Arc::new(progress_stream::ProgressBroadcaster::new());
    let progress_broadcaster_data = web::Data::new(progress_broadcaster.clone());
    
    let agent_manager = Arc::new(AgentManager::new());
    let agent_manager_data = web::Data::new(agent_manager.clone());

    // AI Manager Initialization
    let gemini_api_key = env::var("GEMINI_API_KEY").unwrap_or_default();
    let ollama_url = env::var("OLLAMA_URL").unwrap_or_else(|_| "http://ollama:11434".to_string());
    let anthropic_key = env::var("ANTHROPIC_API_KEY").unwrap_or_default();
    let openai_key = env::var("OPENAI_API_KEY").unwrap_or_default();
    let copilot_token = env::var("COPILOT_TOKEN").unwrap_or_default();

    println!("[Main] Initializing AI Manager...");
    println!("[Main] OLLAMA_URL: {}", ollama_url);
    if !gemini_api_key.is_empty() { println!("[Main] Gemini API Key detected."); }
    if !anthropic_key.is_empty() { println!("[Main] Anthropic API Key detected."); }
    if !openai_key.is_empty() { println!("[Main] OpenAI API Key detected."); }
    
    let ai_manager = web::Data::new(AIManager::new(
        gemini_api_key, 
        ollama_url,
        anthropic_key,
        openai_key,
        copilot_token
    ));

    tokio::spawn(start_tcp_listener(broadcaster, agent_manager, pool));

    println!("Starting Hyper-Bridge server on 0.0.0.0:8080");

    use actix_cors::Cors;

    HttpServer::new(move || {
        let cors = Cors::permissive();

        App::new()
            .wrap(actix_web::middleware::Logger::default())
            .wrap(cors)
            .app_data(web::Data::new(client.clone()))
            .app_data(broadcaster_data.clone())
            .app_data(agent_manager_data.clone())
            .app_data(pool_data.clone())
            .app_data(ai_manager.clone()) // AI Manager
            .app_data(progress_broadcaster_data.clone())
            .service(health_check)
            .service(list_all_vms)
            .service(vm_control)
            .service(vm_revert)
            .service(vnc_proxy)
            .service(vnc_websocket)
            .service(spice_proxy)
            .service(spice_websocket)
            .service(terminate_process)
            .service(exec_url)
            .service(ai_insight_handler)
            .service(chat_handler)
            .service(list_tasks)
            .service(delete_task)
            .service(purge_all)
            .service(pivot_binary)
            .service(pivot_upload)
            .service(exec_binary)
            .service(submit_sample)
            .service(upload_screenshot)
            .service(list_screenshots)
            .service(ghidra_analyze)
            .service(ghidra_functions)
            .service(ghidra_decompile)
            .service(ghidra_ingest)
            .service(ghidra_ingest_complete)
            .service(ghidra_list_scripts)
            .service(ghidra_run_script)
            .service(get_ghidra_findings)
            .service(get_ai_report)
            .service(trigger_task_analysis)
            .service(get_telemetry_history)
            .service(update_task_verdict)
            .service(generate_pdf_report)
            .service(notes::add_note)
            .service(notes::get_notes)
            .service(notes::add_tag)
            .service(notes::get_tags)
            .service(actix_files::Files::new("/uploads", "./uploads").show_files_listing())
            .service(actix_files::Files::new("/screenshots", "./screenshots").show_files_listing())
            .service(set_ai_config)
            .service(get_ai_config)
            .service(set_ai_mode)
            .service(get_ai_mode_handler)
            .service(detox_api::detox_dashboard)
            .service(detox_api::detox_extensions)
            .service(detox_api::detox_extension_detail)
            .service(detox_api::detox_trigger_scan)
            .service(detox_api::detox_blocklist)
            .service(actix_files::Files::new("/vsix_archive", "/vsix_archive").show_files_listing())
            .route("/ws", web::get().to(stream::ws_route))
            .route("/ws/progress", web::get().to(progress_stream::ws_progress_route))
    })
    .bind(("0.0.0.0", 8080))?
    .run()
    .await
}
