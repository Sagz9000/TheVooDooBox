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
        .timeout(std::time::Duration::from_secs(600)) // Analysis can take a while (increased to 10m)
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

            // 3. Tell Voodoo Gateway to analyze the file via SSE Stream
            match call_analyze_stream(&pool, &client, &base_url, &remote_path, &task_id).await {
                Ok(_) => {
                    println!("[REMNUX] Streaming analysis completed for task: {}", task_id);
                    let _ = sqlx::query("UPDATE tasks SET remnux_status = 'Completed' WHERE id = $1")
                        .bind(&task_id)
                        .execute(&pool)
                        .await;
                },
                Err(e) => {
                    eprintln!("[REMNUX] Analysis failed or interrupted: {}", e);
                    let error_msg = format!("Analysis Interrupted: {}", e);
                    let _ = sqlx::query("UPDATE tasks SET remnux_status = $1 WHERE id = $2")
                        .bind(&error_msg)
                        .bind(&task_id)
                        .execute(&pool)
                        .await;
                }
            }
        },
        Err(e) => {
            eprintln!("[REMNUX] File staging failed: {}", e);
            let error_msg = format!("Staging Error: {}", e);
            let _ = sqlx::query("UPDATE tasks SET remnux_status = $1 WHERE id = $2")
                .bind(&error_msg)
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

/// Call the Voodoo Gateway analyze/stream endpoint.
async fn call_analyze_stream(
    pool: &Pool<Postgres>,
    client: &Client,
    base_url: &str,
    file_path: &str,
    task_id: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use futures::StreamExt;
    
    let req = ScanRequest {
        file: file_path.to_string(),
    };

    let mut resp = client.post(&format!("{}/analyze/stream", base_url))
        .json(&req)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Gateway stream error ({}): {}", status, body).into());
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => return Err(format!("Stream chunk error: {}", e).into()),
        };
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Simple SSE parsing: look for "data: " lines
        while let Some(pos) = buffer.find("\n\n") {
            let message = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            if message.starts_with("data: ") {
                let json_str = &message[6..];
                if let Ok(sse_data) = serde_json::from_str::<serde_json::Value>(json_str) {
                    let module = sse_data["module"].as_str().unwrap_or("unknown");
                    let data = &sse_data["data"];

                    println!("[REMNUX] Stream update for {}: module={}", task_id, module);

                    if module == "status" {
                        let status_text = data.as_str().unwrap_or("Analyzing");
                        let _ = sqlx::query("UPDATE tasks SET remnux_status = $1 WHERE id = $2")
                            .bind(status_text)
                            .bind(task_id)
                            .execute(pool)
                            .await;
                    } else if module == "error" {
                        return Err(data.as_str().unwrap_or("Unknown Gateway Error").into());
                    } else {
                        // Incremental update of the JSONB report
                        // We use jsonb_set to merge the new module data into the existing report
                        let _ = sqlx::query(
                            "UPDATE tasks SET remnux_report = COALESCE(remnux_report, '{}'::jsonb) || $1::jsonb WHERE id = $2"
                        )
                        .bind(serde_json::json!({ module: data }))
                        .bind(task_id)
                        .execute(pool)
                        .await;
                    }
                }
            }
        }
    }

    Ok(())
}
