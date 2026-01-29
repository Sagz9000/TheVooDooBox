use actix::prelude::*;
use actix_web_actors::ws;
use futures::{SinkExt, StreamExt};
use std::time::Duration;
use tokio::time::interval;
use tokio_tungstenite::tungstenite::protocol::Message as TungsteniteMessage;
use tokio_tungstenite::{connect_async_tls_with_config, Connector};
use native_tls::TlsConnector;

pub struct VncRelay {
    // We don't hold the connection directly here in a way that blocks; 
    // instead we use a channel or spawns to handle the bidirectional flow.
    // For Actix actor, we usually spawn a future that pumps messages.
    // 
    // To keep it simple and robust:
    // 1. On start, connect to upstream Proxmox WSS.
    // 2. Spawn a read task (Proxmox -> Actor).
    // 3. Keep a write sink (Actor -> Proxmox).
    
    // We need a way to send to the upstream sink from the handle() method.
    // Since Sink is async and handle() is sync, we use a channel.
    upstream_tx: Option<tokio::sync::mpsc::UnboundedSender<TungsteniteMessage>>,
    
    // Connection Params
    target_wss_url: String,
    password: String, // VNC Password to inject if needed, or handled by ticket in URL
}

impl VncRelay {
    pub fn new(target_wss_url: String, password: String) -> Self {
        Self {
            upstream_tx: None,
            target_wss_url,
            password,
        }
    }

    fn start_proxy(&mut self, ctx: &mut ws::WebsocketContext<Self>) {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<TungsteniteMessage>();
        self.upstream_tx = Some(tx);
        
        let url = self.target_wss_url.clone();
        let recipient = ctx.address().recipient();
        
        println!("[VNC_RELAY] Connecting to upstream: {}", url);

        // Spawn the connection task
        tokio::spawn(async move {
            // Configure TLS to skip verification (Proxmox uses self-signed)
            let tls_builder = TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .build()
                .expect("Failed to build TlsConnector");
            let connector = Connector::NativeTls(tls_builder);

            use tokio::net::TcpStream;
            use tokio_tungstenite::{WebSocketStream, MaybeTlsStream};

            match connect_async_tls_with_config(&url, None, false, Some(connector)).await {
                Ok((ws_stream, _)) => {
                    println!("[VNC_RELAY] Upstream Connected!");
                    let ws_stream: WebSocketStream<MaybeTlsStream<TcpStream>> = ws_stream;
                    let (mut write, mut read) = ws_stream.split();

                    // Task: Actor (Client) -> Upstream
                    let f_write = async move {
                        while let Some(msg) = rx.recv().await {
                            if let Err(e) = write.send(msg).await {
                                println!("[VNC_RELAY] Upstream Write Error: {}", e);
                                break;
                            }
                        }
                    };

                    // Task: Upstream -> Actor (Client)
                    let f_read = async move {
                        while let Some(msg) = read.next().await {
                            match msg {
                                Ok(TungsteniteMessage::Binary(bin)) => {
                                    recipient.do_send(BinaryMessage(bin.to_vec()));
                                }
                                Ok(TungsteniteMessage::Text(txt)) => {
                                    // VNC is mostly binary, but just in case
                                    recipient.do_send(BinaryMessage(txt.as_str().as_bytes().to_vec()));
                                }
                                Ok(TungsteniteMessage::Close(_)) => {
                                    println!("[VNC_RELAY] Upstream Closed Connection");
                                    break;
                                }
                                Err(e) => {
                                    println!("[VNC_RELAY] Upstream Read Error: {}", e);
                                    break; 
                                }
                                _ => {} // Ping/Pong handled automatically
                            }
                        }
                    };

                    tokio::select! {
                        _ = f_write => println!("[VNC_RELAY] Write loop ended"),
                        _ = f_read => println!("[VNC_RELAY] Read loop ended"),
                    }
                }
                Err(e) => {
                    println!("[VNC_RELAY] Failed to connect to Proxmox: {}", e);
                }
            }
        });
    }
}

// --- Messages ---
#[derive(Message)]
#[rtype(result = "()")]
struct BinaryMessage(Vec<u8>);

// --- Actor Implementation ---
impl Actor for VncRelay {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.start_proxy(ctx);
        
        // Optional: Keep alive heartbeats if needed
        ctx.run_interval(Duration::from_secs(10), |_, ctx| {
            ctx.ping(b"PING");
        });
    }
}

// --- Handler: Upstream -> Client ---
impl Handler<BinaryMessage> for VncRelay {
    type Result = ();

    fn handle(&mut self, msg: BinaryMessage, ctx: &mut Self::Context) {
        ctx.binary(msg.0);
    }
}

// --- Handler: Client -> Upstream ---
impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for VncRelay {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Binary(bin)) => {
                if let Some(ref tx) = self.upstream_tx {
                    // actix::web::Bytes -> tungstenite::Bytes
                    let _ = tx.send(TungsteniteMessage::Binary(bin));
                }
            },
            Ok(ws::Message::Text(txt)) => {
                if let Some(ref tx) = self.upstream_tx {
                     // String -> tungstenite::Utf8Bytes
                    let _ = tx.send(TungsteniteMessage::Text(txt.to_string().into()));
                }
            },
            Ok(ws::Message::Ping(bytes)) => {
                ctx.pong(&bytes);
            },
            Ok(ws::Message::Close(reason)) => {
                ctx.close(reason);
                ctx.stop();
            },
            _ => (),
        }
    }
}
