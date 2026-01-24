# Supporting Scripts

TheVooDooBox comes with a toolkit of scripts to assist with building, deploying, and debugging.

## Core Scripts (`/scripts`)

These scripts run on your development machine or the host server.

### `build_agent.ps1`
*   **Usage**: `.\scripts\build_agent.ps1 [-BuildType release]`
*   **Purpose**: Cross-compiles the Rust agent for Windows using `cargo`. Requires the `x86_64-pc-windows-msvc` target.

### `proxmox_setup_win.sh`
*   **Usage**: `bash scripts/proxmox_setup_win.sh`
*   **Purpose**: Interactive wizard to create a new "Gold Standard" Windows VM in Proxmox with optimal settings (VirtIO, QEMU Agent, correct BIOS type).

### `diagnose_agent.ps1`
*   **Usage**: `.\scripts\diagnose_agent.ps1`
*   **Purpose**: A health-check tool. Connects to the backend, checks Docker container status, verifies VM connectivity, and ensures the API is responding.

## Sandbox Scripts (`/sandbox_scripts`)

These scripts are intended to run **inside** the Guest VM.

### `install_agent.ps1`
*   **Purpose**: The primary installer. Creates `C:\VoodooBox`, moves binaries, installs the Kernel Driver, and sets up persistence.

### `deploy_agent.ps1`
*   **Purpose**: A lighter deployment script often used for rapid testing or "drop-and-execute" scenarios.

### `install_sysmon.ps1`
*   **Purpose**: Downloads and installs Sysmon64 with the project's recommended forensic configuration (`sysmon_config.xml`).

### `enforce_security.ps1`
*   **Purpose**: "Un-hardens" the VM. Disables Windows Defender, Updates, and Firewalls to ensure malware runs unhindered.

### `install_driver.ps1`
*   **Purpose**: Standalone installer for the `voodoobox_eye.sys` kernel driver. Handles test-signing enablement (`bcdedit`) and service registration.
