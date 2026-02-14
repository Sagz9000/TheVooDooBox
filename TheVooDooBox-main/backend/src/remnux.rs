use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use std::env;
use reqwest::Client;
use std::path::Path;
use tokio::fs;

#[derive(Serialize, Deserialize, Debug)]
struct MCPCall {
    tool: String,
    arguments: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug)]
struct MCPResponse {
    content: Vec<MCPContent>,
}

#[derive(Serialize, Deserialize, Debug)]
struct MCPContent {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

/// Build an authenticated reqwest client with the Bearer token.
fn build_mcp_client() -> (Client, String, String) {
    let remnux_url = env::var("REMNUX_MCP_URL")
        .unwrap_or_else(|_| "http://10.10.20.50:8080/sse".to_string());
    let token = env::var("REMNUX_MCP_TOKEN")
        .unwrap_or_else(|_| "voodoo-secret-token".to_string());
    let shared_dir = env::var("SHARED_MALWARE_DIR")
        .unwrap_or_else(|_| "/mnt/voodoo_samples".to_string());

    // Strip /sse suffix for tool calls (we post to /mcp/tools/call)
    let base_url = remnux_url.trim_end_matches("/sse").to_string();

    println!("[REMNUX] MCP Base URL: {}, Shared Dir: {}", base_url, shared_dir);

    let client = Client::new();
    (client, base_url, shared_dir)
}

pub async fn trigger_scan(pool: Pool<Postgres>, task_id: String, filename: String, filepath: String) {
    println!("[REMNUX] Starting analysis for task: {} (file: {})", task_id, filename);

    // 1. Update status to "Staging"
    let _ = sqlx::query("UPDATE tasks SET remnux_status = 'Staging File' WHERE id = $1")
        .bind(&task_id)
        .execute(&pool)
        .await;

    let (client, base_url, shared_dir) = build_mcp_client();
    let token = env::var("REMNUX_MCP_TOKEN").unwrap_or_else(|_| "voodoo-secret-token".to_string());

    // 2. Copy file to shared NFS storage (instead of base64 upload)
    match stage_file_to_shared_storage(&shared_dir, &task_id, &filename, &filepath).await {
        Ok(remote_path) => {
            println!("[REMNUX] File staged to shared storage: {}", remote_path);
            let _ = sqlx::query("UPDATE tasks SET remnux_status = 'Analyzing' WHERE id = $1")
                .bind(&task_id)
                .execute(&pool)
                .await;

            // 3. Tell Remnux MCP to analyze the file at the shared path
            match call_analyze_tool(&client, &base_url, &token, &remote_path).await {
                Ok(report) => {
                    println!("[REMNUX] Analysis completed for task: {}", task_id);
                    let _ = sqlx::query("UPDATE tasks SET remnux_status = 'Completed', remnux_report = $1 WHERE id = $2")
                        .bind(serde_json::to_value(&report).unwrap_or(serde_json::json!({"error": "Failed to parse report"})))
                        .bind(&task_id)
                        .execute(&pool)
                        .await;
                },
                Err(e) => {
                    eprintln!("[REMNUX] Analysis failed: {}", e);
                    let _ = sqlx::query("UPDATE tasks SET remnux_status = 'Analysis Error' WHERE id = $1")
                        .bind(&task_id)
                        .execute(&pool)
                        .await;
                }
            }
        },
        Err(e) => {
            eprintln!("[REMNUX] File staging failed: {}", e);
            let _ = sqlx::query("UPDATE tasks SET remnux_status = 'Staging Error' WHERE id = $1")
                .bind(&task_id)
                .execute(&pool)
                .await;
        }
    }
}

/// Copy the sample into the shared NFS directory so Remnux can access it.
/// Returns the path as seen by the Remnux container (inside /home/remnux/files/).
async fn stage_file_to_shared_storage(
    shared_dir: &str,
    task_id: &str,
    filename: &str,
    filepath: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Create task-specific subdirectory: /mnt/voodoo_samples/<task_id>/
    let task_dir = format!("{}/{}", shared_dir, task_id);
    fs::create_dir_all(&task_dir).await?;

    // Copy the file into the shared directory
    let dest_path = format!("{}/{}", task_dir, filename);
    fs::copy(filepath, &dest_path).await?;

    println!("[REMNUX] Copied {} -> {}", filepath, dest_path);

    // Return the path as the Remnux container sees it
    // NFS host mount: /mnt/voodoo_samples -> Docker volume: /home/remnux/files
    let remote_path = format!("/home/remnux/files/{}/{}", task_id, filename);
    Ok(remote_path)
}

/// Call the Remnux MCP analyze_file tool with Bearer authentication.
async fn call_analyze_tool(
    client: &Client,
    base_url: &str,
    token: &str,
    file_path: &str,
) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
    let call = MCPCall {
        tool: "analyze_file".to_string(),
        arguments: serde_json::json!({
            "filename": file_path
        }),
    };

    let resp = client.post(&format!("{}/mcp/tools/call", base_url))
        .header("Authorization", format!("Bearer {}", token))
        .json(&call)
        .send()
        .await?;

    if resp.status().is_success() {
        let mcp_resp: MCPResponse = resp.json().await?;
        if let Some(content) = mcp_resp.content.first() {
            if let Some(text) = &content.text {
                // Return as JSON if possible, otherwise wrap raw text
                return Ok(serde_json::from_str(text).unwrap_or(serde_json::json!({ "raw_output": text })));
            }
        }
        Ok(serde_json::json!({ "status": "completed", "message": "No text output returned" }))
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("MCP Analysis error ({}): {}", status, body).into())
    }
}
