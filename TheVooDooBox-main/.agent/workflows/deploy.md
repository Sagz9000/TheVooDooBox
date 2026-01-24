---
description: Automated Deployment of Mallab v3
---

To automate the implementation and deployment of the Mallab v3 stack, follow these steps:

1. **Verify Infrastructure Parameters**
   Ensure your Proxmox credentials and IP are updated in `docker-compose.yaml`.

2. **One-Click Execution**
   Run the master orchestrator script from the root directory:
   ```powershell
   // turbo
   .\launch_mallab.ps1
   ```

3. **Deploy Agent to Sandbox**
   Transfer the compiled `target/release/agent-windows.exe` to your Windows VM and use the helper script:
   ```powershell
   // turbo
   .\scripts\run_agent.ps1 -Server <CONTROL_ROOM_IP>:9001
   ```

4. **Verify Live Stream**
   Open `http://localhost:3000` and confirm that telemetry is flowing and the Proxmox VMs are visible in the "Sanctuary" view.
