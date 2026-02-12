use crate::ai::provider::{AIProvider, ChatMessage};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use std::error::Error;

pub struct GeminiProvider {
    api_key: String,
    model: String,
    client: Client,
}

impl GeminiProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            model: "gemini-3-flash-preview".to_string(), // User requested specific preview model
            client: Client::new(),
        }
    }
}

#[async_trait]
impl AIProvider for GeminiProvider {
    fn name(&self) -> &str {
        "Gemini"
    }

    async fn ask(&self, history: Vec<ChatMessage>, system_prompt: String) -> Result<String, Box<dyn Error + Send + Sync>> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            self.model, self.api_key
        );

        let mut contents = Vec::new();

        if !system_prompt.is_empty() {
             contents.push(json!({
                "role": "user",
                "parts": [{
                    "text": format!("SYSTEM INSTRUCTIONS:\n{}\n\nPlease strictly follow these instructions for the following conversation.", system_prompt)
                }]
            }));
             contents.push(json!({
                "role": "model",
                "parts": [{
                    "text": "Understood. I will act as the VooDooBox Intelligence Core and follow all forensic accuracy and security protocols."
                }]
            }));
        }

        for msg in history {
            let role = if msg.role == "assistant" || msg.role == "model" { "model" } else { "user" };
            contents.push(json!({
                "role": role,
                "parts": [{ "text": msg.content }]
            }));
        }

        let payload = json!({
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": 65536
            }
        });

        let resp = self.client.post(&url)
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await?;
            return Err(format!("Gemini API Error: {}", error_text).into());
        }

        let body: serde_json::Value = resp.json().await?;
        let text = body["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .ok_or("Failed to parse Gemini response text")?
            .to_string();

        Ok(text)
    }
}
