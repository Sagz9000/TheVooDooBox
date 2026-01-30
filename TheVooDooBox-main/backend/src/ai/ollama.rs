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
            client: Client::new(),
        }
    }
}

#[async_trait]
impl AIProvider for OllamaProvider {
    fn name(&self) -> &str {
        "Ollama"
    }

    async fn ask(&self, history: Vec<ChatMessage>, system_prompt: String) -> Result<String, Box<dyn Error>> {
        let url = format!("{}/api/chat", self.base_url);

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

        // Standard Ollama Chat API payload
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
            return Err(format!("Ollama API Error: {}", error_text).into());
        }

        let body: serde_json::Value = resp.json().await?;
        
        let response_text = body["message"]["content"]
            .as_str()
            .ok_or("Failed to parse Ollama response")?
            .to_string();

        Ok(response_text)
    }
}
