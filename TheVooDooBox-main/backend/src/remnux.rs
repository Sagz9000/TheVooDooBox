use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use std::env;
use reqwest::Client;

use tokio::fs;

#[derive(Serialize, Deserialize, Debug)]
struct ScanRequest {
    file: String,
}

/// Build an authenticated reqwest client. 
/// NOTE: The Voodoo Gateway handles MCP state internally.
fn build_mcp_client() -> (Client, String, String) {
    let remnux_url = env::var("REMNUX_MCP_URL")
        .unwrap_or_else(|_| "http://192.168.50.199:8090".to_string());
    let shared_dir = env::var("SHARED_MALWARE_DIR")
        .unwrap_or_else(|_| "/mnt/voodoo_samples".to_string());

    // URL should be the base gateway URL (e.g., http://192.168.50.199:8090)
    let base_url = remnux_url.trim_end_matches("/sse").to_string();

    println!("[REMNUX] Config - URL: {}, Shared Dir: {}", base_url, shared_dir);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // Analysis can take a while
        .build()
        .unwrap_or_else(|_| Client::new());
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

    // 2. Copy file to shared NFS storage
    match stage_file_to_shared_storage(&shared_dir, &task_id, &filename, &filepath).await {
        Ok(remote_path) => {
            println!("[REMNUX] File staged to shared storage: {}", remote_path);
            let _ = sqlx::query("UPDATE tasks SET remnux_status = 'Analyzing' WHERE id = $1")
                .bind(&task_id)
                .execute(&pool)
                .await;

            // 3. Tell Voodoo Gateway to analyze the file
            match call_analyze_tool(&client, &base_url, &remote_path).await {
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
async fn stage_file_to_shared_storage(
    shared_dir: &str,
    task_id: &str,
    filename: &str,
    filepath: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let task_dir = format!("{}/{}", shared_dir, task_id);
    fs::create_dir_all(&task_dir).await?;

    let dest_path = format!("{}/{}", task_dir, filename);
    match fs::copy(filepath, &dest_path).await {
        Ok(_) => println!("[REMNUX] Successfully copied to {}", dest_path),
        Err(e) => {
            eprintln!("[REMNUX] ERROR copying to shared storage: {}", e);
            return Err(e.into());
        }
    }

    // Return the path as the Remnux container sees it
    let remote_path = format!("/home/remnux/files/{}/{}", task_id, filename);
    Ok(remote_path)
}

/// Call the Voodoo Gateway analyze endpoint.
async fn call_analyze_tool(
    client: &Client,
    base_url: &str,
    file_path: &str,
) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
    let req = ScanRequest {
        file: file_path.to_string(),
    };

    let resp = client.post(&format!("{}/analyze", base_url))
        .json(&req)
        .send()
        .await?;

    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await?;
        Ok(json)
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("Voodoo Gateway error ({}): {}", status, body).into())
    }
}
