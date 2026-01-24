# Mallab Agent Binary Execution Troubleshooting Guide

## Problem Identified
The agent is receiving the DOWNLOAD_EXEC command but disconnecting immediately without executing the binary.

## Root Cause Analysis
Based on logs:
```
Agent connected: 172.26.0.1:60036
[ORCHESTRATOR] Detonation command broadcasted: {"command":"DOWNLOAD_EXEC","url":"http://192.168.50.196:8080/uploads/..."}
Agent disconnected: 172.26.0.1:60036  ← Agent crashes/disconnects
```

The agent is likely failing to download the binary from `http://192.168.50.196:8080/uploads/...`

## Possible Issues:

### 1. **Network Connectivity** (MOST LIKELY)
   - The VM cannot reach `192.168.50.196:8080` from inside the guest
   - Firewall blocking port 8080
   - Incorrect network configuration in VM

### 2. **Agent Crash**
   - The agent is crashing when trying to download
   - No error handling for network failures
   - Thread panic causing disconnect

### 3. **File Download Timeout**
   - The download is taking too long and timing out
   - No retry logic implemented

## Diagnostic Steps:

### Step 1: Verify Network Connectivity from VM
1. RDP/SSH into VM 310
2. Run: `Test-NetConnection -ComputerName 192.168.50.196 -Port 8080`
3. Run: `Invoke-WebRequest -Uri "http://192.168.50.196:8080/vms/list" -UseBasicParsing`

### Step 2: Check Agent Logs in VM
1. Check if agent.exe is running: `Get-Process agent -ErrorAction SilentlyContinue`
2. Look for crash dumps in: `C:\agent\`
3. Check Windows Event Viewer for application crashes

### Step 3: Manual Download Test
1. In VM, open PowerShell
2. Try manual download:
   ```powershell
   Invoke-WebRequest -Uri "http://192.168.50.196:8080/uploads/<filename>" -OutFile "C:\test_download.exe"
   ```

### Step 4: Check Firewall Rules
1. On host machine (192.168.50.196):
   ```powershell
   Get-NetFirewallRule | Where-Object {$_.LocalPort -eq 8080}
   ```
2. Add firewall rule if needed:
   ```powershell
   New-NetFirewallRule -DisplayName "Mallab Backend" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
   ```

## Quick Fixes:

### Fix 1: Add Error Logging to Agent
The agent needs better error logging. The current code may be panicking silently.

### Fix 2: Increase Download Timeout
The agent might need a longer timeout for large binaries.

### Fix 3: Use Alternative Download URL
If the VM is on a different network, you may need to use the Proxmox host's IP or a different routing path.

### Fix 4: Add Retry Logic
The agent should retry downloads on failure.

## Immediate Action Items:

1. **Check VM Network Configuration**
   - Ensure VM can ping 192.168.50.196
   - Ensure port 8080 is accessible

2. **Rebuild Agent with Better Logging**
   - Add console output for download attempts
   - Add error handling for network failures
   - Log to file instead of just stdout

3. **Test Manual Execution**
   - Manually download a sample to the VM
   - Run it manually to verify execution works
   - This isolates the download issue from execution issue

## Expected Behavior:
When working correctly, you should see these events in order:
1. `Agent connected`
2. `DOWNLOAD_EXEC command broadcasted`
3. `FILE_VERIFIED` (agent confirms download)
4. `EXEC_SUCCESS` (agent confirms execution)
5. `PROCESS_CREATE` events (from process monitoring)

## Current Behavior:
1. `Agent connected` ✓
2. `DOWNLOAD_EXEC command broadcasted` ✓
3. `Agent disconnected` ✗ (UNEXPECTED)
4. No FILE_VERIFIED or EXEC_SUCCESS events

## Next Steps:
1. Verify network connectivity from VM to host
2. Add comprehensive error logging to agent
3. Test manual download and execution
4. Rebuild and redeploy agent with fixes
