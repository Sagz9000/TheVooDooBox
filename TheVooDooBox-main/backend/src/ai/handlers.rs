use actix_web::{post, web, HttpResponse, Responder};
use crate::ai::manager::{AIManager, ProviderType};
use crate::{proxmox, ChatRequest, ChatResponse, ConfigRequest};

#[post("/ai/chat")]
pub async fn chat_handler(
    req: web::Json<ChatRequest>,
    ai_manager: web::Data<AIManager>,
    proxmox: web::Data<proxmox::ProxmoxClient>,
) -> impl Responder {
    // 1. gather context
    let mut context = String::from("Current Lab State:\n");
    if let Ok(nodes) = proxmox.get_nodes().await {
        for node in nodes {
             context.push_str(&format!("Node: {} (Status: {})\n", node.node, node.status));
             if let Ok(vms) = proxmox.get_vms(&node.node).await {
                 for vm in vms {
                     context.push_str(&format!("  - VM {} (ID: {}, Status: {})\n", vm.name.unwrap_or_default(), vm.vmid, vm.status));
                 }
             }
        }
    }

    // 2. Ask AI
    match ai_manager.ask(&req.prompt, &context).await {
        Ok(text) => HttpResponse::Ok().json(ChatResponse { response: text, provider: ai_manager.get_current_provider_name().await }),
        Err(e) => HttpResponse::InternalServerError().body(e.to_string()),
    }
}

#[post("/ai/config")]
pub async fn config_handler(
    req: web::Json<ConfigRequest>,
    ai_manager: web::Data<AIManager>,
) -> impl Responder {
    ai_manager.switch_provider(req.provider.clone()).await;
    HttpResponse::Ok().json(serde_json::json!({"status": "switched", "provider": format!("{:?}", req.provider)}))
}
