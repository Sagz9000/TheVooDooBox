use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;

#[derive(Clone)]
pub struct ProxmoxClient {
    pub base_url: String,
    pub auth_header: String,
    http: Client,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Node {
    pub node: String,
    pub status: String,
    pub maxcpu: Option<u64>,
    pub maxmem: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct NodeResponse {
    data: Vec<Node>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Vm {
    pub vmid: u64,
    pub name: Option<String>,
    pub status: String,
    pub cpus: Option<u64>,
    pub maxmem: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct VmResponse {
    data: Vec<Vm>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VncTicket {
    pub ticket: String,
    pub port: String,
    pub upid: String,
    pub cert: Option<String>,
    pub password: Option<String>,
    pub host: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VncTicketResponse {
    data: VncTicket,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SpiceTicket {
    pub ticket: Option<String>, // Sometimes missing if password is used
    pub password: Option<String>, // This is often the ticket for SPICE
    pub host: Option<String>,
    pub port: Option<u16>, // Standard port
    pub proxy: String,
    #[serde(rename = "tls-port")]
    pub tls_port: Option<u16>,
    pub ca: Option<String>,
    #[serde(rename = "host-subject")]
    pub host_subject: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SpiceTicketResponse {
    data: SpiceTicket,
}

impl ProxmoxClient {
    pub fn new(url: String, user: String, token_id: String, token_secret: String) -> Self {
        // PVEAuthCookie or Authorization: PVEAPIToken=USER@REALM!TOKENID=UUID
        let auth = format!("PVEAPIToken={}!{}={}", user, token_id, token_secret);
        
        // Ensure base url ends with /api2/json
        let base_url = if url.ends_with("/") {
            format!("{}api2/json", url)
        } else {
            format!("{}/api2/json", url)
        };

        ProxmoxClient {
            base_url,
            auth_header: auth,
            http: Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(std::time::Duration::from_secs(30))
                .tcp_keepalive(Some(std::time::Duration::from_secs(60)))
                .build()
                .unwrap(),
        }
    }

    pub async fn get_nodes(&self) -> Result<Vec<Node>, Box<dyn Error>> {
        let url = format!("{}/nodes", self.base_url);
        
        let resp = self.http.get(&url)
            .header("Authorization", &self.auth_header)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(format!("Proxmox API Error: {}", resp.status()).into());
        }

        let body: NodeResponse = resp.json().await?;
        Ok(body.data)
    }

    pub async fn get_vms(&self, node: &str) -> Result<Vec<Vm>, Box<dyn Error>> {
        let url = format!("{}/nodes/{}/qemu", self.base_url, node);
        
        let resp = self.http.get(&url)
            .header("Authorization", &self.auth_header)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(format!("Proxmox API Error: {}", resp.status()).into());
        }

        let body: VmResponse = resp.json().await?;
        Ok(body.data)
    }

    pub async fn create_vnc_proxy(&self, node: &str, vmid: u64) -> Result<VncTicket, Box<dyn Error>> {
        let url = format!("{}/nodes/{}/qemu/{}/vncproxy", self.base_url, node, vmid);
        println!("[PROXMOX] Requesting VNC Proxy for Node: {}, VMID: {}", node, vmid);
        
        let resp = self.http.post(&url)
            .header("Authorization", &self.auth_header)
            .form(&[
                ("websocket", "1"),
                ("generate-password", "1")
            ])
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await?;
            println!("[PROXMOX] VNC Proxy Failure: {}", error_text);
            return Err(format!("Proxmox API Error (VNC): {}", error_text).into());
        }

        let body: VncTicketResponse = resp.json().await?;
        let mut ticket_data = body.data;
        
        // Extract host from base_url
        let host = self.base_url
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("localhost")
            .split(':')
            .next()
            .unwrap_or("localhost")
            .to_string();
            
        ticket_data.host = Some(host);

        println!("[PROXMOX] VNC Ticket Obtained: UPID={}", ticket_data.upid);
        Ok(ticket_data)
    }

    pub async fn create_spice_proxy(&self, node: &str, vmid: u64) -> Result<SpiceTicket, Box<dyn Error>> {
        let url = format!("{}/nodes/{}/qemu/{}/spiceproxy", self.base_url, node, vmid);
        println!("[PROXMOX] Requesting SPICE Proxy for Node: {}, VMID: {}", node, vmid);
        
        let resp = self.http.post(&url)
            .header("Authorization", &self.auth_header)
            .form(&[
                ("proxy", "127.0.0.1") // Often ignored but Proxmox doc mentions it
            ])
            .send()
            .await?;

        if !resp.status().is_success() {
            let error_text = resp.text().await?;
            println!("[PROXMOX] SPICE Proxy Failure: {}", error_text);
            return Err(format!("Proxmox API Error (SPICE): {}", error_text).into());
        }

        let raw_body = resp.text().await?;
        println!("[PROXMOX] SPICE Proxy Raw Body: {}", raw_body);
        
        let body: SpiceTicketResponse = serde_json::from_str(&raw_body)?;
        let mut ticket_data = body.data;

        // Extract host from base_url
        let host = self.base_url
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("localhost")
            .split(':')
            .next()
            .unwrap_or("localhost")
            .to_string();
            
        ticket_data.host = Some(host);

        println!("[PROXMOX] SPICE Ticket Obtained Successfully");
        Ok(ticket_data)
    }

    pub async fn vm_action(&self, node: &str, vmid: u64, action: &str) -> Result<(), Box<dyn Error>> {
        let url = format!("{}/nodes/{}/qemu/{}/status/{}", self.base_url, node, vmid, action);
        
        let mut attempts = 0;
        loop {
            let resp = self.http.post(&url)
                .header("Authorization", &self.auth_header)
                .send()
                .await;

            match resp {
                Ok(r) if r.status().is_success() => return Ok(()),
                Ok(r) => {
                    let text = r.text().await?;
                    if attempts >= 3 {
                        return Err(format!("Proxmox Action Error: {}", text).into());
                    }
                }
                Err(e) => {
                    if attempts >= 3 {
                        return Err(Box::new(e));
                    }
                }
            }
            attempts += 1;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }

    pub async fn rollback_snapshot(&self, node: &str, vmid: u64, snapshot: &str) -> Result<(), Box<dyn Error>> {
        let url = format!("{}/nodes/{}/qemu/{}/snapshot/{}/rollback", self.base_url, node, vmid, snapshot);
        
        let mut attempts = 0;
        loop {
            let resp = self.http.post(&url)
                .header("Authorization", &self.auth_header)
                .send()
                .await;

            match resp {
                Ok(r) if r.status().is_success() => return Ok(()),
                Ok(r) => {
                    let text = r.text().await?;
                    if attempts >= 3 {
                        return Err(format!("Proxmox Snapshot Error: {}", text).into());
                    }
                }
                Err(e) => {
                    if attempts >= 3 {
                        return Err(Box::new(e));
                    }
                }
            }
            attempts += 1;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }
}
