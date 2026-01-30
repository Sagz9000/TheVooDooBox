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

    println!("[HiveMind] Ensuring collection 'hive_mind' exists at {}...", chroma_url);

    let resp = client.post(format!("{}/api/v2/collections", chroma_url))
        .json(&json!({
            "name": "hive_mind",
            "metadata": { "hnsw:space": "cosine" }
        }))
        .send()
        .await?;
        
    let status = resp.status();
    if status.is_success() {
        println!("[HiveMind] Collection created successfully.");
    } else if status.as_u16() == 409 {
        // 409 Conflict simply means it already exists
        println!("[HiveMind] Collection 'hive_mind' already exists.");
    } else {
        let err_body = resp.text().await.unwrap_or_else(|_| "No body".to_string());
        println!("[HiveMind] Warning: Collection creation returned status {}: {}", status, err_body);
        // We don't necessarily error here as the next GET might work if it exists.
    }
        
    Ok(())
}

pub async fn get_collection_id(client: &reqwest::Client, chroma_url: &str, name: &str) -> Result<String, Box<dyn std::error::Error>> {
    // Try v2 API first (Modern)
    let url_v2 = format!("{}/api/v2/collections", chroma_url);
    println!("[HiveMind] Listing collections via v2 API: {}", url_v2);
    let res_v2 = client.get(&url_v2).send().await?;

    if res_v2.status().is_success() {
        let collections: Vec<serde_json::Value> = res_v2.json().await?;
        for col in collections {
            if let Some(n) = col["name"].as_str() {
                if n == name {
                    return col["id"].as_str()
                        .map(|s| s.to_string())
                        .ok_or_else(|| "Collection found but has no ID".into());
                }
            }
        }
    } else if res_v2.status().as_u16() == 404 {
        // Fallback to v1 API (Legacy)
        println!("[HiveMind] v2 API not found (404). Falling back to v1 API...");
        let url_v1 = format!("{}/api/v1/collections", chroma_url);
        let res_v1 = client.get(&url_v1).send().await?;
        
        if res_v1.status().is_success() {
            let collections: Vec<serde_json::Value> = res_v1.json().await?;
            for col in collections {
                if let Some(n) = col["name"].as_str() {
                    if n == name {
                        return col["id"].as_str()
                            .map(|s| s.to_string())
                            .ok_or_else(|| "Collection found in v1 but has no ID".into());
                    }
                }
            }
        } else {
             return Err(format!("Failed to list collections via v1 (Fallback): {}", res_v1.status()).into());
        }
    } else {
        return Err(format!("Failed to list collections via v2: {}", res_v2.status()).into());
    }
    
    // If we get here, listing worked but collection wasn't found.
    // Last ditch: Try to GET the specific collection by name creating a dummy "get or create" behavior?
    // Actually, ensure_collection should have created it. If strictly not found in list:
    Err(format!("Collection '{}' not found in listing (v2 or v1)", name).into())
}

pub async fn store_fingerprint(fingerprint: BehavioralFingerprint, text_representation: String) -> Result<(), Box<dyn std::error::Error>> {
    ensure_collection().await?; // Ensure it exists
    
    let chroma_url = env::var("CHROMADB_URL").unwrap_or_else(|_| "http://chromadb:8000".to_string());
    let collection_name = "hive_mind"; 
    
    let client = reqwest::Client::new();
    
    // Get Collection ID via listing (Name-to-UUID)
    let col_uuid = match get_collection_id(&client, &chroma_url, collection_name).await {
        Ok(id) => id,
        Err(e) => {
            println!("[HiveMind] Failed to resolve collection ID for '{}': {}", collection_name, e);
            return Err(e);
        }
    };

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

    client.post(format!("{}/api/v2/collections/{}/add", chroma_url, col_uuid))
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
    let collection_name = "hive_mind";
    
    // Get Collection ID via listing
    let col_uuid = match get_collection_id(&client, &chroma_url, collection_name).await {
        Ok(id) => id,
        Err(e) => {
            println!("[HiveMind] Query skipped: {}", e);
            return Ok(vec![]);
        }
    };

    let embedding = get_embedding(&current_text_representation).await?;

    let payload = json!({
        "query_embeddings": [embedding],
        "n_results": 3,
        "include": ["metadatas", "documents", "distances"]
    });

    let res = client.post(format!("{}/api/v2/collections/{}/query", chroma_url, col_uuid))
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
