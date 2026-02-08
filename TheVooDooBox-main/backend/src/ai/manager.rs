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

#[derive(Clone)]
pub struct AIManager {
    provider: Arc<RwLock<Box<dyn AIProvider>>>,
    gemini_key: Arc<RwLock<String>>,
    ollama_url: Arc<RwLock<String>>,
}

impl AIManager {
    pub fn new(gemini_key: String, ollama_url: String) -> Self {
        let provider: Box<dyn AIProvider> = if !gemini_key.is_empty() {
            Box::new(GeminiProvider::new(gemini_key.clone()))
        } else {
            Box::new(OllamaProvider::new(ollama_url.clone(), "llama-server".to_string()))
        };

        Self {
            provider: Arc::new(RwLock::new(provider)),
            gemini_key: Arc::new(RwLock::new(gemini_key)),
            ollama_url: Arc::new(RwLock::new(ollama_url)),
        }
    }

    pub async fn switch_provider(
        &self, 
        provider_type: ProviderType, 
        gemini_key: Option<String>, 
        ollama_url: Option<String>,
        ollama_model: Option<String>
    ) {
        if let Some(key) = gemini_key {
            let mut g_key = self.gemini_key.write().await;
            *g_key = key;
        }
        if let Some(url) = ollama_url {
            let mut o_url = self.ollama_url.write().await;
            *o_url = url;
        }
        
        let mut provider_lock = self.provider.write().await;
        match provider_type {
            ProviderType::Gemini => {
                let g_key = self.gemini_key.read().await;
                if !g_key.is_empty() {
                    *provider_lock = Box::new(GeminiProvider::new(g_key.clone()));
                }
            }
            ProviderType::Ollama => {
                let o_url = self.ollama_url.read().await;
                let model = ollama_model.unwrap_or_else(|| "llama-server".to_string());
                *provider_lock = Box::new(OllamaProvider::new(o_url.clone(), model));
            }
        }
    }

    pub async fn get_current_provider_name(&self) -> String {
        let provider = self.provider.read().await;
        provider.name().to_string()
    }

    pub async fn ask(&self, history: Vec<crate::ai::provider::ChatMessage>, system_prompt: String) -> Result<String, Box<dyn std::error::Error>> {
        let provider = self.provider.read().await;
        provider.ask(history, system_prompt).await
    }
}
