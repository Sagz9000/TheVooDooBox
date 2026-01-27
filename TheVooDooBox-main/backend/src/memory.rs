use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BehavioralFingerprint {
    pub task_id: String,
    pub verdict: String,
    pub malware_family: String,
    pub summary: String,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct OllamaEmbeddingResponse {
    embedding: Vec<f32>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ChromaQueryResponse {
    ids: Vec<Vec<String>>,
    distances: Option<Vec<Vec<f32>>>,
    metadatas: Option<Vec<Vec<serde_json::Value>>>,
    documents: Option<Vec<Vec<String>>>,
}

pub async fn get_embedding(text: &str) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let ollama_url = env::var("OLLAMA_URL").unwrap_or_else(|_| "http://ollama:11434".to_string());
    let embedding_model = env::var("EMBEDDING_MODEL").unwrap_or_else(|_| "nomic-embed-text".to_string());

    let client = reqwest::Client::new();
    let res = client.post(format!("{}/api/embeddings", ollama_url))
        .json(&json!({
            "model": embedding_model,
            "prompt": text
        }))
        .send()
        .await?;

    if !res.status().is_success() {
        return Err(format!("Ollama embedding failed: {}", res.status()).into());
    }

    let body: OllamaEmbeddingResponse = res.json().await?;
    Ok(body.embedding)
}

pub async fn ensure_collection() -> Result<(), Box<dyn std::error::Error>> {
    let chroma_url = env::var("CHROMADB_URL").unwrap_or_else(|_| "http://chromadb:8000".to_string());
    let client = reqwest::Client::new();

    // Check availability (optional, or just try to create/get)
    // Create collection "hive_mind" if not exists
    let _ = client.post(format!("{}/api/v1/collections", chroma_url))
        .json(&json!({
            "name": "hive_mind",
            "metadata": { "hnsw:space": "cosine" }
        }))
        .send()
        .await?;
        
    Ok(())
}

pub async fn store_fingerprint(fingerprint: BehavioralFingerprint, text_representation: String) -> Result<(), Box<dyn std::error::Error>> {
    ensure_collection().await?; // Ensure it exists
    
    let chroma_url = env::var("CHROMADB_URL").unwrap_or_else(|_| "http://chromadb:8000".to_string());
    let collection_id = "hive_mind"; // Using name directly requires slightly different API or fetching ID first.
    // Chroma V1 API often uses ID. Let's get the ID for "hive_mind".
    
    let client = reqwest::Client::new();
    
    // Get Collection ID
    let col_res = client.get(format!("{}/api/v1/collections/{}", chroma_url, collection_id))
        .send()
        .await;

    // If get fails or 404, we assume ensure_collection handled it, but let's be robust.
    // Actually, simple V1 API allows adding by name in some clients, but raw API usually needs ID.
    // Let's stick to the simplest path: Get collection object to find ID.
    
    let col_obj: serde_json::Value = match col_res {
         Ok(r) => {
             if r.status().is_success() {
                 r.json().await?
             } else {
                 return Err("Failed to get Chroma collection".into());
             }
         },
         Err(_) => return Err("Chroma unavailable".into())
    };
    
    let col_uuid = col_obj["id"].as_str().unwrap();

    // Generate Embedding
    let embedding = get_embedding(&text_representation).await?;

    // Add to Chroma
    let payload = json!({
        "ids": [fingerprint.task_id],
        "embeddings": [embedding],
        "metadatas": [{
            "verdict": fingerprint.verdict,
            "family": fingerprint.malware_family,
            "tags": fingerprint.tags.join(",")
        }],
        "documents": [fingerprint.summary] // We store the summary as the document
    });

    client.post(format!("{}/api/v1/collections/{}/add", chroma_url, col_uuid))
        .json(&payload)
        .send()
        .await?;

    println!("[HiveMind] Stored fingerprint for task {}", fingerprint.task_id);
    Ok(())
}

pub async fn query_similar_behaviors(current_text_representation: String) -> Result<Vec<BehavioralFingerprint>, Box<dyn std::error::Error>> {
    ensure_collection().await?;
    
    let chroma_url = env::var("CHROMADB_URL").unwrap_or_else(|_| "http://chromadb:8000".to_string());
    let client = reqwest::Client::new();
    
    // Get Collection ID (Cached ideally, but fetching for simplicity)
    let col_res = client.get(format!("{}/api/v1/collections/hive_mind", chroma_url))
        .send()
        .await?;
        
    if !col_res.status().is_success() {
        return Ok(vec![]); // No memory yet
    }
    
    let col_obj: serde_json::Value = col_res.json().await?;
    let col_uuid = col_obj["id"].as_str().unwrap();

    let embedding = get_embedding(&current_text_representation).await?;

    let payload = json!({
        "query_embeddings": [embedding],
        "n_results": 3,
        "include": ["metadatas", "documents", "distances"]
    });

    let res = client.post(format!("{}/api/v1/collections/{}/query", chroma_url, col_uuid))
        .json(&payload)
        .send()
        .await?;

    if !res.status().is_success() {
        return Err(format!("Chroma query failed: {}", res.status()).into());
    }

    let body: ChromaQueryResponse = res.json().await?;
    let mut results = Vec::new();

    let ids = body.ids;
    if let (Some(metadatas), Some(documents)) = (body.metadatas, body.documents) {
        if !ids.is_empty() && !ids[0].is_empty() {
             for i in 0..ids[0].len() {
                 let id = &ids[0][i];
                 let meta = &metadatas[0][i];
                 let doc = &documents[0][i];
                 
                 let verdict = meta.get("verdict").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
                 let family = meta.get("family").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string();
                 let tags_str = meta.get("tags").and_then(|v| v.as_str()).unwrap_or("");
                 let tags = tags_str.split(',').map(|s| s.to_string()).collect();

                 results.push(BehavioralFingerprint {
                     task_id: id.clone(),
                     verdict,
                     malware_family: family,
                     summary: doc.clone(),
                     tags
                 });
             }
        }
    }

    Ok(results)
}
