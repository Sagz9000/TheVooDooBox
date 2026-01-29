use actix::prelude::*;
use actix_web_actors::ws;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::io::BufReader;
use tokio::io::AsyncBufReadExt;

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

                    // Read HTTP Response
                    let mut reader = BufReader::new(&mut stream);
                    let mut response = String::new();
                    if let Err(e) = reader.read_line(&mut response).await {
                         println!("[SPICE_RELAY] Failed to read proxy response: {}", e);
                         return;
                    }

                    if !response.contains("200") {
                        println!("[SPICE_RELAY] Proxy denied connection: {}", response.trim());
                        return;
                    }
                    
                    // Read headers until empty line
                    loop {
                        let mut line = String::new();
                        match reader.read_line(&mut line).await {
                             Ok(0) => break, // EOF
                             Ok(_) => if line.trim().is_empty() { break; },
                             Err(_) => break,
                        }
                    }

                    println!("[SPICE_RELAY] Tunnel Established! Starting TLS...");
                    
                    // Handle TLS if port is 61000 (standard Spice TLS)
                    if target_port == 61000 {
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
                        match connector.connect("pvespiceproxy", stream).await {
                            Ok(mut tls_stream) => {
                                println!("[SPICE_RELAY] TLS Handshake Success!");
                                
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
                                        println!("[SPICE_RELAY] Initial handshake sent. Starting bidirectional relay.");
                                        
                                        let (mut reader, mut writer) = tokio::io::split(tls_stream);
                                        relay_data(&mut reader, &mut writer, &mut rx, recipient).await;
                                    }
                                    Ok(None) => println!("[SPICE_RELAY] WebSocket closed before sending handshake"),
                                    Err(_) => println!("[SPICE_RELAY] Timeout waiting for initial handshake"),
                                }
                            }
                            Err(e) => println!("[SPICE_RELAY] TLS Handshake Failed: {}", e),
                        }
                    } else {
                        // Plain TCP Relay (unlikely for Proxmox Spice, but here for completeness)
                        let (mut reader, mut writer) = stream.into_split();
                        relay_data(&mut reader, &mut writer, &mut rx, recipient).await;
                    }
                }
                Err(e) => println!("[SPICE_RELAY] Failed to connect to proxy {}: {}", proxy_addr, e),
            }
            println!("[SPICE_RELAY] connection task finished.");
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
            // println!("[SPICE_RELAY] Client -> Server: {} bytes", data.len());
            if let Err(e) = writer.write_all(&data).await {
                println!("[SPICE_RELAY] TCP Write Error: {}", e);
                break;
            }
            if let Err(e) = writer.flush().await {
                println!("[SPICE_RELAY] TCP Flush Error: {}", e);
                break;
            }
        }
        println!("[SPICE_RELAY] Write Task Finished");
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
                    // println!("[SPICE_RELAY] Server -> Client: {} bytes", n);
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

#[derive(Message)]
#[rtype(result = "()")]
struct BinaryMessage(Vec<u8>);

impl Actor for SpiceRelay {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        println!("[SPICE_RELAY] Actor Started (Client Connected)");
        self.start_tcp_bridge(ctx);
    }
    
    fn stopped(&mut self, _: &mut Self::Context) {
         println!("[SPICE_RELAY] Actor Stopped (Client Disconnected)");
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
                    // println!("[SPICE_RELAY] Forwarding {} bytes to TCP", bin.len());
                    let _ = tx.send(bin.to_vec());
                }
            },
            Ok(ws::Message::Close(reason)) => {
                println!("[SPICE_RELAY] WebSocket closed by client: {:?}", reason);
                ctx.close(reason);
                ctx.stop();
            },
            Err(e) => println!("[SPICE_RELAY] WS Protocol Error: {:?}", e),
            _ => (),
        }
    }
}
