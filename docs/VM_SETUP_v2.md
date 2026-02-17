# TheVooDooBox - Guest VM Setup Guide (v3.0)

This guide explains how to configure a **Windows Sandbox VM** to work with TheVooDooBox.

## 1. VM Prerequisites

*   **OS**: Windows 10 or 11 (Pro/Enterprise recommended).
*   **Networking**:
    *   Must be able to reach the **Control Center IP** (e.g., `192.168.1.100`) on ports `8080` and `9001`.
    *   *Tip*: Disable the VM's Firewall or allow ports 9001/TCP (Agent) and 8080/TCP (API).
*   **Snapshotting**: You must have a way to revert the VM to a clean state (Proxmox Snapshots are standard).

---

## 2. Agent Installation (The "Guest Bundle")

The `launch_mallab_v2.ps1` script on your host created a folder named `guest-setup`. This contains everything you need.

### Step 1: Transfer Files
Copy the entire `guest-setup` folder from your Host to the Guest VM.
*   *Methods*: Shared Folder, USB Drive, Drag & Drop (if tools installed), or HTTP upload.

### Step 2: Run the Installer
Inside the VM:

1.  Open **PowerShell as Administrator**.
2.  Run the Master Installer:
    ```powershell
    cd C:\Path\To\guest-setup
    .\install_monitor_v2.ps1
    ```
3.  **Configuration**:
    *   It will ask for the **Hyper-Bridge Address** (e.g., `192.168.1.100:9001`).
    *   *Note*: This cannot be `localhost` unless you are doing weird port forwarding. It must be the LAN IP of your Docker Host.

4.  **Completion**:
    *   The script will install **Sysmon** (for deep forensics).
    *   It will install the **VoodooBox Agent**.
    *   It creates a **Scheduled Task** ("VoodooWatchdog") to ensure the agent runs on boot.

---

## 3. Creating the Golden Image

To enable automated detonation, TheVooDooBox needs a clean "Save State" to revert to after every analysis.

1.  **Ensure Agent is Running**: Check Task Manager for `voodoobox-agent.exe`.
2.  **Clear Noise**: Close any open folders or PowerShell windows.
3.  **Shutdown / Snapshot**:
    *   **Proxmox**: Go to the VM -> Snapshots -> Take Snapshot.
    *   **Name**: `GOLD_IMAGE` (Case sensitive! The backend looks for exactly this name).
    *   **RAM**: Checked (Include RAM) is recommended for fast startup, but optional.

---

## 4. Verification

1.  Go to your **VoodooBox Dashboard** (`http://localhost:3000`).
2.  Look at the **"Sanctuary"** (Sandbox Manager) or **Analysis Arena**.
3.  If your VM is running, you should see "Agent Connected" and a stream of telemetry (Heartbeats).

---

## Advanced: Kernel Driver
The `guest-setup` folder includes `install_driver.ps1`. Running this (As Admin) will install the `TheVooDooBoxFilter.sys` kernel driver for anti-tamper capabilities. This requires **Test Signing Mode** to be enabled on Windows (`bcdedit /set testsigning on`).
