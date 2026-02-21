// ─────────────────────────────────────────────────────────────────────────────
// ExtensionDetox API — Actix-Web Endpoints
// ─────────────────────────────────────────────────────────────────────────────
// Serves the React frontend with extension triage data from the shared
// PostgreSQL database. Also proxies scan/scrape requests to the Python
// detox-bouncer sidecar container.

use actix_web::{get, post, web, HttpResponse};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Pool, Postgres};
use std::sync::Arc;
use chrono::Utc;

use crate::progress_stream::ProgressBroadcaster;
use crate::{orchestrate_sandbox, AgentManager, AIManager};

// ── Data Types ──────────────────────────────────────────────────────────────

#[derive(Serialize, FromRow)]
pub struct DetoxDashboardStats {
    pub total_extensions: i64,
    pub clean: i64,
    pub flagged: i64,
    pub pending: i64,
    pub avg_risk_score: f64,
    pub blocklist_count: i64,
}

#[derive(Serialize, FromRow)]
pub struct DetoxExtensionRow {
    pub id: i32,
    pub extension_id: String,
    pub version: String,
    pub display_name: Option<String>,
    pub short_desc: Option<String>,
    pub install_count: Option<i32>,
    pub scan_state: Option<String>,
    pub latest_state: Option<String>,
    pub risk_score: Option<f64>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize, FromRow)]
pub struct DetoxScanHistoryRow {
    pub id: i32,
    pub scan_type: Option<String>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub risk_score: Option<f64>,
    pub composite_score: Option<f64>,
    pub findings_json: Option<serde_json::Value>,
    pub raw_ai_response: Option<String>,
}

#[derive(Serialize)]
pub struct DetoxExtensionDetail {
    pub extension: DetoxExtensionRow,
    pub scans: Vec<DetoxScanHistoryRow>,
}

#[derive(Deserialize)]
pub struct ExtensionQuery {
    pub state: Option<String>,
}

// ── Dashboard Stats ─────────────────────────────────────────────────────────

#[get("/api/detox/dashboard")]
pub async fn detox_dashboard(pool: web::Data<Pool<Postgres>>) -> HttpResponse {
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM detox_extensions")
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or((0,));

    let clean: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM detox_extensions WHERE latest_state = 'clean'",
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or((0,));

    let flagged: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM detox_extensions WHERE latest_state = 'flagged'",
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or((0,));

    let pending: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM detox_extensions WHERE latest_state = 'pending'",
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or((0,));

    let avg_risk: (Option<f64>,) = sqlx::query_as(
        "SELECT AVG(risk_score) FROM detox_scan_history WHERE risk_score IS NOT NULL",
    )
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or((None,));

    let blocklist: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM detox_blocklist")
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or((0,));

    HttpResponse::Ok().json(DetoxDashboardStats {
        total_extensions: total.0,
        clean: clean.0,
        flagged: flagged.0,
        pending: pending.0,
        avg_risk_score: avg_risk.0.unwrap_or(0.0),
        blocklist_count: blocklist.0,
    })
}

// ── Extension List ──────────────────────────────────────────────────────────

#[get("/api/detox/extensions")]
pub async fn detox_extensions(
    pool: web::Data<Pool<Postgres>>,
    query: web::Query<ExtensionQuery>,
) -> HttpResponse {
    let rows = if let Some(ref state) = query.state {
        sqlx::query_as::<_, DetoxExtensionRow>(
            "SELECT id, extension_id, version, display_name, short_desc, install_count, \
             scan_state, latest_state, risk_score, updated_at \
             FROM detox_extensions WHERE latest_state = $1 \
             ORDER BY updated_at DESC LIMIT 200",
        )
        .bind(state)
        .fetch_all(pool.get_ref())
        .await
    } else {
        sqlx::query_as::<_, DetoxExtensionRow>(
            "SELECT id, extension_id, version, display_name, short_desc, install_count, \
             scan_state, latest_state, risk_score, updated_at \
             FROM detox_extensions ORDER BY updated_at DESC LIMIT 200",
        )
        .fetch_all(pool.get_ref())
        .await
    };

    match rows {
        Ok(extensions) => HttpResponse::Ok().json(extensions),
        Err(e) => {
            eprintln!("[DETOX-API] Extension list error: {}", e);
            HttpResponse::InternalServerError().body(e.to_string())
        }
    }
}

// ── Extension Detail ────────────────────────────────────────────────────────

