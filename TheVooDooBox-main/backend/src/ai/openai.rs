use crate::ai::provider::{AIProvider, ChatMessage};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use std::error::Error;

pub struct OpenAIProvider {
    api_key: String,
    model: String,
    client: Client,
}

impl OpenAIProvider {
    pub fn new(api_key: String, model: String) -> Self {
        let model = if model.is_empty() {
            "gpt-4o".to_string()
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
impl AIProvider for OpenAIProvider {
    fn name(&self) -> &str {
        "OpenAI"
    }

    async fn ask(&self, history: Vec<ChatMessage>, system_prompt: String) -> Result<String, Box<dyn Error + Send + Sync>> {
        let url = "https://api.openai.com/v1/chat/completions";

        let mut messages = Vec::new();
        
        // System prompt is a distinct message in OpenAI API
        if !system_prompt.is_empty() {
             messages.push(json!({
                "role": "system",
                "content": system_prompt
            }));
        }

        for msg in history {
            // OpenAI roles: "system" | "user" | "assistant"
            let role = if msg.role == "model" { "assistant" } else { &msg.role };
            messages.push(json!({
                "role": role,
                "content": msg.content
            }));
        }

        let payload = json!({
            "model": self.model,
            "messages": messages,
            "max_tokens": 4096, 
            "temperature": 0.7
        });

        let resp = self.client.post(url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await?;
            return Err(format!("OpenAI API Error: {}", error_text).into());
        }

        let body: serde_json::Value = resp.json().await?;
        
        // Response format: { "choices": [ { "message": { "content": "..." } } ] }
        if let Some(choices) = body["choices"].as_array() {
            if let Some(first_choice) = choices.first() {
                if let Some(content) = first_choice["message"]["content"].as_str() {
                    return Ok(content.to_string());
                }
            }
        }

        Err(format!("Failed to parse OpenAI response: {:?}", body).into())
    }
}
