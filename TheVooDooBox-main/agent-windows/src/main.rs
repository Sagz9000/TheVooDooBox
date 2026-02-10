mod mem_utils;
mod kernel_bridge;
mod decoder;

use sysinfo::{ProcessExt, System, SystemExt, PidExt};
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::Duration;
use notify::{Watcher, RecursiveMode};
use tokio::sync::mpsc;
use sha2::{Sha256, Digest};
use std::io::Read;
use std::path::Path;
use std::collections::HashMap;
use winapi::um::winreg::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RegOpenKeyExA, RegEnumValueA, RegCloseKey};
use winapi::um::winnt::{KEY_READ, REG_SZ, REG_EXPAND_SZ};
use winapi::shared::minwindef::{HKEY, DWORD};
use winapi::um::winevt::*;
use winapi::shared::winerror::ERROR_SUCCESS;

fn wide_string(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn get_xml_tag_inner(xml: &str, tag_name: &str) -> String {
    let start_patterns = vec![
        format!("<{}>", tag_name),
        format!("<{} ", tag_name)
    ];

    for start_tag in start_patterns {
        if let Some(start_pos) = xml.find(&start_tag) {
            if let Some(content_start_offset) = xml[start_pos..].find('>') {
                let content_start = start_pos + content_start_offset + 1;
                let end_tag = format!("</{}", tag_name);
                if let Some(end_pos) = xml[content_start..].find(&end_tag) {
                    return xml[content_start..content_start + end_pos].trim().to_string();
                }
            }
        }
    }
    "".to_string()
}

fn get_sysmon_field(xml: &str, field_name: &str) -> String {
    // Try double quotes first (standard)
    let pattern_double = format!("Name=\"{}\">", field_name);
    if let Some(pos) = xml.find(&pattern_double) {
        let start = pos + pattern_double.len();
        if let Some(end) = xml[start..].find("</Data>") {
            return xml[start..start + end].to_string();
        }
    }
    
    // Fallback to single quotes
    let pattern_single = format!("Name='{}'>", field_name);
    if let Some(pos) = xml.find(&pattern_single) {
        let start = pos + pattern_single.len();
        if let Some(end) = xml[start..].find("</Data>") {
            return xml[start..start + end].to_string();
        }
    }
    
    "".to_string()
}

fn parse_sysmon_xml(xml: &str, hostname: &str) -> Option<AgentEvent> {
    let event_id = get_xml_tag_inner(xml, "EventID");
    
    // Extract MITRE ATT&CK Tag (RuleName)
    let rule_name = get_sysmon_field(xml, "RuleName");
    let tag_prefix = if !rule_name.is_empty() && rule_name != "-" {
        format!("[{}] ", rule_name)
    } else {
        "".to_string()
    };

    match event_id.as_str() {
        "1" => { // Process Creation
            let pid = get_sysmon_field(xml, "ProcessId").parse().unwrap_or(0);
            let ppid = get_sysmon_field(xml, "ParentProcessId").parse().unwrap_or(0);
            let image = get_sysmon_field(xml, "Image");
            let cmd_line = get_sysmon_field(xml, "CommandLine");
            let user = get_sysmon_field(xml, "User");
            
            let decodes = decoder::scan_and_decode(&cmd_line);
            let decoded_details = if decodes.is_empty() { None } else {
                Some(decodes.iter().map(|d| format!("[{}] {}", d.method, d.decoded)).collect::<Vec<_>>().join(" | "))
            };

            Some(AgentEvent {
                event_type: "PROCESS_CREATE".to_string(),
                process_id: pid,
                parent_process_id: ppid,
                process_name: image,
                details: format!("{}SYSMON: CMD: {} | User: {}", tag_prefix, cmd_line, user),
                decoded_details,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        "2" => { // File Creation Time Changed
            let pid = get_sysmon_field(xml, "ProcessId").parse().unwrap_or(0);
            let image = get_sysmon_field(xml, "Image");
            let target = get_sysmon_field(xml, "TargetFilename");
            let new_time = get_sysmon_field(xml, "CreationUtcTime");
            let old_time = get_sysmon_field(xml, "PreviousCreationUtcTime");

            Some(AgentEvent {
                event_type: "TIMESTOMP_DETECTED".to_string(),
                process_id: pid,
                parent_process_id: 0,
                process_name: image,
                details: format!("{}SYSMON: Timestomp on {} (New: {} | Old: {})", tag_prefix, target, new_time, old_time),
                decoded_details: None,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        "3" => { // Network Connection
            let pid = get_sysmon_field(xml, "ProcessId").parse().unwrap_or(0);
            let image = get_sysmon_field(xml, "Image");
            let proto = get_sysmon_field(xml, "Protocol");
            let src_ip = get_sysmon_field(xml, "SourceIp");
            let dst_ip = get_sysmon_field(xml, "DestinationIp");
            let dst_port = get_sysmon_field(xml, "DestinationPort");
            
            Some(AgentEvent {
                event_type: "NETWORK_CONNECT".to_string(),
                process_id: pid,
                parent_process_id: 0,
                process_name: image,
                details: format!("{}SYSMON: {} {} -> {}:{}", tag_prefix, proto, src_ip, dst_ip, dst_port),
                decoded_details: None,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        "7" => { // Image Load
            let pid = get_sysmon_field(xml, "ProcessId").parse().unwrap_or(0);
            let image = get_sysmon_field(xml, "Image");
            let loaded_image = get_sysmon_field(xml, "ImageLoaded");

            Some(AgentEvent {
                event_type: "IMAGE_LOAD".to_string(),
                process_id: pid,
                parent_process_id: 0,
                process_name: image,
                details: format!("{}SYSMON: Dynamic Load: {}", tag_prefix, loaded_image),
                decoded_details: None,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        "8" => { // CreateRemoteThread
            let src_pid = get_sysmon_field(xml, "SourceProcessId").parse().unwrap_or(0);
            let tgt_pid = get_sysmon_field(xml, "TargetProcessId").parse().unwrap_or(0);
            let src_image = get_sysmon_field(xml, "SourceImage");
            let tgt_image = get_sysmon_field(xml, "TargetImage");

            Some(AgentEvent {
                event_type: "REMOTE_THREAD".to_string(),
                process_id: src_pid,
                parent_process_id: 0,
                process_name: src_image,
                details: format!("{}SYSMON: Injection into {} (PID: {})", tag_prefix, tgt_image, tgt_pid),
                decoded_details: None,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        "10" => { // Process Access (LSASS)
            let src_pid = get_sysmon_field(xml, "SourceProcessId").parse().unwrap_or(0);
            let src_image = get_sysmon_field(xml, "SourceImage");
            let tgt_image = get_sysmon_field(xml, "TargetImage");
            let access_granted = get_sysmon_field(xml, "GrantedAccess");

            Some(AgentEvent {
                event_type: "PROCESS_ACCESS".to_string(),
                process_id: src_pid,
                parent_process_id: 0,
                process_name: src_image,
                details: format!("{}SYSMON: Accessed {} | Rights: {}", tag_prefix, tgt_image, access_granted),
                decoded_details: None,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        "11" => { // File Create
            let pid = get_sysmon_field(xml, "ProcessId").parse().unwrap_or(0);
            let image = get_sysmon_field(xml, "Image");
            let target = get_sysmon_field(xml, "TargetFilename");
            
            Some(AgentEvent {
                event_type: "FILE_CREATE".to_string(),
                process_id: pid,
                parent_process_id: 0,
                process_name: image,
                details: format!("{}SYSMON: File Created: {}", tag_prefix, target),
                decoded_details: None,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        "15" => { // FileCreateStreamHash (ADS)
            let pid = get_sysmon_field(xml, "ProcessId").parse().unwrap_or(0);
            let image = get_sysmon_field(xml, "Image");
            let target = get_sysmon_field(xml, "TargetFilename");

            Some(AgentEvent {
                event_type: "ADS_CREATED".to_string(),
                process_id: pid,
                parent_process_id: 0,
                process_name: image,
                details: format!("{}SYSMON: Alternate Data Stream: {}", tag_prefix, target),
                decoded_details: None,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        "22" => { // DNS Query
            let pid = get_sysmon_field(xml, "ProcessId").parse().unwrap_or(0);
            let image = get_sysmon_field(xml, "Image");
            let query = get_sysmon_field(xml, "QueryName");
            let result = get_sysmon_field(xml, "QueryResults");
            
            // Extract resolved IPs from QueryResults (e.g. "type: 1 142.250.217.68;...")
            let mut resolved_ips = Vec::new();
            for part in result.split(';') {
                let trimmed = part.trim();
                let segments: Vec<&str> = trimmed.split_whitespace().collect();
                if segments.len() >= 2 {
                    let last = segments.last().unwrap();
                    if last.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                         resolved_ips.push(*last);
                    }
                }
            }
            let ip_details = if resolved_ips.is_empty() { "".to_string() } else { format!(" | IPs: {}", resolved_ips.join(", ")) };

            Some(AgentEvent {
                event_type: "NETWORK_DNS".to_string(),
                process_id: pid,
                parent_process_id: 0,
                process_name: image,
                details: format!("{}SYSMON: DNS: {}{}", tag_prefix, query, ip_details),
                decoded_details: None,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        "25" => { // Process Tampering
            let pid = get_sysmon_field(xml, "ProcessId").parse().unwrap_or(0);
            let image = get_sysmon_field(xml, "Image");
            let type_ = get_sysmon_field(xml, "Type");

            Some(AgentEvent {
                event_type: "PROCESS_TAMPER".to_string(),
                process_id: pid,
                parent_process_id: 0,
                process_name: image,
                details: format!("{}SYSMON: Process Image Tampered! Type: {}", tag_prefix, type_),
                decoded_details: None,
                timestamp: chrono::Utc::now().timestamp_millis(),
                hostname: hostname.to_string(),
            })
        },
        _ => None
    }
}

unsafe fn monitor_sysmon(evt_tx: mpsc::UnboundedSender<AgentEvent>, hostname: String) {
    let session: EVT_HANDLE = std::ptr::null_mut();
    let signal_event = winapi::um::synchapi::CreateEventW(std::ptr::null_mut(), 0, 0, std::ptr::null_mut());
    
    let channel_path = wide_string("Microsoft-Windows-Sysmon/Operational");
    let query = wide_string("*");
    
    let subscription = EvtSubscribe(
        session,
        signal_event,
        channel_path.as_ptr() as *const _,
        query.as_ptr() as *const _,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        None, // Callback is an Option
        EvtSubscribeToFutureEvents
    );

    if subscription.is_null() {
        println!("[AGENT] Sysmon Subscription Failed. (Is Sysmon installed?)");
        return;
    }

    println!("[AGENT] Sysmon Real-time Telemetry Service started.");

    loop {
        winapi::um::synchapi::WaitForSingleObject(signal_event, winapi::um::winbase::INFINITE);
        
        let mut event_handle: EVT_HANDLE = std::ptr::null_mut();
        let mut returned = 0;
        
        while EvtNext(subscription, 1, &mut event_handle, 1000, 0, &mut returned) != 0 {
            // Render Event to XML
            let mut buffer_used = 0;
            let mut property_count = 0;
            EvtRender(std::ptr::null_mut(), event_handle, EvtRenderEventXml, 0, std::ptr::null_mut(), &mut buffer_used, &mut property_count);
            
            let mut buffer = vec![0u16; (buffer_used / 2 + 1) as usize];
            if EvtRender(std::ptr::null_mut(), event_handle, EvtRenderEventXml, buffer_used, buffer.as_mut_ptr() as *mut winapi::ctypes::c_void, &mut buffer_used, &mut property_count) != 0 {
                let xml = String::from_utf16_lossy(&buffer);
                // Try parsing
                if let Some(event) = parse_sysmon_xml(&xml, &hostname) {
                    let _ = evt_tx.send(event);
                } else {
                     // DEBUG: If we can't parse it, send it raw so we can see WHY
                     // Limit size to avoid giant payloads
                    let debug_xml = if xml.len() > 500 { format!("{}...", &xml[..500]) } else { xml.clone() };
                    let _ = evt_tx.send(AgentEvent {
                        event_type: "DEBUG_XML".to_string(),
                        process_id: 0,
                        parent_process_id: 0,
                        process_name: "AgentDebug".to_string(),
                        details: format!("Failed to parse Sysmon Event! Raw: {}", debug_xml),
                        decoded_details: None,
                        timestamp: chrono::Utc::now().timestamp_millis(),
                        hostname: hostname.to_string(),
                    });
                }
            }
            winapi::um::handleapi::CloseHandle(event_handle as *mut _);
        }
    }
}

unsafe fn get_registry_values(hive: HKEY, subkey: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let c_subkey = std::ffi::CString::new(subkey).unwrap();
    let mut hkey: HKEY = std::ptr::null_mut();

    if RegOpenKeyExA(hive, c_subkey.as_ptr(), 0, KEY_READ, &mut hkey) != 0 {
        return values;
    }

    let mut index = 0;
    loop {
        let mut name_buf = [0i8; 16383];
        let mut name_len = 16383;
        let mut type_code: DWORD = 0;
        let mut data_buf = [0u8; 16383];
        let mut data_len = 16383;

        let ret = RegEnumValueA(
            hkey,
            index,
            name_buf.as_mut_ptr(),
            &mut name_len,
            std::ptr::null_mut(),
            &mut type_code,
            data_buf.as_mut_ptr(),
            &mut data_len,
        );

        if ret != 0 { break; } // ERROR_NO_MORE_ITEMS

        // Parse Name
        let name_u8: Vec<u8> = name_buf[..name_len as usize].iter().map(|&c| c as u8).collect();
        let name = String::from_utf8_lossy(&name_u8).to_string();

        // Parse Data (only strings for now)
        if type_code == REG_SZ || type_code == REG_EXPAND_SZ {
            let actual_len = if data_len > 0 && data_buf[(data_len - 1) as usize] == 0 { data_len - 1 } else { data_len };
            let data_slice = &data_buf[..actual_len as usize];
            let data = String::from_utf8_lossy(data_slice).to_string();
            values.insert(name, data);
        }

        index += 1;
    }
    RegCloseKey(hkey);
    values
}

fn calculate_sha256(path: &Path) -> String {
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return "N/A".to_string(),
    };
    let mut hasher = Sha256::new();
    let mut buffer = [0; 4096];
    while let Ok(n) = file.read(&mut buffer) {
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    hex::encode(hasher.finalize())
}

fn take_and_upload_screenshot(backend_url: &str) {
    let screens = screenshots::Screen::all().unwrap_or_default();
    for (i, screen) in screens.iter().enumerate() {
        if let Ok(image) = screen.capture() {
            let mut buffer = Vec::new();
            let mut cursor = std::io::Cursor::new(&mut buffer);
            if image.write_to(&mut cursor, image::ImageOutputFormat::Png).is_ok() {
                let client = reqwest::blocking::Client::new();
                let form = reqwest::blocking::multipart::Form::new()
                    .part("file", reqwest::blocking::multipart::Part::bytes(buffer)
                        .file_name(format!("screenshot_screen{}_{}.png", i, chrono::Utc::now().timestamp()))
                        .mime_str("image/png").unwrap());
                
                let _ = client.post(format!("{}/vms/telemetry/screenshot", backend_url))
                    .multipart(form)
                    .send();
            }
        }
    }
}

fn get_dns_cache() -> HashSet<String> {
    let mut domains = HashSet::new();
    if let Ok(output) = std::process::Command::new("ipconfig").arg("/displaydns").output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.trim().starts_with("Record Name") {
                if let Some(domain) = line.split(':').nth(1) {
                    domains.insert(domain.trim().to_string());
                }
            }
        }
    }
    domains
}

#[derive(Serialize, Clone)]
struct AgentEvent {
    event_type: String,
    process_id: u32,
    parent_process_id: u32,
    process_name: String,
    details: String,
    decoded_details: Option<String>,
    timestamp: i64,
    hostname: String,
}

#[derive(Deserialize, Debug)]
struct AgentCommand {
    command: String,
    pid: Option<u32>,
    path: Option<String>,
    args: Option<Vec<String>>,
    url: Option<String>,
    filename: Option<String>,
}

async fn upload_pivot_file(backend_url: &str, path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let file_path = std::path::Path::new(path);
    if !file_path.exists() {
        println!("[AGENT] Pivot Error: File not found: {}", path);
        return Ok(());
    }

    let file_content = tokio::fs::read(file_path).await?;
    let part = reqwest::multipart::Part::bytes(file_content)
        .file_name(file_path.file_name().unwrap().to_str().unwrap().to_string());
    
    let form = reqwest::multipart::Form::new().part("file", part);
    
    let client = reqwest::Client::new();
    client.post(format!("{}/vms/telemetry/pivot-upload", backend_url))
        .multipart(form)
        .send()
        .await?;
        
    println!("[AGENT] Pivot file uploaded successfully.");
    Ok(())
}

#[derive(Deserialize, Debug)]
struct BrowserEvent {
    event_type: String,
    url: String,
    title: Option<String>,
    html_preview: Option<String>,
    source_url: Option<String>,
    target_url: Option<String>,
    status_code: Option<u16>,
    tab_id: Option<i32>,
}

async fn start_clipboard_monitor(evt_tx: mpsc::UnboundedSender<AgentEvent>, hostname: String) {
    use winapi::um::winuser::*;
    let mut last_clipboard_content = String::new();

    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        unsafe {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                let handle = GetClipboardData(CF_UNICODETEXT);
                if !handle.is_null() {
                    let ptr = GlobalLock(handle) as *const u16;
                    if !ptr.is_null() {
                        let mut len = 0;
                        while *ptr.add(len) != 0 {
                            len += 1;
                        }
                        let content = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
                        GlobalUnlock(handle);

                        if content != last_clipboard_content && !content.is_empty() {
                            let decodes = decoder::scan_and_decode(&content);
                            let decoded_details = if decodes.is_empty() { None } else {
                                Some(decodes.iter().map(|d| format!("[{}] {}", d.method, d.decoded)).collect::<Vec<_>>().join(" | "))
                            };

                            let _ = evt_tx.send(AgentEvent {
                                event_type: "CLIPBOARD_CAPTURE".to_string(),
                                process_id: 0,
                                parent_process_id: 0,
                                process_name: "System".to_string(),
                                details: format!("Clipboard Content: {}", if content.len() > 100 { format!("{}...", &content[..100]) } else { content.clone() }),
                                decoded_details,
                                timestamp: chrono::Utc::now().timestamp_millis(),
                                hostname: hostname.clone(),
                            });
                            last_clipboard_content = content;
                        }
                    }
                }
                CloseClipboard();
            }
        }
    }
}

async fn start_browser_listener(evt_tx: mpsc::UnboundedSender<AgentEvent>, hostname: String) {
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:1337").await {
        Ok(l) => l,
        Err(e) => {
            println!("[AGENT] Failed to bind Browser Listener: {}", e);
            return;
        }
    };

    println!("[AGENT] Browser Telemetry Listener active on 127.0.0.1:1337");

    loop {
        if let Ok((mut socket, _)) = listener.accept().await {
            let tx = evt_tx.clone();
            let h_name = hostname.clone();
            
            tokio::spawn(async move {
                let mut buf = [0; 1024 * 64]; // 64KB buffer for large DOMs
                match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => {
                        let req = String::from_utf8_lossy(&buf[..n]);
                        
                        // Very basic HTTP parsing meant ONLY for this extension
                        // We expect: POST /telemetry/browser ... \r\n\r\n{JSON}
                        if let Some(body_start) = req.find("\r\n\r\n") {
                            let body = &req[body_start+4..];
                            // Handle Content-Length if needed, but for now try direct parse
                            // Clean up null bytes if any
                            let clean_body = body.trim_matches(char::from(0));
                            
                            if let Ok(browser_evt) = serde_json::from_str::<BrowserEvent>(clean_body) {
                                // Map to AgentEvent
                                let details = match browser_evt.event_type.as_str() {
                                    "BROWSER_NAVIGATE" => format!("URL: {} | Title: {}", browser_evt.url, browser_evt.title.unwrap_or_default()),
                                    "BROWSER_REDIRECT" => format!("REDIRECT: {} -> {} ({})", browser_evt.source_url.unwrap_or_default(), browser_evt.target_url.unwrap_or_default(), browser_evt.status_code.unwrap_or(0)),
                                    "BROWSER_DOM" => format!("DOM SNAPSHOT: {} (Preview: {}...)", browser_evt.url, browser_evt.html_preview.as_deref().unwrap_or("").chars().take(100).collect::<String>()),
                                    _ => format!("Unknown Browser Event: {:?}", browser_evt)
                                };

                                let mut decoded_details = None;
                                
                                // Scan details for encoded data
                                let decodes = decoder::scan_and_decode(&details);
                                if !decodes.is_empty() {
                                    decoded_details = Some(decodes.iter().map(|d| format!("[{}] {}", d.method, d.decoded)).collect::<Vec<_>>().join(" | "));
                                }

                                // For DOM events, also pass the (potentially large) HTML preview as decoded context
                                if browser_evt.event_type == "BROWSER_DOM" {
                                    if let Some(html) = &browser_evt.html_preview {
                                         // Scan HTML for encoded data as well
                                         let html_decodes = decoder::scan_and_decode(html);
                                         let mut combined = html.clone();
                                         if !html_decodes.is_empty() {
                                             let dec_str = html_decodes.iter().map(|d| format!("[{}] {}", d.method, d.decoded)).collect::<Vec<_>>().join(" | ");
                                             combined = format!("DECODED DATA FOUND IN DOM: {}\n\nFULL DOM PREVIEW:\n{}", dec_str, html);
                                         }
                                         
                                         // Append to any existing decoded_details
                                         if let Some(existing) = decoded_details {
                                             decoded_details = Some(format!("{}\n\n{}", existing, combined));
                                         } else {
                                             decoded_details = Some(combined);
                                         }
                                    }
                                }

                                let _ = tx.send(AgentEvent {
                                    event_type: browser_evt.event_type,
                                    process_id: 0, 
                                    parent_process_id: 0,
                                    process_name: "chrome.exe".to_string(), // Assumed
                                    details,
                                    decoded_details,
                                    timestamp: chrono::Utc::now().timestamp_millis(),
                                    hostname: h_name,
                                });

                                // Send 200 OK
                                let response = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n";
                                let _ = socket.write_all(response.as_bytes()).await;
                            } else {
                                // println!("[AGENT] Failed to json parse browser event body: {}", clean_body);
                            }
                        }
                    },
                    _ => {}
                }
            });
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Mallab Windows Agent (Active Eye) - v3.0.0");
    
    let addr = std::env::var("AGENT_SERVER_ADDR").unwrap_or_else(|_| "192.168.50.11:9001".to_string());
    let mut stream = TcpStream::connect(&addr).await?;
    println!("Connected to Hyper-Bridge @ {}", addr);

    let host_ip = addr.split(':').next().unwrap_or("192.168.50.11");
    let backend_url = format!("http://{}:8080", host_ip);

    // Try to open Kernel Bridge
    let k_bridge = kernel_bridge::KernelBridge::new();
    if k_bridge.is_some() {
        println!("SUCCESS: Kernel Anti-Tamper Bridge established.");
        let pid = std::process::id();
        k_bridge.as_ref().unwrap().protect_process(pid);
    }

    let mut sys = System::new_all();
    let mut known_pids: HashSet<u32> = sys.processes().keys().map(|&p| p.as_u32()).collect();

    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-vm".to_string());
    println!("[AGENT] Identity: {}", hostname);

    let (evt_tx, mut evt_rx) = mpsc::unbounded_channel::<AgentEvent>();

    // Send Init Event
    let _ = evt_tx.send(AgentEvent {
        event_type: "SESSION_INIT".to_string(),
        process_id: std::process::id(),
        parent_process_id: 0,
        process_name: "mallab-agent".to_string(),
        details: format!("Agent initialized and ready. Computer: {}", hostname),
        decoded_details: None,
        timestamp: chrono::Utc::now().timestamp_millis(),
        hostname: hostname.clone(),
    });

    // 2. Sysmon Telemetry (Enhanced)
    let tx_sysmon = evt_tx.clone();
    let hostname_sysmon = hostname.clone();
    std::thread::spawn(move || {
        unsafe { monitor_sysmon(tx_sysmon, hostname_sysmon); }
    });

    // 3. Browser Telemetry Listener (Port 1337)
    let tx_browser = evt_tx.clone();
    let hostname_browser = hostname.clone();
    tokio::spawn(async move {
        start_browser_listener(tx_browser, hostname_browser).await;
    });

    // 4. Clipboard Monitoring
    let tx_cb = evt_tx.clone();
    let hostname_cb = hostname.clone();
    tokio::spawn(async move {
        start_clipboard_monitor(tx_cb, hostname_cb).await;
    });

    // 1. File System Watcher with Hashing
    let tx_fs = evt_tx.clone();
    let hostname_fs = hostname.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if let Some(path) = event.paths.first() {
                if event.kind.is_create() || event.kind.is_modify() {
                    let hash = calculate_sha256(path);
                    let path_str = path.to_string_lossy().to_string();
                    let is_executable = [".exe", ".msi", ".ps1", ".vbs", ".js", ".bat", ".com"]
                        .iter().any(|ext| path_str.to_lowercase().ends_with(ext));
                    
                    let is_download_path = path_str.to_lowercase().contains("downloads");

                    let event_type = if is_executable && is_download_path && event.kind.is_create() {
                        "DOWNLOAD_DETECTED".to_string()
                    } else {
                        format!("FILE_{:?}", event.kind).to_uppercase()
                    };

                    let _ = tx_fs.send(AgentEvent {
                        event_type,
                        process_id: 0,
                        parent_process_id: 0,
                        process_name: "Explorer/System".to_string(),
                        details: format!("File Activity: {} (SHA256: {})", path.display(), hash),
                        decoded_details: None,
                        timestamp: chrono::Utc::now().timestamp_millis(),
                        hostname: hostname_fs.clone(),
                    });
                }
            }
        }
    })?;

    let mut watch_paths = vec![
        "C:\\Windows\\Temp".to_string(), 
        "C:\\Users\\Public\\Downloads".to_string(), 
        "C:\\Users\\Public".to_string()
    ];

    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        watch_paths.push(format!("{}\\Downloads", user_profile));
        watch_paths.push(format!("{}\\AppData\\Local\\Temp", user_profile));
    }

    for p in watch_paths {
        if std::path::Path::new(&p).exists() {
            let _ = watcher.watch(std::path::Path::new(&p), RecursiveMode::Recursive);
        }
    }

    // Registry Keys to Monitor for Persistence
    let reg_keys = vec![
        "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
    ];

    let mut buf = [0u8; 4096];
    let mut screenshot_iter = 0;
    let mut registry_state: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut dns_state: HashSet<String> = get_dns_cache(); // Initialize with baseline

    loop {
        tokio::select! {
            // Commands from Backend
            n = stream.read(&mut buf) => {
                match n {
                    Ok(0) => break,
                    Ok(n) => {
                        let raw = String::from_utf8_lossy(&buf[..n]);
                        for line in raw.lines() {
                            if let Ok(cmd) = serde_json::from_str::<AgentCommand>(line) {
                                match cmd.command.as_str() {
                                    "KILL" => {
                                        if let Some(pid) = cmd.pid {
                                            if let Some(process) = sys.process(sysinfo::Pid::from(pid as usize)) {
                                                process.kill();
                                            }
                                        }
                                    },
                                    "EXEC_BINARY" => {
                                        if let Some(path) = cmd.path {
                                            let mut proc = std::process::Command::new(&path);
                                            if let Some(args) = cmd.args {
                                                proc.args(args);
                                            }
                                            match proc.spawn() {
                                                Ok(child) => {
                                                    let _ = evt_tx.send(AgentEvent {
                                                        event_type: "EXEC_SUCCESS".to_string(),
                                                        process_id: child.id(),
                                                        parent_process_id: std::process::id(),
                                                        process_name: path,
                                                        details: "Binary execution started via remote command".to_string(),
                                                        decoded_details: None,
                                                        timestamp: chrono::Utc::now().timestamp_millis(),
                                                        hostname: hostname.clone(),
                                                    });
                                                }
                                                Err(e) => {
                                                    let _ = evt_tx.send(AgentEvent {
                                                        event_type: "EXEC_ERROR".to_string(),
                                                        process_id: 0,
                                                        parent_process_id: 0,
                                                        process_name: path,
                                                        details: format!("Failed to execute binary: {}", e),
                                                        decoded_details: None,
                                                        timestamp: chrono::Utc::now().timestamp_millis(),
                                                        hostname: hostname.clone(),
                                                    });
                                                }
                                            }
                                        }
                                    },

                                    "EXEC_URL" => {
                                        if let Some(url) = cmd.url {
                                            // Windows-specific way to open URL in default browser
                                            let _ = std::process::Command::new("cmd")
                                                .args(&["/C", "start", "", &url])
                                                .spawn();
                                            
                                            let _ = evt_tx.send(AgentEvent {
                                                event_type: "URL_OPEN".to_string(),
                                                process_id: 0,
                                                parent_process_id: 0,
                                                process_name: "Web Browser".to_string(),
                                                details: format!("Opening URL: {}", url),
                                                decoded_details: None,
                                                timestamp: chrono::Utc::now().timestamp_millis(),
                                                hostname: hostname.clone(),
                                            });
                                        }
                                    },
                                    "SCREENSHOT" => {
                                        take_and_upload_screenshot(&backend_url);
                                    },
                                    "UPLOAD_PIVOT" => {
                                        if let Some(path) = cmd.path {
                                            let b_url = backend_url.clone();
                                            tokio::spawn(async move {
                                                let _ = upload_pivot_file(&b_url, &path).await;
                                            });
                                        }
                                    },
                                    "DOWNLOAD_EXEC" => {
                                        if let Some(url) = cmd.url {
                                            println!("Downloading sample from: {}", url);
                                            let safe_filename = cmd.filename.unwrap_or_else(|| format!("sample_{}.exe", chrono::Utc::now().timestamp()));
                                            let dest_path = format!("C:\\Users\\Public\\{}", safe_filename);
                                            
                                            let dest_path_clone = dest_path.clone();
                                            let url_clone = url.clone();
                                            let tx_dl = evt_tx.clone();
                                            let hostname_dl = hostname.clone();
                                            
                                            std::thread::spawn(move || {
                                                // 1. Attempts Download
                                                let download_success = match reqwest::blocking::get(&url_clone) {
                                                    Ok(mut response) => {
                                                        println!("[AGENT] Download connection established to {}", url_clone);
                                                        match std::fs::File::create(&dest_path_clone) {
                                                            Ok(mut file) => {
                                                                if let Err(e) = response.copy_to(&mut file) {
                                                                    println!("[AGENT] ERROR: Failed to write download content: {}", e);
                                                                    let _ = tx_dl.send(AgentEvent {
                                                                        event_type: "DOWNLOAD_ERROR".to_string(),
                                                                        process_id: 0,
                                                                        parent_process_id: 0,
                                                                        process_name: "Agent".to_string(),
                                                                        details: format!("Failed to write file: {}", e),
                                                                        decoded_details: None,
                                                                        timestamp: chrono::Utc::now().timestamp_millis(),
                                                                        hostname: hostname_dl.clone(),
                                                                    });
                                                                    false
                                                                } else {
                                                                    println!("[AGENT] SUCCESS: File downloaded to {}", dest_path_clone);
                                                                    // Ensure data is flushed to disk before closing
                                                                    let _ = file.sync_all();
                                                                    drop(file); // explicit drop
                                                                    std::thread::sleep(std::time::Duration::from_millis(500));
                                                                    true
                                                                }
                                                            },
                                                            Err(e) => {
                                                                println!("[AGENT] ERROR: Failed to create file at {}: {}", dest_path_clone, e);
                                                                let _ = tx_dl.send(AgentEvent {
                                                                    event_type: "DOWNLOAD_ERROR".to_string(),
                                                                    process_id: 0,
                                                                    parent_process_id: 0,
                                                                    process_name: "Agent".to_string(),
                                                                    details: format!("Failed to create file: {}", e),
                                                                    decoded_details: None,
                                                                    timestamp: chrono::Utc::now().timestamp_millis(),
                                                                    hostname: hostname_dl.clone(),
                                                                });
                                                                false
                                                            }
                                                        }
                                                    },
                                                    Err(e) => {
                                                        println!("[AGENT] ERROR: Network request failed for {}: {}", url_clone, e);
                                                        let _ = tx_dl.send(AgentEvent {
                                                            event_type: "DOWNLOAD_ERROR".to_string(),
                                                            process_id: 0,
                                                            parent_process_id: 0,
                                                            process_name: "Agent".to_string(),
                                                            details: format!("Network Request Failed: {}", e),
                                                            decoded_details: None,
                                                            timestamp: chrono::Utc::now().timestamp_millis(),
                                                            hostname: hostname_dl.clone(),
                                                        });
                                                        false
                                                    }
                                                };

                                                if download_success {
                                                            // 2. Explicit Verification
                                                            if std::path::Path::new(&dest_path_clone).exists() {
                                                                println!("[AGENT] File verified on disk: {}", dest_path_clone);
                                                                let _ = tx_dl.send(AgentEvent {
                                                                    event_type: "FILE_VERIFIED".to_string(),
                                                                    process_id: 0,
                                                                    parent_process_id: 0,
                                                                    process_name: dest_path_clone.clone(),
                                                                    details: "INTEGRITY: File verified on disk. Starting detonation.".to_string(),
                                                                    decoded_details: None,
                                                                    timestamp: chrono::Utc::now().timestamp_millis(),
                                                                    hostname: hostname_dl.clone(),
                                                                });

                                                                // 3. Detonate with Multi-Stage Logic
                                                                let mut success = false;
                                                                
                                                                // Strategy A: Direct Execution (Retry loop for locking)
                                                                println!("[AGENT] Attempting Strategy A: Direct Execution...");
                                                                for attempt in 0..5 {
                                                                    match std::process::Command::new(&dest_path_clone).spawn() {
                                                                        Ok(child) => {
                                                                            println!("[AGENT] Strategy A Successful! PID: {}", child.id());
                                                                            let _ = tx_dl.send(AgentEvent {
                                                                                event_type: "EXEC_SUCCESS".to_string(),
                                                                                process_id: child.id(),
                                                                                parent_process_id: std::process::id(),
                                                                                process_name: dest_path_clone.clone(),
                                                                                details: format!("Binary executed via Strategy A (Direct) - attempt {}", attempt + 1),
                                                                                timestamp: chrono::Utc::now().timestamp_millis(),
                                                                                hostname: hostname_dl.clone(),
                                                                            });
                                                                            success = true;
                                                                            break;
                                                                        },
                                                                        Err(e) => {
                                                                            println!("[AGENT] Strategy A (Attempt {}) Failed: {}", attempt + 1, e);
                                                                            if e.raw_os_error() == Some(32) && attempt < 4 {
                                                                                std::thread::sleep(std::time::Duration::from_millis(1000));
                                                                            }
                                                                        }
                                                                    }
                                                                }

                                                                // Strategy B: CMD Wrapper Fallback
                                                                if !success {
                                                                    println!("[AGENT] Strategy A Failed. Attempting Strategy B: CMD Wrapper...");
                                                                    match std::process::Command::new("cmd")
                                                                        .args(&["/C", "start", "", &dest_path_clone])
                                                                        .spawn() 
                                                                    {
                                                                        Ok(child) => {
                                                                            println!("[AGENT] Strategy B Successful! PID: {}", child.id());
                                                                            let _ = tx_dl.send(AgentEvent {
                                                                                event_type: "EXEC_SUCCESS".to_string(),
                                                                                process_id: child.id(),
                                                                                parent_process_id: std::process::id(),
                                                                                process_name: dest_path_clone.clone(),
                                                                                details: "Binary executed via Strategy B (CMD Wrapper)".to_string(),
                                                                                timestamp: chrono::Utc::now().timestamp_millis(),
                                                                                hostname: hostname_dl.clone(),
                                                                            });
                                                                            success = true;
                                                                        },
                                                                        Err(e) => {
                                                                            println!("[AGENT] Strategy B Failed: {}", e);
                                                                            let _ = tx_dl.send(AgentEvent {
                                                                                event_type: "EXEC_ERROR".to_string(),
                                                                                process_id: 0,
                                                                                parent_process_id: 0,
                                                                                process_name: dest_path_clone.clone(),
                                                                                details: format!("Failed all execution strategies. Last error: {}", e),
                                                                                timestamp: chrono::Utc::now().timestamp_millis(),
                                                                                hostname: hostname_dl.clone(),
                                                                            });
                                                                        }
                                                                    }
                                                                }
                                                            } else {
                                                                println!("[AGENT] CRITICAL: File missing after download verification!");
                                                            }
                                                } // Closes `if download_success`
                                            }); // Closes `std::thread::spawn`
                                        } // Closes `if let Some(url) = cmd.url`
                                    }, // Closes the "DOWNLOAD_EXEC" match arm
                                    _ => println!("Unknown command: {}", cmd.command),
                                }
                            }
                        }
                    }
                    Err(_) => break,
                }
            }

            // Events from threads (FS/Memory/Commands)
            Some(evt) = evt_rx.recv() => {
                let msg = serde_json::to_string(&evt)? + "\n";
                let _ = stream.write_all(msg.as_bytes()).await;
            }

            // Periodic Scans (Process + Network + Memory + Registry)
            _ = tokio::time::sleep(Duration::from_secs(5)) => {
                sys.refresh_processes();
                let current_pids: HashSet<u32> = sys.processes().keys().map(|&p| p.as_u32()).collect();

                // 1. Memory Forensic Scan (for existing processes)
                for &pid in &current_pids {
                    if let Ok(true) = mem_utils::scan_process_hollowing(pid) {
                        let dump_path = format!("C:\\Users\\Public\\dump_{}.bin", pid);
                        let dump_msg = match mem_utils::dump_process_memory(pid, &dump_path) {
                            Ok(_) => format!("Process Hollowing detected! Memory headers do not match disk image. Dump saved to {}.", dump_path),
                            Err(e) => format!("Process Hollowing detected! Memory headers do not match disk image. (Dump failed: {})", e),
                        };

                        let _ = evt_tx.send(AgentEvent {
                            event_type: "MEMORY_ANOMALY".to_string(),
                            process_id: pid,
                            parent_process_id: 0,
                            process_name: sys.process(sysinfo::Pid::from(pid as usize)).map(|p| p.name()).unwrap_or("Unknown").to_string(),
                            details: dump_msg,
                            decoded_details: None,
                            timestamp: chrono::Utc::now().timestamp_millis(),
                            hostname: hostname.clone(),
                        });
                    }
                }

                // 2. Process Lifecycle
                for &pid in current_pids.difference(&known_pids) {
                    if let Some(p) = sys.process(sysinfo::Pid::from(pid as usize)) {
                        let event = AgentEvent {
                            event_type: "PROCESS_CREATE".to_string(),
                            process_id: pid,
                            parent_process_id: p.parent().map(|p| p.as_u32()).unwrap_or(0),
                            process_name: p.name().to_string(),
                            details: format!("New process: {} Cmd: {:?} (SHA256: {})", p.exe().display(), p.cmd(), calculate_sha256(p.exe())),
                            decoded_details: None,
                            timestamp: chrono::Utc::now().timestamp_millis(),
                            hostname: hostname.clone(),
                        };
                        let _ = evt_tx.send(event);
                    }
                }

                // 3. Registry Persistence Check
                let hives = vec![(HKEY_CURRENT_USER, "HKCU"), (HKEY_LOCAL_MACHINE, "HKLM")];
                for (hive, hive_name) in hives {
                    for subkey in &reg_keys {
                        let full_key_path = format!("{}\\{}", hive_name, subkey);
                        let current_values = unsafe { get_registry_values(hive, subkey) };
                        
                        // Check for changes if we have a baseline
                        if let Some(old_values) = registry_state.get(&full_key_path) {
                            for (name, data) in &current_values {
                                if let Some(old_data) = old_values.get(name) {
                                    if old_data != data {
                                        // MODIFIED
                                        let _ = evt_tx.send(AgentEvent {
                                            event_type: "REGISTRY_SET".to_string(),
                                            process_id: 0,
                                            parent_process_id: 0,
                                            process_name: "Registry".to_string(),
                                            details: format!("Registry Modified: {}\\{} Value: '{}' New Data: '{}' (Old: '{}')", hive_name, subkey, name, data, old_data),
                                            decoded_details: None,
                                            timestamp: chrono::Utc::now().timestamp_millis(),
                                            hostname: hostname.clone(),
                                        });
                                    }
                                } else {
                                    // ADDED
                                    let _ = evt_tx.send(AgentEvent {
                                        event_type: "REGISTRY_SET".to_string(),
                                        process_id: 0,
                                        parent_process_id: 0,
                                        process_name: "Registry".to_string(),
                                        details: format!("Registry Added: {}\\{} Value: '{}' Data: '{}'", hive_name, subkey, name, data),
                                        decoded_details: None,
                                        timestamp: chrono::Utc::now().timestamp_millis(),
                                        hostname: hostname.clone(),
                                    });
                                }
                            }
                            // Detect Deleted
                             for (name, old_data) in old_values {
                                if !current_values.contains_key(name) {
                                    let _ = evt_tx.send(AgentEvent {
                                        event_type: "REGISTRY_SET".to_string(),
                                        process_id: 0,
                                        parent_process_id: 0,
                                        process_name: "Registry".to_string(),
                                        details: format!("Registry Deleted: {}\\{} Value: '{}' (Was: '{}')", hive_name, subkey, name, old_data),
                                        decoded_details: None,
                                        timestamp: chrono::Utc::now().timestamp_millis(),
                                        hostname: hostname.clone(),
                                    });
                                }
                             }
                        } else {
                            // Initial baseline - do not alert, just store
                            // Or optionally specific "Baseline detected" log if needed
                        }
                        
                        registry_state.insert(full_key_path, current_values);
                    }
                }

                // 4. Network Scan
                let af = netstat2::AddressFamilyFlags::IPV4;
                let proto = netstat2::ProtocolFlags::TCP;
                if let Ok(sockets) = netstat2::get_sockets_info(af, proto) {
                    for s in sockets {
                        if let Some(&pid) = s.associated_pids.first() {
                            if let netstat2::ProtocolSocketInfo::Tcp(tcp_info) = s.protocol_socket_info {
                                // tcp_info.remote_addr is an IpAddr, not SocketAddr
                                let remote_ip = tcp_info.remote_addr;
                                let remote_port = tcp_info.remote_port;
                                
                                if remote_port == 0 { continue; }

                                let is_lat_mov = matches!(remote_port, 3389 | 445 | 5985 | 5986 | 135);
                                let event_type = if is_lat_mov { "LATERAL_MOVEMENT" } else { "NETWORK_CONNECT" };
                                
                                let _ = evt_tx.send(AgentEvent {
                                    event_type: event_type.to_string(),
                                    process_id: pid,
                                    parent_process_id: 0,
                                    process_name: sys.process(sysinfo::Pid::from(pid as usize)).map(|p| p.name()).unwrap_or("Unknown").to_string(),
                                    details: format!("TCP {}:{} -> {}:{} {}", tcp_info.local_addr, tcp_info.local_port, remote_ip, remote_port, if is_lat_mov { "[CRITICAL HOP]" } else { "" }),
                                    decoded_details: None,
                                    timestamp: chrono::Utc::now().timestamp_millis(),
                                    hostname: hostname.clone(),
                                });
                            }
                        }
                    }
                }

                // 5. DNS Cache Telemetry (Domains/URLs)
                let current_dns = get_dns_cache();
                for domain in current_dns.difference(&dns_state) {
                    // Filter noisy domains only if needed, or send all new ones
                    if !domain.is_empty() && !domain.contains("localhost") {
                        let _ = evt_tx.send(AgentEvent {
                            event_type: "NETWORK_DNS".to_string(),
                            process_id: 0,
                            parent_process_id: 0,
                            process_name: "DNS".to_string(),
                            details: format!("DNS Query Resolved: {}", domain),
                            decoded_details: None,
                            timestamp: chrono::Utc::now().timestamp_millis(),
                            hostname: hostname.clone(),
                        });
                    }
                }
                dns_state = current_dns;

                // 6. Periodic Screenshot (every 30s approx, assuming 5s loop)
                screenshot_iter += 1;
                if screenshot_iter >= 6 {
                    take_and_upload_screenshot(&backend_url);
                    screenshot_iter = 0;
                }

                // 6. Cleanup
                known_pids = current_pids;
            }
        }
    }
    Ok(())
}
