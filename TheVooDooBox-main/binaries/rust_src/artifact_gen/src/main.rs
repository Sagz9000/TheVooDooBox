use std::fs;
use std::process::Command;

fn main() {
    println!("[*] Starting ArtifactGen (HTA/LNK) Simulation (Rust)...");

    generate_hta();
    generate_lnk();

    println!("[*] Simulation Finished.");
}

fn generate_hta() {
    let path = "simulation_rust.hta";
    let content = r#"
<html>
<head>
    <title>VoodooBox Rust Simulation</title>
    <hta:application id="oHTA" applicationname="VoodooRust" border="thin" />
    <script language="VBScript">
        Sub Window_OnLoad
            MsgBox "VoodooBox Rust HTA Simulation Executed!"
            Set shell = CreateObject("WScript.Shell")
            shell.Run "calc.exe"
            ' self.close()
        End Sub
    </script>
</head>
<body>
    <h2>HTA Payload Simulation (Rust Generated)</h2>
</body>
</html>"#;
    match fs::write(path, content) {
        Ok(_) => println!("[+] Generated: {}", path),
        Err(e) => println!("[!] Error generating HTA: {}", e),
    }
}

fn generate_lnk() {
    let path = "malicious_link_rust.lnk";
    let full_path = std::env::current_dir().unwrap().join(path);
    let ps_script = format!(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='cmd.exe';$s.Arguments='/c notepad.exe';$s.Save()",
        full_path.to_str().unwrap()
    );

    match Command::new("powershell.exe")
        .args(["-Command", &ps_script])
        .spawn() {
            Ok(mut child) => {
                let _ = child.wait();
                println!("[+] Generated: {} (via PowerShell bridge)", path);
            },
            Err(e) => println!("[!] Error generating LNK: {}", e),
        }
}
