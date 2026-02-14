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

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub enum AIMode {
    Hybrid,
    LocalOnly,
    CloudOnly,
}

impl AIMode {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "hybrid" => AIMode::Hybrid,
            "local" | "localonly" | "local_only" => AIMode::LocalOnly,
            "cloud" | "cloudonly" | "cloud_only" => AIMode::CloudOnly,
            _ => AIMode::Hybrid,
        }
    }

    pub fn to_str(&self) -> &'static str {
        match self {
            AIMode::Hybrid => "hybrid",
            AIMode::LocalOnly => "local_only",
            AIMode::CloudOnly => "cloud_only",
        }
    }
}

#[derive(Clone)]
pub struct AIManager {
    provider: Arc<RwLock<Box<dyn AIProvider>>>,
    gemini_key: Arc<RwLock<String>>,
    ollama_url: Arc<RwLock<String>>,
    ollama_model: Arc<RwLock<String>>,
    ai_mode: Arc<RwLock<AIMode>>,
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
            ollama_model: Arc::new(RwLock::new("llama-server".to_string())),
            ai_mode: Arc::new(RwLock::new(AIMode::Hybrid)),
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
        if let Some(ref model) = ollama_model {
            let mut o_model = self.ollama_model.write().await;
            *o_model = model.clone();
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

    // --- AI Mode ---
    pub async fn set_ai_mode(&self, mode: AIMode) {
        println!("[AI] Switching AI Mode to: {:?}", mode);
        let mut m = self.ai_mode.write().await;
        *m = mode;
    }

    pub async fn get_ai_mode(&self) -> AIMode {
        self.ai_mode.read().await.clone()
    }

    pub async fn get_current_provider_name(&self) -> String {
        let provider = self.provider.read().await;
        provider.name().to_string()
    }

    pub async fn ask(&self, history: Vec<crate::ai::provider::ChatMessage>, system_prompt: String) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let provider = self.provider.read().await;
        provider.ask(history, system_prompt).await
    }

    /// Ask using a specific provider, bypassing the active one.
    /// Used by the Hybrid pipeline to route Map→Local, Reduce→Cloud.
    async fn ask_provider(
        &self,
        target: &str, // "local" or "cloud"
        history: Vec<crate::ai::provider::ChatMessage>,
        system_prompt: String,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        match target {
            "cloud" => {
                let g_key = self.gemini_key.read().await;
                if g_key.is_empty() {
                    return Err("Gemini API key not configured. Cannot use Cloud provider.".into());
                }
                let cloud_provider = GeminiProvider::new(g_key.clone());
                cloud_provider.ask(history, system_prompt).await
            }
            _ => {
                // "local" - use Ollama
                let o_url = self.ollama_url.read().await;
                let o_model = self.ollama_model.read().await;
                let local_provider = OllamaProvider::new(o_url.clone(), o_model.clone());
                local_provider.ask(history, system_prompt).await
            }
        }
    }

    /// Mode-aware ask: routes to the correct provider based on AIMode.
    /// For Hybrid, this is equivalent to calling with either "local" or "cloud" directly.
    pub async fn ask_with_mode(
        &self,
        history: Vec<crate::ai::provider::ChatMessage>,
        system_prompt: String,
        mode: &AIMode,
        phase: &str, // "map" or "reduce"
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let target = match mode {
            AIMode::Hybrid => {
                match phase {
                    "map" => "local",
                    "reduce" => "cloud",
                    _ => "cloud",
                }
            }
            AIMode::LocalOnly => "local",
            AIMode::CloudOnly => "cloud",
        };
        
        println!("[AI] {} phase using {} provider (Mode: {:?})", phase, target, mode);
        self.ask_provider(target, history, system_prompt).await
    }

