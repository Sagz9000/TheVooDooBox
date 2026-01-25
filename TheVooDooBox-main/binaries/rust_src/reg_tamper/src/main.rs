use std::thread;
use std::time::Duration;
use winreg::enums::*;
use winreg::RegKey;

fn main() {
    println!("[*] Starting RegTamper Simulation (Rust)...");

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";
    let value_name = "Hidden";

    match hkcu.open_subkey_with_flags(path, KEY_ALL_ACCESS) {
        Ok(explorer_key) => {
            let original_value: u32 = explorer_key.get_value(value_name).unwrap_or(1);
            println!("[*] Tampering with ...\\Explorer\\Advanced\\{}", value_name);
            
            // Set to 2 (Don't show hidden files)
            match explorer_key.set_value(value_name, &2u32) {
                Ok(_) => {
                    println!("[+] Value set to 2.");
                    thread::sleep(Duration::from_secs(3));
                    
                    println!("[*] Restoring original value...");
                    let _ = explorer_key.set_value(value_name, &original_value);
                    println!("[+] Restored.");
                },
                Err(e) => println!("[!] Error setting value: {}", e),
            }
        },
        Err(e) => println!("[!] Error opening subkey: {}", e),
    }

    println!("[*] Simulation Finished.");
}
