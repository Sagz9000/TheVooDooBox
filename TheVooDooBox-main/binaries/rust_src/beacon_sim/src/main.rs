use std::thread;
use std::time::Duration;

fn main() {
    println!("[*] Starting BeaconSim (Network Telemetry) Simulation (Rust)...");
    println!("[*] Will perform 5 beacons with 2s interval.");

    for i in 1..=5 {
        println!("[*] Beacon {}/5 sent to 'http://example.com'...", i);
        match ureq::get("http://example.com").call() {
            Ok(response) => println!("[+] Response Code: {}", response.status()),
            Err(e) => println!("[!] Request failed (expected in isolated labs): {}", e),
        }

        if i < 5 {
            thread::sleep(Duration::from_secs(2));
        }
    }

    println!("[*] Simulation Finished.");
}
