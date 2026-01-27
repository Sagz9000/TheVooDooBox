use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres, Row};
use std::env;
use reqwest::Client;
use chrono::{DateTime, Utc};

// --- Data Structures ---

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VirusTotalData {
    pub hash: String,
    pub scanned_at: DateTime<Utc>,
    pub malicious_votes: i32,
    pub total_votes: i32,
    pub threat_label: String,
    pub family_labels: Vec<String>,
    pub behavior_tags: Vec<String>,
    pub sandbox_verdicts: Vec<String>,
}

#[derive(Deserialize, Debug)]
struct VTResponse {
    data: VTData,
}

#[derive(Deserialize, Debug)]
struct VTData {
    attributes: VTAttributes,
}

#[derive(Deserialize, Debug)]
struct VTAttributes {
    last_analysis_stats: VTStats,
    popular_threat_classification: Option<VTClassification>,
}

#[derive(Deserialize, Debug)]
struct VTStats {
    malicious: i32,
    undetected: i32,
    harmless: i32,
    suspicious: i32,
    timeout: i32,
}

#[derive(Deserialize, Debug)]
struct VTClassification {
    suggested_threat_label: Option<String>,
    #[allow(dead_code)]
    popular_threat_category: Vec<VTLabel>,
    popular_threat_name: Vec<VTLabel>,
}

#[derive(Deserialize, Debug)]
struct VTLabel {
    value: String,
    #[allow(dead_code)]
    count: i32,
}

// Behavior Summary Response
#[derive(Deserialize, Debug)]
struct VTBehaviorResponse {
    data: Vec<VTBehaviorItem>,
}

#[derive(Deserialize, Debug)]
struct VTBehaviorItem {
    attributes: VTBehaviorAttributes,
}

#[derive(Deserialize, Debug)]
struct VTBehaviorAttributes {
    tags: Option<Vec<String>>,
    verdicts: Option<Vec<String>>,
}


// --- Database Initialization ---

pub async fn init_db(pool: &Pool<Postgres>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS virustotal_cache (
            hash TEXT PRIMARY KEY,
            data JSONB NOT NULL,
            scanned_at TIMESTAMPTZ NOT NULL,
            malicious_votes INT NOT NULL,
            total_votes INT NOT NULL,
            threat_label TEXT,
            behavior_tags TEXT[] -- Array of strings
        )"
    )
    .execute(pool)
    .await?;
    
    println!("[VT] Database initialized (virustotal_cache).");
    Ok(())
}

// --- Core Logic ---

pub async fn get_cached_or_fetch(pool: &Pool<Postgres>, hash: &String) -> Option<VirusTotalData> {
    // 1. Check Cache
    if let Ok(row) = sqlx::query("SELECT data FROM virustotal_cache WHERE hash = $1")
        .bind(hash)
        .fetch_one(pool)
        .await 
    {
        println!("[VT] Cache hit for {}", hash);
        if let Ok(data) = serde_json::from_value::<VirusTotalData>(row.get("data")) {
            return Some(data);
        }
    }

    // 2. Fetch from API
    let api_key = env::var("VIRUSTOTAL_API_KEY").ok()?;
    if api_key.is_empty() || api_key == "placeholder" {
        println!("[VT] No API Key provided. Skipping lookup.");
        return None;
    }

    println!("[VT] Fetching fresh report for {}", hash);
    
    match fetch_full_report(hash, &api_key).await {
        Ok(vt_data) => {
            // 3. Cache Result
            let _ = sqlx::query(
                "INSERT INTO virustotal_cache (hash, data, scanned_at, malicious_votes, total_votes, threat_label, behavior_tags)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (hash) DO UPDATE SET
                 data = EXCLUDED.data,
                 scanned_at = EXCLUDED.scanned_at,
                 malicious_votes = EXCLUDED.malicious_votes,
                 total_votes = EXCLUDED.total_votes,
                 threat_label = EXCLUDED.threat_label,
                 behavior_tags = EXCLUDED.behavior_tags"
            )
            .bind(hash)
            .bind(serde_json::to_value(&vt_data).unwrap())
            .bind(vt_data.scanned_at)
            .bind(vt_data.malicious_votes)
            .bind(vt_data.total_votes)
            .bind(&vt_data.threat_label)
            .bind(&vt_data.behavior_tags)
            .execute(pool)
            .await;
            
            Some(vt_data)
        },
        Err(e) => {
            println!("[VT] API Error: {}", e);
            None
        }
    }
}

async fn fetch_full_report(hash: &str, api_key: &str) -> Result<VirusTotalData, Box<dyn std::error::Error>> {
    let client = Client::new();

    // A. Fetch Standard Report
    let report_url = format!("https://www.virustotal.com/api/v3/files/{}", hash);
    let resp = client.get(&report_url)
        .header("x-apikey", api_key)
        .send()
        .await?;
        
    if !resp.status().is_success() {
        return Err(format!("VT Report Status: {}", resp.status()).into());
    }
    
    let report_json: VTResponse = resp.json().await?;
    let stats = report_json.data.attributes.last_analysis_stats;
    let malicious = stats.malicious;
    let total = stats.malicious + stats.undetected + stats.harmless + stats.suspicious + stats.timeout;
    
    let mut threat_label = "Unknown".to_string();
    let mut family_labels = Vec::new();
    
    if let Some(classification) = report_json.data.attributes.popular_threat_classification {
        if let Some(label) = classification.suggested_threat_label {
            threat_label = label;
        }
        for item in classification.popular_threat_name {
            family_labels.push(item.value);
        }
    }

    // B. Fetch Behavior Summary
    // Note: Not all files have behavior summaries. We treat 404 as empty.
    let behavior_url = format!("https://www.virustotal.com/api/v3/files/{}/behaviours", hash);
    let b_resp = client.get(&behavior_url)
        .header("x-apikey", api_key)
        .send()
        .await?;

    let mut behavior_tags = Vec::new();
    let mut sandbox_verdicts = Vec::new();

    if b_resp.status().is_success() {
         if let Ok(b_json) = b_resp.json::<VTBehaviorResponse>().await {
             for item in b_json.data {
                 if let Some(tags) = item.attributes.tags {
                     behavior_tags.extend(tags);
                 }
                 if let Some(verdicts) = item.attributes.verdicts {
                     sandbox_verdicts.extend(verdicts);
                 }
             }
         }
    }
    
    // Deduplicate
    behavior_tags.sort();
    behavior_tags.dedup();
    sandbox_verdicts.sort();
    sandbox_verdicts.dedup();
    family_labels.sort();
    family_labels.dedup();

    Ok(VirusTotalData {
        hash: hash.to_string(),
        scanned_at: Utc::now(),
        malicious_votes: malicious,
        total_votes: total,
        threat_label,
        family_labels,
        behavior_tags,
        sandbox_verdicts,
    })
}
