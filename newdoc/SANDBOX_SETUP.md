# Sandbox Setup Guide

Prepare your Windows 10/11 VMs for high-fidelity malware analysis.

## 1. Drivers & Tools
- **VirtIO Drivers**: Required for performance and the telemetry serial port.
- **QEMU Guest Agent**: Critical for IP detection and power management.

## 2. Security "De-Tuning"
In a lab environment, Windows security features often interfere with analysis:
1. **Disable Windows Defender**: Use scripts or Group Policy to turn off Real-time protection.
2. **Disable Firewall**: Allow the agent to communicate back to the host.
3. **Disable UAC**: (Optional) For smoother remote command execution.

## 3. Deployment Flow
1. Install a fresh Windows OS.
2. Run `scripts/guest/configure_security.ps1`.
3. Install the Mallab Agent (see [Agent Guide](./AGENT_GUIDE.md)).
4. **Take the `GOLD_IMAGE` Snapshot.**

## 4. Automation
Use the provided scripts in `scripts/guest/` to automate these steps:
- `bootstrap.ps1`: Initial environment setup.
- `install_flarevm.ps1`: Optional integration with FlareVM tools.