#[get("/api/detox/extension/{id}")]
pub async fn detox_extension_detail(
    pool: web::Data<Pool<Postgres>>,
    path: web::Path<i32>,
) -> HttpResponse {
    let ext_id = path.into_inner();

    let ext = sqlx::query_as::<_, DetoxExtensionRow>(
        "SELECT id, extension_id, version, display_name, short_desc, install_count, \
         scan_state, latest_state, risk_score, updated_at \
         FROM detox_extensions WHERE id = $1",
    )
    .bind(ext_id)
    .fetch_optional(pool.get_ref())
    .await;

    match ext {
        Ok(Some(extension)) => {
            let scans = sqlx::query_as::<_, DetoxScanHistoryRow>(
                "SELECT id, scan_type, started_at, completed_at, risk_score, \
                 composite_score, findings_json, raw_ai_response \
                 FROM detox_scan_history WHERE extension_db_id = $1 \
                 ORDER BY started_at DESC",
            )
            .bind(ext_id)
            .fetch_all(pool.get_ref())
            .await
            .unwrap_or_default();

            HttpResponse::Ok().json(DetoxExtensionDetail { extension, scans })
        }
        Ok(None) => HttpResponse::NotFound().body("Extension not found"),
        Err(e) => {
            eprintln!("[DETOX-API] Extension detail error: {}", e);
            HttpResponse::InternalServerError().body(e.to_string())
        }
    }
}

// ── Trigger Scan (proxy to bouncer) ─────────────────────────────────────────

#[derive(Deserialize)]
pub struct ScanTriggerRequest {
    pub extension_id: String,
    pub version: Option<String>,
}

#[post("/api/detox/scan")]
pub async fn detox_trigger_scan(body: web::Json<ScanTriggerRequest>) -> HttpResponse {
    let bouncer_url = std::env::var("DETOX_BOUNCER_URL")
        .unwrap_or_else(|_| "http://detox-bouncer:8000".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let scan_body = serde_json::json!({
        "extension_id": body.extension_id,
        "version": body.version,
    });

    match client
        .post(format!("{}/scan", bouncer_url))
        .json(&scan_body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body_text = resp.text().await.unwrap_or_default();
            HttpResponse::build(actix_web::http::StatusCode::from_u16(status).unwrap_or(actix_web::http::StatusCode::INTERNAL_SERVER_ERROR))
                .content_type("application/json")
                .body(body_text)
        }
        Err(e) => {
            eprintln!("[DETOX-API] Bouncer proxy error: {}", e);
            HttpResponse::ServiceUnavailable().json(serde_json::json!({
                "error": format!("Bouncer unreachable: {}", e)
            }))
        }
    }
}

// ── Trigger Scrape (proxy to bouncer) ───────────────────────────────────────

#[post("/api/detox/scrape")]
pub async fn detox_trigger_scrape() -> HttpResponse {
    let bouncer_url = std::env::var("DETOX_BOUNCER_URL")
        .unwrap_or_else(|_| "http://detox-bouncer:8000".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // By default, bouncer expects JSON body for scrape requests (max_pages, sort_by). Empty obj falls back to defaults.
    match client
        .post(format!("{}/scrape", bouncer_url))
        .json(&serde_json::json!({}))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body_text = resp.text().await.unwrap_or_default();
            HttpResponse::build(actix_web::http::StatusCode::from_u16(status).unwrap_or(actix_web::http::StatusCode::INTERNAL_SERVER_ERROR))
                .content_type("application/json")
                .body(body_text)
        }
        Err(e) => {
            eprintln!("[DETOX-API] Bouncer scrape proxy error: {}", e);
            HttpResponse::ServiceUnavailable().json(serde_json::json!({
                "error": format!("Bouncer unreachable: {}", e)
            }))
        }
    }
}

// ── Blocklist ───────────────────────────────────────────────────────────────

#[get("/api/detox/blocklist")]
pub async fn detox_blocklist(pool: web::Data<Pool<Postgres>>) -> HttpResponse {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM detox_blocklist")
        .fetch_one(pool.get_ref())
        .await
        .unwrap_or((0,));

    HttpResponse::Ok().json(serde_json::json!({
        "total": count.0,
    }))
}

// ── Sandbox Submission ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct DetoxSandboxRequest {
    pub extension_id: String,
    pub version: String,
    pub vmid: Option<u64>,
    pub node: Option<String>,
    pub duration_minutes: Option<u64>,
    pub analysis_mode: Option<String>,
    pub ai_strategy: Option<String>,
}

