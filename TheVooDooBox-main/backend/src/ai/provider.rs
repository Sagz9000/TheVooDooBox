use async_trait::async_trait;
use std::error::Error;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[async_trait]
pub trait AIProvider: Send + Sync {
    /// Asks the AI a question with the given history and system prompt.
    async fn ask(&self, history: Vec<ChatMessage>, system_prompt: String) -> Result<String, Box<dyn Error>>;
    
    /// Returns the name of the provider (e.g., "Gemini", "Ollama")
    fn name(&self) -> &str;
}
