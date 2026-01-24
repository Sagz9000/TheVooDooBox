use actix::prelude::*;
use actix_web_actors::ws;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
// Removed unused Mutex and Arc if I'm sure. 
// Actually I'll just remove both since warnings were explicit.


pub struct SpiceRelay {
    // Sink to write bytes to the TCP connection (Proxmox Proxy)
    tcp_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
    // Proxy info to establish connection
    proxy_addr: String,
    target_host: String,
    target_port: u16,
}

impl SpiceRelay {
    pub fn new(proxy_addr: String, target_host: String, target_port: u16) -> Self {
        Self {
            tcp_tx: None,
            proxy_addr,
            target_host,
            target_port,
        }
    }

    fn start_tcp_bridge(&mut self, ctx: &mut ws::WebsocketContext<Self>) {
        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        self.tcp_tx = Some(tx);

        let proxy_addr = self.proxy_addr.clone();
        let target_host = self.target_host.clone();
        let target_port = self.target_port;
        let recipient = ctx.address().recipient();

        println!("[SPICE_RELAY] Starting bridge to Proxy: {}, Target: {}:{}", proxy_addr, target_host, target_port);

        // Spawn async task to handle TCP connection
        tokio::spawn(async move {
            match TcpStream::connect(&proxy_addr).await {
                Ok(mut stream) => {
                    println!("[SPICE_RELAY] Connected to Proxy. Sending HTTP CONNECT...");
                    
                    let connect_req = format!(
                        "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n\r\n",
                        target_host, target_port, target_host, target_port
                    );
                    
                    if let Err(e) = stream.write_all(connect_req.as_bytes()).await {
                        println!("[SPICE_RELAY] Failed to write CONNECT: {}", e);
                        return;
                    }

                    // Read Header Response
                    let mut buffer = [0u8; 4096];
                    match stream.read(&mut buffer).await {
                        Ok(n) if n > 0 => {
                            let response = String::from_utf8_lossy(&buffer[..n]);
                            if response.contains("200") {
                                println!("[SPICE_RELAY] Tunnel Established!");
                                
                                // Handle TLS if port is 61000
                                if target_port == 61000 {
                                    println!("[SPICE_RELAY] Performing TLS Handshake...");
                                    let connector = match native_tls::TlsConnector::builder()
                                        .danger_accept_invalid_certs(true)
                                        .build() {
                                            Ok(c) => c,
                                            Err(e) => {
                                                println!("[SPICE_RELAY] TLS Config Error: {}", e);
                                                return;
                                            }
                                        };
                                    let connector = tokio_native_tls::TlsConnector::from(connector);
                                    
                                    // Connect TLS over the established tunnel
                                    // Domain check is disabled so the string doesn't matter much
                                    match connector.connect("pvespiceproxy", stream).await {
                                        Ok(mut tls_stream) => {
                                            println!("[SPICE_RELAY] TLS Handshake Success!");
                                            
                                            // CRITICAL FIX: Wait for initial SPICE handshake from client
                                            // The SPICE server expects the client to send the first message immediately
                                            println!("[SPICE_RELAY] Waiting for initial client handshake...");
                                            
                                            // Wait for first message from WebSocket client (with timeout)
                                            let initial_handshake = tokio::time::timeout(
                                                std::time::Duration::from_secs(5),
                                                rx.recv()
                                            ).await;
                                            
                                            match initial_handshake {
                                                Ok(Some(data)) => {
                                                    println!("[SPICE_RELAY] Received initial handshake ({} bytes), forwarding to server...", data.len());
                                                    if let Err(e) = tls_stream.write_all(&data).await {
                                                        println!("[SPICE_RELAY] Failed to send initial handshake: {}", e);
                                                        return;
                                                    }
                                                    if let Err(e) = tls_stream.flush().await {
                                                        println!("[SPICE_RELAY] Failed to flush initial handshake: {}", e);
                                                        return;
                                                    }
                                                    println!("[SPICE_RELAY] Initial handshake sent successfully, starting relay...");
                                                    
                                                    // Now start the bidirectional relay
                                                    let (mut reader, mut writer) = tokio::io::split(tls_stream);
                                                    relay_data(&mut reader, &mut writer, &mut rx, recipient).await;
                                                }
                                                Ok(None) => {
                                                    println!("[SPICE_RELAY] WebSocket closed before sending handshake");
                                                    return;
                                                }
                                                Err(_) => {
                                                    println!("[SPICE_RELAY] Timeout waiting for initial handshake from client");
                                                    return;
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            println!("[SPICE_RELAY] TLS Handshake Failed: {}", e);
                                            return;
                                        }
                                    }
                                } else {
                                    // Plain TCP Relay
                                    let (mut reader, mut writer) = stream.into_split();
                                    relay_data(&mut reader, &mut writer, &mut rx, recipient).await;
                                }
                            } else {
                                println!("[SPICE_RELAY] Proxy denied connection: {}", response);
                            }
                        }
                        _ => println!("[SPICE_RELAY] Failed to receive proxy response"),
                    }
                }
                Err(e) => println!("[SPICE_RELAY] Failed to connect to proxy {}: {}", proxy_addr, e),
            }
            println!("[SPICE_RELAY] TCP Bridge Closed");
        });
    }
}

async fn relay_data<R, W>(
    reader: &mut R,
    writer: &mut W,
    rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    recipient: Recipient<BinaryMessage>,
) where 
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    // Task: Rx Channel -> TCP Writer
    let write_task = async {
        while let Some(data) = rx.recv().await {
            if let Err(e) = writer.write_all(&data).await {
                println!("[SPICE_RELAY] TCP Write Error: {}", e);
                break;
            }
            if let Err(e) = writer.flush().await {
                println!("[SPICE_RELAY] TCP Flush Error: {}", e);
                break;
            }
        }
        println!("[SPICE_RELAY] Write Task Finished (Channel closed or error)");
    };

    // Task: TCP Reader -> WebSocket
    let read_task = async {
        let mut read_buf = [0u8; 16384];
        loop {
            match reader.read(&mut read_buf).await {
                Ok(0) => {
                    println!("[SPICE_RELAY] TCP Read EOF (Server disconnected)");
                    break;
                }
                Ok(n) => {
                    let data = read_buf[..n].to_vec();
                    // Debug: Log first 64 bytes of server response
                    let preview = if n > 64 { &data[..64] } else { &data[..] };
                    println!("[SPICE_RELAY] Server -> Client: {} bytes (preview: {:02X?})", n, preview);
                    recipient.do_send(BinaryMessage(data));
                }
                Err(e) => {
                    println!("[SPICE_RELAY] TCP Read Error: {}", e);
                    break;
                }
            }
        }
        println!("[SPICE_RELAY] Read Task Finished");
    };

    tokio::select! {
        _ = write_task => (),
        _ = read_task => (),
    }
}

// ... BinaryMessage and handlers remain the same ...
#[derive(Message)]
#[rtype(result = "()")]
struct BinaryMessage(Vec<u8>);

impl Actor for SpiceRelay {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.start_tcp_bridge(ctx);
    }
}

impl Handler<BinaryMessage> for SpiceRelay {
    type Result = ();

    fn handle(&mut self, msg: BinaryMessage, ctx: &mut Self::Context) {
        use actix_web::web::Bytes;
        ctx.binary(Bytes::from(msg.0));
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for SpiceRelay {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Binary(bin)) => {
                if let Some(ref tx) = self.tcp_tx {
                    // Debug: Log first 64 bytes of client data
                    let preview = if bin.len() > 64 { &bin[..64] } else { &bin[..] };
                    println!("[SPICE_RELAY] Client -> Server: {} bytes (preview: {:02X?})", bin.len(), preview);
                    let _ = tx.send(bin.to_vec());
                }
            },
            Ok(ws::Message::Close(reason)) => {
                println!("[SPICE_RELAY] WebSocket closed by client: {:?}", reason);
                ctx.close(reason);
                ctx.stop();
            },
            Err(e) => {
                println!("[SPICE_RELAY] WebSocket protocol error: {:?}", e);
            }
            _ => (),
        }
    }
}
