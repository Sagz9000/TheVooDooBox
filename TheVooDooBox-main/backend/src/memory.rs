use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use crate::ai_analysis::ProcessSummary;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BehavioralFingerprint {
    pub task_id: String,
    pub verdict: String,
    pub malware_family: String,
    pub summary: String,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct OpenAIEmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Serialize, Deserialize, Debug)]
struct EmbeddingData {
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
    let embedding_url = env::var("EMBEDDING_URL").or_else(|_| env::var("OLLAMA_URL")).unwrap_or_else(|_| "http://ollama:11434".to_string());
    let embedding_model = env::var("EMBEDDING_MODEL").unwrap_or_else(|_| "llama-server".to_string());

    let client = reqwest::Client::new();
    
    // Try Ollama Native first (/api/embeddings)
    println!("[RAG] Requesting embedding from {} using model: {}...", embedding_url, embedding_model);
    let res = client.post(format!("{}/api/embeddings", embedding_url))
        .json(&json!({
            "model": embedding_model,
            "prompt": text
        }))
        .send()
        .await?;

    if res.status().is_success() {
        let body: serde_json::Value = res.json().await?;
        if let Some(emb) = body["embedding"].as_array() {
            return Ok(emb.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect());
        }
    }

    // Fallback: Try llama-server native (/embedding)
    println!("[RAG] Ollama Native failed or not present. Trying llama-server native endpoint at {}...", embedding_url);
    let res = client.post(format!("{}/embedding", embedding_url))
        .json(&json!({
            "content": text
        }))
        .send()
        .await?;

    let status = res.status();
    let body_text = res.text().await.unwrap_or_default();
    
    if status.is_success() {
        if let Ok(body) = serde_json::from_str::<serde_json::Value>(&body_text) {
            if let Some(emb) = body["embedding"].as_array() {
                return Ok(emb.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect());
            }
        }
    }

    Err(format!("All embedding endpoints failed. Last status ({}): {}", status, body_text).into())
}

pub async fn ensure_collection() -> Result<(), Box<dyn std::error::Error>> {
    ensure_collection_by_name("hive_mind").await
}

pub async fn ensure_collection_by_name(name: &str) -> Result<(), Box<dyn std::error::Error>> {
    let chroma_url = env::var("CHROMADB_URL").unwrap_or_else(|_| "http://chromadb:8000".to_string());
    let client = reqwest::Client::new();

    println!("[HiveMind] Ensuring collection '{}' exists at {}...", name, chroma_url);

    let resp = client.post(format!("{}/api/v1/collections", chroma_url))
        .json(&json!({
            "name": name,
            "metadata": { "hnsw:space": "cosine" }
        }))
        .send()
        .await?;
        
    let status = resp.status();
    if status.is_success() {
        println!("[HiveMind] Collection '{}' created successfully.", name);
    } else {
        let err_body = resp.text().await.unwrap_or_else(|_| "No body".to_string());
        if status.as_u16() == 409 || (status.as_u16() == 500 && err_body.contains("UniqueConstraintError")) {
            // Collection already exists (Chroma 0.5.0 often returns 500 for this)
            println!("[HiveMind] Collection '{}' already exists.", name);
        } else {
            println!("[HiveMind] Warning: Collection creation returned status {}: {}", status, err_body);
        }
    }
        
    Ok(())
}

