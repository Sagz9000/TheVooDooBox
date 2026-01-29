use crate::ai::provider::AIProvider;
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
            model: "gemini-1.5-pro".to_string(),
            client: Client::new(),
        }
    }
}

#[async_trait]
impl AIProvider for GeminiProvider {
    fn name(&self) -> &str {
        "Gemini"
    }

    async fn ask(&self, prompt: &str, context: &str) -> Result<String, Box<dyn Error>> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            self.model, self.api_key
        );

        // Construct the prompt with context injection
        let full_prompt = format!(
            "SYSTEM CONTEXT (Lab State):\n{}\n\nUSER QUESTION:\n{}",
            context, prompt
        );

        let payload = json!({
            "contents": [{
                "parts": [{
                    "text": full_prompt
                }]
            }]
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
        
        // Extract text from the response structure
        // candidates[0].content.parts[0].text
        let text = body["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .ok_or("Failed to parse Gemini response text")?
            .to_string();

        Ok(text)
    }
}
