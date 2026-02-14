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
                    let error_msg = format!("Analysis Error: {}", e);
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
        let body = resp.text().await.unwrap_or_default();
        println!("[REMNUX] Raw Gateway Response ({} chars): {:.500}...", body.len(), body);

        // 1. Robust JSON Extraction: Find the first { and last }
        let json_text = if let (Some(start), Some(end)) = (body.find('{'), body.rfind('}')) {
            if end > start {
                &body[start..=end]
            } else {
                &body
            }
        } else {
            &body
        };

        let mut json: serde_json::Value = serde_json::from_str(json_text).map_err(|e| {
            format!("Failed to parse JSON response: {}. Body start: {:.100}", e, body)
        })?;

        // 2. MCP Unwrap: if it matches { "result": { "content": [ { "text": "..." } ] } }
        if let Some(result) = json.get("result") {
            if let Some(content) = result.get("content") {
                if let Some(first) = content.as_array().and_then(|a| a.get(0)) {
                    if let Some(inner_text) = first.get("text").and_then(|t| t.as_str()) {
                        println!("[REMNUX] Detected MCP-wrapped response, unwrapping inner JSON...");
                        // Try to parse the inner text as JSON
                        if let Ok(inner_json) = serde_json::from_str::<serde_json::Value>(inner_text) {
                            json = inner_json;
                        } else {
                            // If inner text isn't JSON, maybe it's the raw report text
                            json = serde_json::json!({ "raw_text_report": inner_text });
                        }
                    }
                }
            }
        }

        // 3. Status Normalization: Check if the JSON itself contains an error
        if let Some(error) = json.get("error") {
            return Err(format!("Gateway reported error in JSON: {}", error).into());
        }

        Ok(json)
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        eprintln!("[REMNUX] Gateway error ({}): {:.200}", status, body);
        Err(format!("Voodoo Gateway error ({}): {}", status, body).into())
    }
}