#[post("/api/detox/sandbox")]
pub async fn detox_submit_sandbox(
    pool: web::Data<Pool<Postgres>>,
    manager: web::Data<Arc<AgentManager>>,
    ai_manager: web::Data<AIManager>,
    client: web::Data<crate::proxmox::ProxmoxClient>,
    progress: web::Data<Arc<ProgressBroadcaster>>,
    body: web::Json<DetoxSandboxRequest>,
) -> HttpResponse {
    let ext = match sqlx::query_as::<_, crate::detox_api::DetoxExtensionRow>(
        "SELECT * FROM detox_extensions WHERE extension_id = $1 AND version = $2"
    )
    .bind(&body.extension_id)
    .bind(&body.version)
    .fetch_optional(pool.get_ref())
    .await {
        Ok(Some(row)) => row,
        Ok(None) => return HttpResponse::NotFound().body("Extension/version not found in DB"),
        Err(e) => {
            let err_str = format!("DB Error: {}", e);
            return HttpResponse::InternalServerError().body(err_str);
        }
    };

    let filename = format!("{}_{}.vsix", body.extension_id, body.version);
    let vsix_dir = std::env::var("VSIX_ARCHIVE_DIR").unwrap_or_else(|_| "/vsix_archive".to_string());
    let filepath = format!("{}/{}", vsix_dir, filename);

    if !std::path::Path::new(&filepath).exists() {
        eprintln!("[DETOX-API] Warning: VSIX file {} not found on disk at {}, queueing anyway", filename, filepath);
    }

    let created_at = Utc::now().timestamp_millis();
    let task_id = created_at.to_string();

    let _ = sqlx::query(
        "INSERT INTO tasks (id, filename, original_filename, file_hash, status, created_at, sandbox_id, file_path) \
         VALUES ($1, $2, $3, '', 'Queued', $4, $5, $6)"
    )
    .bind(&task_id)
    .bind(&filename)
    .bind(&filename)
    .bind(created_at)
    .bind(body.vmid.map(|id| id.to_string()))
    .bind(&filepath)
    .execute(pool.get_ref())
    .await;

    let _ = sqlx::query(
        "UPDATE detox_extensions SET latest_state = 'detonating' WHERE id = $1"
    )
    .bind(ext.id)
    .execute(pool.get_ref())
    .await;

    let host_ip = std::env::var("HOST_IP").unwrap_or_else(|_| "192.168.50.11".to_string());
    let download_url = format!("http://{}:8080/vsix_archive/{}", host_ip, filename);

    let client_clone = client.get_ref().clone();
    let manager_clone = manager.get_ref().clone();
    let pool_clone = pool.get_ref().clone();
    let ai_manager_clone = ai_manager.get_ref().clone();
    let duration = body.duration_minutes.unwrap_or(5) * 60;
    let progress_clone = progress.get_ref().clone();
    let task_id_clone = task_id.clone();

    actix_web::rt::spawn(async move {
        orchestrate_sandbox(
            client_clone,
            manager_clone,
            pool_clone,
            ai_manager_clone,
            task_id_clone,
            download_url,
            filename,
            duration,
            body.vmid,
            body.node.clone(),
            false,
            "vsix".to_string(),
            progress_clone,
        ).await;
    });

    HttpResponse::Ok().json(serde_json::json!({
        "status": "queued",
        "message": "Extension added to sandbox queue",
        "task_id": task_id
    }))
}

// ── Delete Extension ────────────────────────────────────────────────────────

#[delete("/api/detox/extension/{id}")]
pub async fn detox_delete_extension(
    path: web::Path<i32>,
) -> HttpResponse {
    let ext_id = path.into_inner();
    
    let bouncer_url = std::env::var("DETOX_BOUNCER_URL")
        .unwrap_or_else(|_| "http://detox-bouncer:8000".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    match client
        .delete(format!("{}/purge/{}", bouncer_url, ext_id))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body_text = resp.text().await.unwrap_or_default();
            HttpResponse::build(actix_web::http::StatusCode::from_u16(status).unwrap_or(actix_web::http::StatusCode::INTERNAL_SERVER_ERROR))
                .content_type("application/json")
                .body(body_text)
        }
        Err(e) => {
            eprintln!("[DETOX-API] Bouncer purge proxy error: {}", e);
            HttpResponse::ServiceUnavailable().json(serde_json::json!({
                "error": format!("Bouncer unreachable: {}", e)
            }))
        }
    }
}

