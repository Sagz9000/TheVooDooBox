use std::sync::Arc;
use sqlx::{Pool, Postgres};
use crate::ai_analysis::RecommendedAction;
use crate::AgentManager;

pub struct ActionManager;

impl ActionManager {
    pub async fn execute_actions(
        task_id: &str,
        actions: Vec<RecommendedAction>,
        agent_manager: Arc<AgentManager>,
        pool: &Pool<Postgres>,
    ) {
        if actions.is_empty() {
            return;
        }

        println!("[ACTION_MANAGER] Processing {} recommended actions for task: {}", actions.len(), task_id);

        for action in actions {
            println!("[ACTION] AI RECOMMENDED: {} | Reason: {}", action.action, action.reasoning);
            
            match action.action.as_str() {
                "FETCH_URL" => {
                    if let Some(url) = action.params.get("url") {
                        Self::send_agent_task(task_id, &format!("TASK:FETCH {}", url), agent_manager.clone()).await;
                    } else {
                        println!("[ACTION] Error: FETCH_URL missing 'url' parameter");
                    }
                },
                "MEM_DUMP" => {
                    if let Some(pid_str) = action.params.get("pid") {
                        Self::send_agent_task(task_id, &format!("TASK:MEMDUMP {}", pid_str), agent_manager.clone()).await;
                    } else {
                        println!("[ACTION] Error: MEM_DUMP missing 'pid' parameter");
                    }
                },
                "TAG_EVENT" => {
                    if let (Some(event_id_str), Some(tag)) = (action.params.get("event_id"), action.params.get("tag")) {
                        if let Ok(event_id) = event_id_str.parse::<i32>() {
                            let _ = sqlx::query("UPDATE events SET decoded_details = $1 WHERE id = $2")
                                .bind(format!("[AI_AUTO_TAG] {}", tag))
                                .bind(event_id)
                                .execute(pool)
                                .await;
                            println!("[ACTION] Tagged event {} with '{}'", event_id, tag);
                        }
                    }
                },
                _ => {
                    println!("[ACTION] Warning: Unsupported AI action: {}", action.action);
                }
            }
        }
    }

    async fn send_agent_task(task_id: &str, command: &str, agent_manager: Arc<AgentManager>) {
        let sessions = agent_manager.sessions.lock().await;
        let session_id = sessions.iter()
            .find(|(_, s)| s.active_task_id.as_deref() == Some(task_id))
            .map(|(id, _)| id.clone());

        if let Some(sid) = session_id {
            println!("[ACTION] Dispatching task to agent {}: {}", sid, command);
            // Re-unlocking to avoid deadlocks if send_command_to_session locks again
            drop(sessions); 
            agent_manager.send_command_to_session(&sid, command).await;
        } else {
            println!("[ACTION] ERROR: No active agent session found for task {}", task_id);
        }
    }
}
