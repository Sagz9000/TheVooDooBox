use actix::prelude::*;
use actix_web_actors::ws;
use actix_web::{web, Error, HttpRequest, HttpResponse};
use tokio::sync::broadcast;
use serde::Serialize;
use std::sync::Arc;

// ── Progress Event ──

#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub task_id: String,
    pub stage: String,
    pub message: String,
    pub percent: u8,
    pub timestamp: i64,
}

// ── Broadcaster (mirrors stream.rs pattern) ──

pub struct ProgressBroadcaster {
    tx: broadcast::Sender<String>,
}

impl ProgressBroadcaster {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        ProgressBroadcaster { tx }
    }

    pub fn send_progress(&self, task_id: &str, stage: &str, message: &str, percent: u8) {
        let event = ProgressEvent {
            task_id: task_id.to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
            percent,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        if let Ok(json) = serde_json::to_string(&event) {
            let _ = self.tx.send(json);
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }
}

// ── WebSocket Session Actor ──

pub struct ProgressWsSession {
    rx: Option<broadcast::Receiver<String>>,
}

impl Actor for ProgressWsSession {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        if let Some(mut rx) = self.rx.take() {
            let addr = ctx.address();
            let fut = async move {
                while let Ok(msg) = rx.recv().await {
                    addr.do_send(ProgressMessage(msg));
                }
            };
            ctx.spawn(actix::fut::wrap_future(fut));
        }
    }
}

#[derive(Message)]
#[rtype(result = "()")]
struct ProgressMessage(String);

impl Handler<ProgressMessage> for ProgressWsSession {
    type Result = ();

    fn handle(&mut self, msg: ProgressMessage, ctx: &mut Self::Context) {
        ctx.text(msg.0);
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for ProgressWsSession {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Ping(data)) => ctx.pong(&data),
            Ok(ws::Message::Close(reason)) => {
                ctx.close(reason);
                ctx.stop();
            }
            _ => (),
        }
    }
}

// ── HTTP Upgrade Endpoint ──

pub async fn ws_progress_route(
    req: HttpRequest,
    stream: web::Payload,
    broadcaster: web::Data<Arc<ProgressBroadcaster>>,
) -> Result<HttpResponse, Error> {
    let rx = broadcaster.subscribe();
    ws::start(ProgressWsSession { rx: Some(rx) }, &req, stream)
}