    pub fn map_reduce_ask(
        &self, 
        _history: Vec<crate::ai::provider::ChatMessage>, 
        long_context: String,
        prompt_instruction: String
    ) -> tokio_stream::wrappers::ReceiverStream<Result<StreamEvent, Box<dyn std::error::Error + Send + Sync>>> {
        let (tx, rx): (tokio::sync::mpsc::Sender<Result<StreamEvent, Box<dyn std::error::Error + Send + Sync>>>, _) = tokio::sync::mpsc::channel(100);
        let manager = self.clone();
        
        tokio::spawn(async move {
            // 1. Chunking (6000 chars ~ 1500 tokens, safe for 8k)
            // We use chars for simplicity, assuming largely English/Code.
            let chunk_size = 6000;
            let chunks: Vec<String> = long_context.chars()
                .collect::<Vec<char>>()
                .chunks(chunk_size)
                .map(|c| c.iter().collect::<String>())
                .collect();
            
            let total_chunks = chunks.len();
            let _ = tx.send(Ok(StreamEvent::Thought(format!("Input split into {} chunks for Deep Thought analysis...", total_chunks)))).await;

            // Read AI Mode for routing
            let ai_mode = manager.get_ai_mode().await;
            let _ = tx.send(Ok(StreamEvent::Thought(format!("AI Strategy: {:?}", ai_mode)))).await;

            let mut aggregated_insights = String::new();

            // 2. Map Phase
            for (i, chunk) in chunks.iter().enumerate() {
                let chunk_id = i + 1;
                let _ = tx.send(Ok(StreamEvent::Thought(format!("Analyzing Chunk {}/{} ({} chars)...", chunk_id, total_chunks, chunk.len())))).await;

                let map_prompt = format!(
                    "### MAP PHASE: PARTIAL ANALYSIS (Chunk {}/{})\n\
                    INSTRUCTION: Analyze this fragment of the target. Inspect for MALICIOUS INDICATORS only.\n\
                    - If Benign/Nothing found, reply 'CLEAR'.\n\
                    - If Suspicious, extract specific findings (API calls, IPs, Strings).\n\
                    \n\
                    FRAGMENT:\n\
                    {}\n\
                    ", chunk_id, total_chunks, chunk
                );

                // Use a temporary history for the map phase
                let map_history = vec![crate::ai::provider::ChatMessage {
                    role: "user".to_string(),
                    content: map_prompt,
                }];

                // Route MAP phase through mode-aware provider
                match manager.ask_with_mode(map_history, "You are a sub-process forensic engine. Output concise findings only.".to_string(), &ai_mode, "map").await {
                    Ok(result) => {
                        let clean_result = result.trim();
                        if !clean_result.eq_ignore_ascii_case("CLEAR") && !clean_result.is_empty() {
                            let insight = format!("Chunk {}: {}\n", chunk_id, clean_result);
                            aggregated_insights.push_str(&insight);
                            let _ = tx.send(Ok(StreamEvent::Thought(format!(">> Threat Detected in Chunk {}: {}", chunk_id, clean_result.chars().take(50).collect::<String>())))).await;
                        } else {
                            let _ = tx.send(Ok(StreamEvent::Thought(format!(">> Chunk {} Clear.", chunk_id)))).await;
                        }
                    },
                    Err(e) => {
                         let _ = tx.send(Ok(StreamEvent::Thought(format!("Error analyzing chunk {}: {}", chunk_id, e)))).await;
                    }
                }
            }

            // 3. Reduce Phase
            let _ = tx.send(Ok(StreamEvent::Thought("Synthesizing Final Verdict from Aggregated Insights...".to_string()))).await;
            
            let reduce_prompt = format!(
                "### REDUCE PHASE: FINAL VERDICT\n\
                CONTEXT: The following insights were aggregated from a multi-pass analysis of the target binary.\n\
                \n\
                AGGREGATED INSIGHTS:\n\
                {}\n\
                \n\
                INSTRUCTION: {} \n\
                Based on these insights, provide the final JSON verdict.",
                aggregated_insights, prompt_instruction
            );

             let reduce_history = vec![crate::ai::provider::ChatMessage {
                role: "user".to_string(),
                content: reduce_prompt,
            }];

            // Route REDUCE phase through mode-aware provider
            match manager.ask_with_mode(reduce_history, "You are a Senior Malware Researcher. Output strict JSON.".to_string(), &ai_mode, "reduce").await {
                Ok(final_response) => {
                     let _ = tx.send(Ok(StreamEvent::Final(final_response))).await;
                },
                Err(e) => {
                     let _ = tx.send(Err(Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))).await;
                }
            }
        });

        tokio_stream::wrappers::ReceiverStream::new(rx)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum StreamEvent {
    Thought(String),
    Final(String),
}
