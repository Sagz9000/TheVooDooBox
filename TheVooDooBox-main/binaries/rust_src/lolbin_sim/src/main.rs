use std::process::Command;
use std::fs;

fn main() {
    println!("[*] Starting LolBinSim (Certutil) Simulation (Rust)...");

    let target_url = "https://raw.githubusercontent.com/Sagz9000/TheVooDooBox/main/README.md";
    let output_path = "voodootest_rust.txt";

    println!("[*] Launching certutil.exe...");
    match Command::new("certutil.exe")
        .args(["-urlcache", "-split", "-f", target_url, output_path])
        .spawn() {
            Ok(mut child) => {
                println!("[*] Launched certutil.exe with PID: {}", child.id());
                let _ = child.wait();
            },
            Err(e) => println!("[!] Error: {}", e),
        }

    if std::path::Path::new(output_path).exists() {
        println!("[+] File '{}' successfully 'downloaded'.", output_path);
        let _ = fs::remove_file(output_path);
        println!("[*] Cleaned up test file.");
    }

    println!("[*] Simulation Finished.");
}
