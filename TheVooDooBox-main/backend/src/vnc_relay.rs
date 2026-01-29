use actix::prelude::*;
use actix_web_actors::ws;
use futures::{SinkExt, StreamExt};
use std::time::Duration;
use tokio_tungstenite::tungstenite::protocol::Message as TungsteniteMessage;
use tokio_tungstenite::{connect_async_tls_with_config, Connector};
use native_tls::TlsConnector;

pub struct VncRelay {
    upstream_tx: Option<tokio::sync::mpsc::UnboundedSender<TungsteniteMessage>>,
    target_wss_url: String,
    password: String,
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
        let password = self.password.clone();
        let recipient = ctx.address().recipient();
        
        println!("[VNC_RELAY] Starting proxy to upstream: {}", url);

        tokio::spawn(async move {
            let tls_builder = TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .build()
                .expect("Failed to build TlsConnector");
            let connector = Connector::NativeTls(tls_builder);

            use tokio::net::TcpStream;
            use tokio_tungstenite::{WebSocketStream, MaybeTlsStream};
            use http::Request;

            println!("[VNC_RELAY] Attempting TLS handshake with Proxmox...");

            // Construct Request with Headers
            let key = tokio_tungstenite::tungstenite::handshake::client::generate_key();
            let host = url.split('/').nth(2).unwrap_or("localhost");

            let request = Request::builder()
                .uri(&url)
                .header("Host", host)
                .header("PVEAuthCookie", password.clone()) // VNC on Proxmox MIGHT accept Header, but Cookie is standard.
                .header("Cookie", format!("PVEAuthCookie={}", password))
                .header("Connection", "Upgrade")
                .header("Upgrade", "websocket")
                .header("Sec-WebSocket-Version", "13")
                .header("Sec-WebSocket-Key", key)
                .body(())
                .unwrap();

            match connect_async_tls_with_config(request, None, false, Some(connector)).await {
                Ok((ws_stream, response)) => {
                    println!("[VNC_RELAY] Upstream Connected! Response Status: {}", response.status());
                    let ws_stream: WebSocketStream<MaybeTlsStream<TcpStream>> = ws_stream;
                    let (mut write, mut read) = ws_stream.split();

                    // Task: Client -> Upstream
                    let f_write = async move {
                        while let Some(msg) = rx.recv().await {
                            // println!("[VNC_RELAY] Client -> Upstream: {:?}", msg); // Very verbose
                            if let Err(e) = write.send(msg).await {
                                println!("[VNC_RELAY] Upstream Write Error: {}", e);
                                break;
                            }
                        }
                    };

                    // Task: Upstream -> Client
                    let f_read = async move {
                        while let Some(msg) = read.next().await {
                            match msg {
                                Ok(TungsteniteMessage::Binary(bin)) => {
                                    // println!("[VNC_RELAY] Upstream -> Client (Binary: {} bytes)", bin.len());
                                    recipient.do_send(BinaryMessage(bin.to_vec()));
                                }
                                Ok(TungsteniteMessage::Text(txt)) => {
                                    println!("[VNC_RELAY] Upstream -> Client (Text: {})", txt);
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
                                _ => {} 
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
        println!("[VNC_RELAY] Actor started (Client Connected)");
        self.start_proxy(ctx);
        
        ctx.run_interval(Duration::from_secs(10), |_, ctx| {
            ctx.ping(b"PING");
        });
    }

    fn stopped(&mut self, _: &mut Self::Context) {
        println!("[VNC_RELAY] Actor stopped (Client Disconnected)");
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
                    // println!("[VNC_RELAY] Client -> Upstream (Binary: {} bytes)", bin.len());
                    let _ = tx.send(TungsteniteMessage::Binary(bin));
                }
            },
            Ok(ws::Message::Text(txt)) => {
                if let Some(ref tx) = self.upstream_tx {
                    println!("[VNC_RELAY] Client -> Upstream (Text: {})", txt);
                    let _ = tx.send(TungsteniteMessage::Text(txt.to_string().into()));
                }
            },
            Ok(ws::Message::Close(reason)) => {
                println!("[VNC_RELAY] Client Closed Connection: {:?}", reason);
                ctx.close(reason);
                ctx.stop();
            },
            Err(e) => println!("[VNC_RELAY] Client Protocol Error: {}", e),
            _ => (),
        }
    }
}
