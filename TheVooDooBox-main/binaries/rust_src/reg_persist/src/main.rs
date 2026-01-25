use std::thread;
use std::time::Duration;
use winreg::enums::*;
use winreg::RegKey;

fn main() {
    println!("[*] Starting RegPersist Simulation (Rust)...");

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    let key_name = "VoodooBoxRustPersistence";
    let exe_path = std::env::current_exe().unwrap_or_else(|_| "C:\\Windows\\System32\\calc.exe".into());

    match hkcu.open_subkey_with_flags(path, KEY_ALL_ACCESS) {
        Ok(run_key) => {
            println!("[*] Setting registry key HKCU...\\Run\\{}", key_name);
            match run_key.set_value(key_name, &exe_path.to_str().unwrap_or("calc.exe")) {
                Ok(_) => {
                    println!("[+] Key set successfully.");
                    thread::sleep(Duration::from_secs(3));
                    
                    println!("[*] Cleaning up registry key...");
                    let _ = run_key.delete_value(key_name);
                    println!("[+] Key deleted.");
                },
                Err(e) => println!("[!] Error setting value: {}", e),
            }
        },
        Err(e) => println!("[!] Error opening subkey: {}", e),
    }

    println!("[*] Simulation Finished.");
}
