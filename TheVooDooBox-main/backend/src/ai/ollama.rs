use crate::ai::provider::{AIProvider, ChatMessage};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use std::error::Error;

pub struct OllamaProvider {
    base_url: String, // e.g., "http://localhost:11434"
    model: String,
    client: Client,
}

impl OllamaProvider {
    pub fn new(base_url: String, model: String) -> Self {
        // Ensure base_url doesn't end with slash + route, just the host
        let clean_url = base_url.trim_end_matches('/').to_string();
        
        Self {
            base_url: clean_url,
            model,
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
        }
    }
}

#[async_trait]
impl AIProvider for OllamaProvider {
    fn name(&self) -> &str {
        "Ollama"
    }

    async fn ask(&self, history: Vec<ChatMessage>, system_prompt: String) -> Result<String, Box<dyn Error + Send + Sync>> {
        let url = format!("{}/v1/chat/completions", self.base_url);
        println!("[OLLAMA] Sending request to: {} (Model: {})", url, self.model);

        let mut messages = Vec::new();

        // System Prompt
        if !system_prompt.is_empty() {
            messages.push(json!({
                "role": "system",
                "content": system_prompt
            }));
        }

        // History
        for msg in history {
            messages.push(json!({
                "role": msg.role,
                "content": msg.content
            }));
        }

        // OpenAI-compatible Chat API payload (used by llama-server)
        let payload = json!({
            "model": self.model,
            "messages": messages,
            "stream": false
        });

        let resp = self.client.post(&url)
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await?;
            return Err(format!("Llama Server API Error: {}", error_text).into());
        }

        let body: serde_json::Value = resp.json().await?;
        
        let response_text = body["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("Failed to parse Llama Server response")?
            .to_string();

        Ok(response_text)
    }
}
