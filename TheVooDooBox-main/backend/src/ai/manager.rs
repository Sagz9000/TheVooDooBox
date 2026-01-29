use crate::ai::provider::AIProvider;
use crate::ai::gemini::GeminiProvider;
use crate::ai::ollama::OllamaProvider;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub enum ProviderType {
    Gemini,
    Ollama,
}

pub struct AIManager {
    provider: Arc<RwLock<Box<dyn AIProvider>>>,
    gemini_key: String,
    ollama_url: String,
}

impl AIManager {
    pub fn new(gemini_key: String, ollama_url: String) -> Self {
        // Default to Gemini if key exists, else Ollama
        let provider: Box<dyn AIProvider> = if !gemini_key.is_empty() {
            Box::new(GeminiProvider::new(gemini_key.clone()))
        } else {
            Box::new(OllamaProvider::new(ollama_url.clone(), "llama3".to_string()))
        };

        Self {
            provider: Arc::new(RwLock::new(provider)),
            gemini_key,
            ollama_url,
        }
    }

    pub async fn switch_provider(&self, provider_type: ProviderType) {
        let mut provider_lock = self.provider.write().await;
        match provider_type {
            ProviderType::Gemini => {
                if !self.gemini_key.is_empty() {
                    *provider_lock = Box::new(GeminiProvider::new(self.gemini_key.clone()));
                }
            }
            ProviderType::Ollama => {
                *provider_lock = Box::new(OllamaProvider::new(self.ollama_url.clone(), "llama3".to_string()));
            }
        }
    }

    pub async fn get_current_provider_name(&self) -> String {
        let provider = self.provider.read().await;
        provider.name().to_string()
    }

    pub async fn ask(&self, prompt: &str, context: &str) -> Result<String, Box<dyn std::error::Error>> {
        let provider = self.provider.read().await;
        provider.ask(prompt, context).await
    }
}
