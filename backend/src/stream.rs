use actix::prelude::*;
use actix_web_actors::ws;
use actix_web::{web, Error, HttpRequest, HttpResponse};
use tokio::sync::broadcast;

// -- Broadcast Server (Actor-ish structure but using Tokio Broadcast)

pub struct Broadcaster {
    tx: broadcast::Sender<String>,
}

impl Broadcaster {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        Broadcaster { tx }
    }
    
    pub fn send_message(&self, msg: &str) {
        let _ = self.tx.send(msg.to_string());
    }
    
    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }
}

// -- WebSocket Session Actor

pub struct WsSession {
    rx: Option<broadcast::Receiver<String>>,
}

impl Actor for WsSession {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        // Start listening to broadcast updates
        if let Some(mut rx) = self.rx.take() {
            let addr = ctx.address();
            let fut = async move {
                while let Ok(msg) = rx.recv().await {
                    addr.do_send(BroadcastMessage(msg));
                }
            };
            ctx.spawn(actix::fut::wrap_future(fut));
        }
    }
}

// Internal message format for Actix actor
#[derive(Message)]
#[rtype(result = "()")]
struct BroadcastMessage(String);

impl Handler<BroadcastMessage> for WsSession {
    type Result = ();

    fn handle(&mut self, msg: BroadcastMessage, ctx: &mut Self::Context) {
        ctx.text(msg.0);
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for WsSession {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Ping(msg)) => ctx.pong(&msg),
            _ => (),
        }
    }
}

// -- HTTP Endpoint for WS Upgrade

pub async fn ws_route(
    req: HttpRequest, 
    stream: web::Payload, 
    broadcaster: web::Data<std::sync::Arc<Broadcaster>>
) -> Result<HttpResponse, Error> {
    let rx = broadcaster.subscribe();
    ws::start(WsSession { rx: Some(rx) }, &req, stream)
}
