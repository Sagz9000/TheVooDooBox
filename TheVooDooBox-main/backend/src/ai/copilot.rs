use crate::ai::provider::{AIProvider, ChatMessage};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use std::error::Error;

pub struct CopilotProvider {
    token: String,
    model: String,
    client: Client,
}

impl CopilotProvider {
    pub fn new(token: String, model: String) -> Self {
        let model = if model.is_empty() {
            "gpt-4".to_string() // Copilot usually maps to gpt-4 or similar internally
        } else {
            model
        };
        
        Self {
            token,
            model,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl AIProvider for CopilotProvider {
    fn name(&self) -> &str {
        "Copilot"
    }

    async fn ask(&self, history: Vec<ChatMessage>, system_prompt: String) -> Result<String, Box<dyn Error + Send + Sync>> {
        // Copilot API (GitHub Models) is similar to OpenAI but with different auth/endpoint
        // Note: As of late 2024/2025, GitHub Models endpoint is likely: 
        // https://models.github.ai/inference/chat/completions (or similar based on specific integration)
        // For now, we will assume standard OpenAI compatibility layer provided by Copilot proxy if available,
        // or a specific endpoint. 
        // 
        // Placeholder for now: We'll use the common OpenAI-compatible endpoint structure but with GitHub Headers.
        let url = "https://api.githubcopilot.com/chat/completions"; 

        let mut messages = Vec::new();
        if !system_prompt.is_empty() {
             messages.push(json!({
                "role": "system",
                "content": system_prompt
            }));
        }

        for msg in history {
            let role = if msg.role == "model" { "assistant" } else { &msg.role };
            messages.push(json!({
                "role": role,
                "content": msg.content
            }));
        }

        let payload = json!({
            "model": self.model,
            "messages": messages,
            "temperature": 0.1
        });

        let resp = self.client.post(url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("X-GitHub-Api-Version", "2023-07-07")
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await?;
            return Err(format!("Copilot API Error: {}", error_text).into());
        }

        let body: serde_json::Value = resp.json().await?;
        
        if let Some(choices) = body["choices"].as_array() {
            if let Some(first_choice) = choices.first() {
                if let Some(content) = first_choice["message"]["content"].as_str() {
                    return Ok(content.to_string());
                }
            }
        }

        Err(format!("Failed to parse Copilot response: {:?}", body).into())
    }
}
