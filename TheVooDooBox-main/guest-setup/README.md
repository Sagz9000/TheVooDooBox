# 🧪 Mallab V3 Sandbox Scripts

This directory contains the essential scripts for preparing a Windows VM for malware analysis within the Mallab V3 ecosystem.

## 🚀 Quick Start

To fully provision a new Windows VM:

1.  Open **PowerShell as Administrator**.
2.  Navigate to this directory.
3.  Run the bootstrap script:
    ```powershell
    .\bootstrap.ps1
    ```

## 📜 Script Overview

| Script | Description |
| :--- | :--- |
| `bootstrap.ps1` | **The Master Script.** Runs all other scripts in the correct order. |
| `configure_security.ps1` | Disables Windows Defender, Updates, Firewall, UAC, and Telemetry. |
| `install_flarevm.ps1` | Performs a silent, automated installation of Mandiant's FlareVM. |
| `deploy_agent.ps1` | Installs Python and the Mallab communication agent. |

## 🛠️ Post-Installation

Once the scripts complete (usually after 1-3 hours and several reboots):

1.  Verify the `MallabAgent` is running (should be a background `pythonw.exe` process).
2.  Check that the agent is listening on port `8000`.
3.  **IMPORTANT:** Shut down the VM and take a clean snapshot in Proxmox. This is your "Base Analysis State".

## ⚠️ Safety Warning

These scripts **DESTROY** the security of the target Windows machine. Use them **ONLY** inside an isolated Virtual Machine environment.
