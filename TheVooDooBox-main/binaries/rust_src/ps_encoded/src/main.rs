use std::process::Command;
use base64::{Engine as _, engine::general_purpose};

fn main() {
    println!("[*] Starting PsEncoded Simulation (Rust)...");

    // Command: Write-Host 'VoodooBox Malicious Simulation Executed (Rust)'; Start-Sleep -s 2
    let script = "Write-Host 'VoodooBox Malicious Simulation Executed (Rust)'; Start-Sleep -s 2";
    
    // PowerShell -EncodedCommand expects UTF-16LE
    let utf16_bytes: Vec<u8> = script.encode_utf16()
        .flat_map(|c| c.to_le_bytes().to_vec())
        .collect();
    
    let encoded_command = general_purpose::STANDARD.encode(&utf16_bytes);

    println!("[*] Launching powershell.exe...");
    match Command::new("powershell.exe")
        .args(["-EncodedCommand", &encoded_command])
        .spawn() {
            Ok(mut child) => {
                println!("[*] Launched powershell.exe with PID: {}", child.id());
                let _ = child.wait();
            },
            Err(e) => println!("[!] Error: {}", e),
        }

    println!("[*] Simulation Finished.");
}