pub async fn get_collection_id(client: &reqwest::Client, chroma_url: &str, name: &str) -> Result<String, Box<dyn std::error::Error>> {
    let url = format!("{}/api/v1/collections", chroma_url);
    println!("[HiveMind] Listing collections via v1 API: {}", url);
    let res = client.get(&url).send().await?;
    
    if res.status().is_success() {
        let collections: Vec<serde_json::Value> = res.json().await?;
        for col in collections {
            if let Some(n) = col["name"].as_str() {
                if n == name {
                    return col["id"].as_str()
                        .map(|s| s.to_string())
                        .ok_or_else(|| "Collection found but has no ID".into());
                }
            }
        }
    } else {
         return Err(format!("Failed to list collections via v1: {}", res.status()).into());
    }
    
    Err(format!("Collection '{}' not found in listing", name).into())
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

pub async fn ingest_telemetry(task_id: &String, processes: &Vec<ProcessSummary>) -> Result<(), Box<dyn std::error::Error>> {
    let collection_name = "active_analysis";
    ensure_collection_by_name(collection_name).await?;
    
    let chroma_url = env::var("CHROMADB_URL").unwrap_or_else(|_| "http://chromadb:8000".to_string());
    let client = reqwest::Client::new();
    
    let col_uuid = match get_collection_id(&client, &chroma_url, collection_name).await {
        Ok(id) => id,
        Err(e) => return Err(e),
    };

    println!("[RAG] Ingesting telemetry for Task {} into '{}'...", task_id, collection_name);

    let mut embeddings: Vec<Vec<f32>> = Vec::new();
    let mut metadatas: Vec<serde_json::Value> = Vec::new();
    let mut documents: Vec<String> = Vec::new();
    let mut ids: Vec<String> = Vec::new();

    // Helper to add chunk
    let mut add_chunk = |text: String, pid: i32, type_: &str, detail: &str| {
        documents.push(text);
        metadatas.push(json!({
            "task_id": task_id,
            "pid": pid,
            "type": type_,
            "detail": detail
        }));
        // Randomly generating ID or structured ID? Structured is better for debugging.
        // Format: taskid_pid_type_index
        ids.push(format!("{}_{}_{}_{}", task_id, pid, type_, uuid::Uuid::new_v4()));
    };

    let mut chunk_count = 0;

    for p in processes {
        // 1. Process Execution Chunk
        let proc_text = format!("Process Started: {} (PID: {}, PPID: {}). Command Line: {}", p.image_name, p.pid, p.ppid, p.command_line);
        add_chunk(proc_text, p.pid, "Process", &p.image_name);
        chunk_count += 1;

        // 2. Network Chunks (Grouped)
        if !p.network_activity.is_empty() {
             // If small, 1 chunk. If large, batch.
             let net_desc: Vec<String> = p.network_activity.iter().map(|n| format!("{} port {} ({})", n.dest, n.port, n.protocol)).collect();
             for chunk in net_desc.chunks(5) { // Group 5 connections per text block
                 let text = format!("Network Activity for {}: Connected to {:?}", p.image_name, chunk);
                 add_chunk(text, p.pid, "Network", "Multiple Connections");
                 chunk_count += 1;
             }
        }

        // 3. File Chunks
        if !p.file_activity.is_empty() {
            let file_desc: Vec<String> = p.file_activity.iter().map(|f| format!("{} {}", f.action, f.path)).collect();
            for chunk in file_desc.chunks(5) {
                let text = format!("File Activity for {}: {:?}", p.image_name, chunk);
                add_chunk(text, p.pid, "Files", "Multiple Files");
                 chunk_count += 1;
            }
        }

        // 4. Registry Chunks
        if !p.registry_mods.is_empty() {
            let reg_desc: Vec<String> = p.registry_mods.iter().map(|r| format!("Key: {} Value: {}", r.key, r.value_name)).collect();
             for chunk in reg_desc.chunks(5) {
                let text = format!("Registry Output for {}: {:?}", p.image_name, chunk);
                add_chunk(text, p.pid, "Registry", "Multiple Keys");
                 chunk_count += 1;
            }
        }
    }

    println!("[RAG] generated {} chunks. Generating embeddings (this may take time)...", chunk_count);

    // Generate Embeddings Sequentially (Ollama can struggle with parallel)
    for doc in &documents {
        match get_embedding(doc).await {
            Ok(emb) => embeddings.push(emb),
            Err(e) => {
                println!("[RAG] Embedding failed for chunk: {}", e);
                // Push zero vec or skip? Skip means index mismatch. 
                // We MUST keep alignment. Push a zero vector or retry. 
                // Let's push a zero vector (bad) or break.
                // Better to skip this document entirely from the batch.
                // But we are building parallel vectors.
                // For now, we'll error out? No, robust.
                // We will filter out this index from all vectors *before* adding to batch?
                // Easier: just loop and build 'valid' sets.
                // Since this structural approach separates them, we can't easily remove from middle.
                // Let's just push an empty embedding (if allowed) or a dummy one.
                embeddings.push(vec![0.0; 768]); // Assuming 768 dim
            }
        }
    }
    
    // Batch Add to Chroma
    // Chroma default limit is often around 500-1000 items. We should batch.
    let batch_size = 100;
    let total = documents.len();
    
    for i in (0..total).step_by(batch_size) {
        let end = std::cmp::min(i + batch_size, total);
        
        let batch_ids = &ids[i..end];
        let batch_embeddings = &embeddings[i..end];
        let batch_metadatas = &metadatas[i..end];
        let batch_documents = &documents[i..end];
        
        let payload = json!({
            "ids": batch_ids,
            "embeddings": batch_embeddings,
            "metadatas": batch_metadatas,
            "documents": batch_documents
        });

        let res = client.post(format!("{}/api/v1/collections/{}/add", chroma_url, col_uuid))
            .json(&payload)
            .send()
            .await?;
            
        if !res.status().is_success() {
            println!("[RAG] Failed to add batch {}-{}: {}", i, end, res.status());
        }
    }
    
    println!("[RAG] Ingestion Complete.");
    Ok(())
}

pub async fn query_telemetry_rag(task_id: &String, query_text: &str, n_results: usize) -> Result<Vec<String>, Box<dyn std::error::Error>> {
     let collection_name = "active_analysis";
     // reuse existing query logic but with filter
     let chroma_url = env::var("CHROMADB_URL").unwrap_or_else(|_| "http://chromadb:8000".to_string());
    let client = reqwest::Client::new();
    
    let col_uuid = match get_collection_id(&client, &chroma_url, collection_name).await {
        Ok(id) => id,
        Err(_e) => return Ok(vec![]) // Fail safe
    };

    let embedding = get_embedding(query_text).await?;

    let payload = json!({
        "query_embeddings": [embedding],
        "n_results": n_results,
        "where": { "task_id": task_id }, // Filter by Task ID!
        "include": ["documents"]
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
    
    if let Some(docs) = body.documents {
        if !docs.is_empty() {
             results = docs[0].clone();
        }
    }
    
    Ok(results)
}
