# TheVooDooBox v3: Windows 10 Sandbox Finalization Guide

After running the `proxmox_setup_win.sh` script, follow these steps to ensure your sandbox is ready for high-fidelity telemetry.

## 1. Windows Installation (The VirtIO Way)
Since we use **VirtIO SCSI** and **VirtIO Network** for maximum performance and visibility:
- When Windows asks "Where do you want to install?", no disks will appear.
- Click **Load Driver** -> **Browse**.
- Navigate to the `virtio-win` CD-ROM.
- Select `vioscsi\w10\amd64` (for OS drive detection).
- After installation starts, also load `NetKVM\w10\amd64` to enable networking.

## 2. Install QEMU Guest Agent (CRITICAL)
Once in Windows:
- Open the `virtio-win` CD-ROM.
- Run `guest-agent\qemu-ga-x86_64.msi`.
- This allows Proxmox/Mallab to see the VM's IP address and internal state.

## 3. Disabling Defensive Layers (Lab Use Only)
To prevent Windows from killing your malware or the Mallab Agent:

### Disable Windows Defender
1. Open **Windows Security** -> **Virus & threat protection**.
2. Click **Manage settings**.
3. Turn OFF:
   - Real-time protection
   - Cloud-delivered protection
   - Automatic sample submission
   - Tamper Protection

### Disable Firewall
1. Open **Windows Defender Firewall with Advanced Security**.
2. Disable the firewall for **Domain**, **Private**, and **Public** profiles.

## 4. Deploy Mallab Agent
1. Copy `agent-windows.exe` to the machine.
2. Run it as Administrator.
3. Check the **Mallab v3 Dashboard** -> Telemetry should start flowing immediately.

## 5. Take a Snapshot (GOLD IMAGE)
Once configured perfectly:
- Shut down the VM.
- In Proxmox: **Snapshot** -> "Clean_Install_Ready".
- Now you can infect the VM, investigate, and revert to this clean state in seconds.
