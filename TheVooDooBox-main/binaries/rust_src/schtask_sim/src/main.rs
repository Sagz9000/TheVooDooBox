use std::process::Command;
use std::thread;
use std::time::Duration;

fn main() {
    println!("[*] Starting SchTaskSim (Scheduled Task) Simulation (Rust)...");

    let task_name = "VoodooBoxRustTaskTest";
    let task_action = "calc.exe";

    println!("[*] Creating task: {}", task_name);
    let _ = Command::new("schtasks.exe")
        .args(["/Create", "/SC", "ONCE", "/TN", task_name, "/TR", task_action, "/ST", "23:59", "/F"])
        .status();

    thread::sleep(Duration::from_secs(3));

    println!("[*] Deleting task: {}", task_name);
    let _ = Command::new("schtasks.exe")
        .args(["/Delete", "/TN", task_name, "/F"])
        .status();

    println!("[*] Simulation Finished.");
}
