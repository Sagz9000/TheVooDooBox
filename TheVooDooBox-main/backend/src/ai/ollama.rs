use crate::ai::provider::AIProvider;
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

    async fn ask(&self, prompt: &str, context: &str) -> Result<String, Box<dyn Error>> {
        let url = format!("{}/api/generate", self.base_url);

        let full_prompt = format!(
            "[CONTEXT]\n{}\n\n[USER]\n{}",
            context, prompt
        );

        // Standard Ollama API payload
        let payload = json!({
            "model": self.model,
            "prompt": full_prompt,
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
        
        let response_text = body["response"]
            .as_str()
            .ok_or("Failed to parse Ollama response")?
            .to_string();

        Ok(response_text)
    }
}
