# TheVooDooBox Agent Diagnostics Script
# This script helps diagnose why the agent isn't executing binaries

Write-Host "=== VOODOOBOX Agent Diagnostics ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check if backend is running
Write-Host "[1] Checking Backend Status..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/vms/list" -UseBasicParsing -TimeoutSec 5
    Write-Host "✓ Backend is running" -ForegroundColor Green
}
catch {
    Write-Host "✗ Backend is NOT running or not accessible" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
}

# 2. Check Docker containers
Write-Host ""
Write-Host "[2] Checking Docker Containers..." -ForegroundColor Yellow
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | Select-String -Pattern "voodoobox"

# 3. Check backend logs for agent connections
Write-Host ""
Write-Host "[3] Recent Backend Logs (Agent Connections)..." -ForegroundColor Yellow
docker logs voodoobox-hyper-bridge-1 --tail 50 | Select-String -Pattern "Agent|ORCHESTRATOR|DOWNLOAD_EXEC"

# 4. Check if VM 310 is running
Write-Host ""
Write-Host "[4] Checking VM 310 Status..." -ForegroundColor Yellow
try {
    $vmStatus = Invoke-RestMethod -Uri "http://localhost:8080/vms/list" -Method Get
    $vm310 = $vmStatus | Where-Object { $_.vmid -eq 310 }
    if ($vm310) {
        Write-Host "VM 310 Status: $($vm310.status)" -ForegroundColor $(if ($vm310.status -eq "running") { "Green" }else { "Yellow" })
    }
    else {
        Write-Host "✗ VM 310 not found in VM list" -ForegroundColor Red
    }
}
catch {
    Write-Host "✗ Could not query VM status" -ForegroundColor Red
}

# 5. Check recent tasks
Write-Host ""
Write-Host "[5] Recent Analysis Tasks..." -ForegroundColor Yellow
try {
    $tasks = Invoke-RestMethod -Uri "http://localhost:8080/tasks" -Method Get
    if ($tasks) {
        $tasks | Select-Object -First 5 | Format-Table id, filename, status, @{Name = "Created"; Expression = { [DateTimeOffset]::FromUnixTimeMilliseconds($_.created_at).LocalDateTime } }
    }
    else {
        Write-Host "No tasks found" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "✗ Could not query tasks" -ForegroundColor Red
}

# 6. Check network connectivity from host to backend
Write-Host ""
Write-Host "[6] Testing Network Connectivity..." -ForegroundColor Yellow
$testPorts = @(8080, 9001)
foreach ($port in $testPorts) {
    $result = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue
    if ($result.TcpTestSucceeded) {
        Write-Host "✓ Port $port is accessible" -ForegroundColor Green
    }
    else {
        Write-Host "✗ Port $port is NOT accessible" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== Diagnostics Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Common Issues:" -ForegroundColor Yellow
Write-Host "1. Agent not running in VM - Check if agent.exe is in startup folder"
Write-Host "2. Network misconfiguration - Verify AGENT_SERVER_ADDR environment variable"
Write-Host "3. Firewall blocking port 9001 - Check Windows Firewall rules"
Write-Host "4. VM not started properly - Check Proxmox VM console"
Write-Host ""
Write-Host "To manually test agent connection:" -ForegroundColor Cyan
Write-Host "  1. SSH/RDP into VM 310"
Write-Host "  2. Run: C:\agent\agent.exe"
Write-Host "  3. Check backend logs: docker logs voodoobox-hyper-bridge-1 -f"
