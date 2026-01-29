use async_trait::async_trait;
use std::error::Error;

#[async_trait]
pub trait AIProvider: Send + Sync {
    /// Asks the AI a question with the given context.
    async fn ask(&self, prompt: &str, context: &str) -> Result<String, Box<dyn Error>>;
    
    /// Returns the name of the provider (e.g., "Gemini", "Ollama")
    fn name(&self) -> &str;
}
