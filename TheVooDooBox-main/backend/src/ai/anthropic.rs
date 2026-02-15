use crate::ai::provider::{AIProvider, ChatMessage};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use std::error::Error;

pub struct AnthropicProvider {
    api_key: String,
    model: String,
    client: Client,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: String) -> Self {
        let model = if model.is_empty() {
            "claude-3-5-sonnet-latest".to_string()
        } else {
            model
        };
        
        Self {
            api_key,
            model,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl AIProvider for AnthropicProvider {
    fn name(&self) -> &str {
        "Anthropic"
    }

    async fn ask(&self, history: Vec<ChatMessage>, system_prompt: String) -> Result<String, Box<dyn Error + Send + Sync>> {
        let url = "https://api.anthropic.com/v1/messages";

        let mut messages = Vec::new();
        for msg in history {
            // Anthropic roles: "user" | "assistant"
            let role = if msg.role == "model" { "assistant" } else { &msg.role };
            messages.push(json!({
                "role": role,
                "content": msg.content
            }));
        }

        let payload = json!({
            "model": self.model,
            "max_tokens": 8192,
            "system": system_prompt,
            "messages": messages
        });

        let resp = self.client.post(url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await?;
            return Err(format!("Anthropic API Error: {}", error_text).into());
        }

        let body: serde_json::Value = resp.json().await?;
        
        // Response format: { "content": [ { "type": "text", "text": "..." } ] }
        if let Some(content_arr) = body["content"].as_array() {
            if let Some(first_block) = content_arr.first() {
                if let Some(text) = first_block["text"].as_str() {
                    return Ok(text.to_string());
                }
            }
        }

        Err(format!("Failed to parse Anthropic response: {:?}", body).into())
    }
}
