use tokio::net::TcpStream;
use tokio::io::{AsyncWriteExt, AsyncBufReadExt, BufReader};
use serde::Serialize;
use std::time::Duration;
use rand::Rng;

#[derive(Serialize)]
struct AgentEvent {
    event_type: String,
    process_id: u32,
    parent_process_id: u32,
    process_name: String,
    details: String,
    timestamp: u64,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Starting Mock Agent...");
    
    let addr = std::env::var("AGENT_SERVER_ADDR").unwrap_or_else(|_| "hyper-bridge:9001".to_string()); 
    println!("Connecting to {}...", addr);

    let mut stream = loop {
        match TcpStream::connect(addr.clone()).await {
            Ok(s) => break s,
            Err(_) => {
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        }
    };

    println!("Connected! Streaming events...");

    let mut active_pids = vec![4, 512, 620]; 
    let mut rng = rand::thread_rng();
    let processes = vec!["svchost.exe", "explorer.exe", "chrome.exe", "malware.exe", "powershell.exe"];

    let (rx, mut tx) = tokio::io::split(stream);
    let mut reader = BufReader::new(rx);
    let mut interval = tokio::time::interval(Duration::from_millis(1500));

    loop {
        let mut line = String::new();
        tokio::select! {
            _ = interval.tick() => {
                let pid = rng.gen_range(1000..9999);
                let ppid = active_pids[rng.gen_range(0..active_pids.len())];
                
                let event = AgentEvent {
                    event_type: "PROCESS_CREATE".to_string(),
                    process_id: pid,
                    parent_process_id: ppid,
                    process_name: processes[rng.gen_range(0..processes.len())].to_string(),
                    details: format!("New process created with parent {}", ppid),
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)?
                        .as_millis() as u64,
                };

                active_pids.push(pid);
                if active_pids.len() > 15 { active_pids.remove(0); }

                let json = serde_json::to_string(&event)?;
                tx.write_all(json.as_bytes()).await?;
                tx.write_all(b"\n").await?;
            }

            res = reader.read_line(&mut line) => {
                match res {
                    Ok(0) => break, 
                    Ok(_) => {
                        if let Ok(cmd) = serde_json::from_str::<serde_json::Value>(&line) {
                            if cmd["command"] == "KILL" {
                                let target_pid = cmd["pid"].as_u64().unwrap_or(0) as u32;
                                println!("KILL COMMAND RECEIVED FOR PID {}", target_pid);
                                
                                active_pids.retain(|&p| p != target_pid);

                                let event = AgentEvent {
                                    event_type: "PROCESS_TERMINATE".to_string(),
                                    process_id: target_pid,
                                    parent_process_id: 0,
                                    process_name: "TERMINATED".to_string(),
                                    details: format!("Process {} terminated by remote analyst", target_pid),
                                    timestamp: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)?
                                        .as_millis() as u64,
                                };
                                let json = serde_json::to_string(&event)?;
                                tx.write_all(json.as_bytes()).await?;
                                tx.write_all(b"\n").await?;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    }
    Ok(())
}
