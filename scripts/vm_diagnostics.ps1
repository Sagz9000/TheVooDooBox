# VM Diagnostics Script (Run INSIDE the Guest VM)
Write-Host "=== Mallab VM Network Diagnostics ===" -ForegroundColor Cyan

# 1. Test Connectivity to Host
$HostIP = "192.168.50.196"
$Port = 8080

Write-Host "1. Testing connection to Orchestrator ($HostIP : $Port)..." -ForegroundColor Yellow
try {
    $tcp = Test-NetConnection -ComputerName $HostIP -Port $Port -WarningAction SilentlyContinue
    if ($tcp.TcpTestSucceeded) {
        Write-Host "   [PASS] TCP Connection Established!" -ForegroundColor Green
    }
    else {
        Write-Host "   [FAIL] TCP Connection Failed" -ForegroundColor Red
        Write-Host "   Details: $($tcp.DetailedInfo)" -ForegroundColor Gray
    }
}
catch {
    Write-Host "   [ERROR] Could not run Test-NetConnection" -ForegroundColor Red
}

# 2. Test HTTP Download
Write-Host "`n2. Testing HTTP Download from Backend..." -ForegroundColor Yellow
$Url = "http://$($HostIP):$($Port)/vms/list"
try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "   [PASS] HTTP GET Successful (Length: $($response.Content.Length))" -ForegroundColor Green
    }
    else {
        Write-Host "   [FAIL] HTTP GET returned code $($response.StatusCode)" -ForegroundColor Red
    }
}
catch {
    Write-Host "   [FAIL] HTTP Request Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. Check Agent Process
Write-Host "`n3. Checking for Agent Process..." -ForegroundColor Yellow
$agent = Get-Process agent -ErrorAction SilentlyContinue
if ($agent) {
    Write-Host "   [PASS] Agent is running (PID: $($agent.Id))" -ForegroundColor Green
}
else {
    Write-Host "   [WARN] Agent process not found!" -ForegroundColor Yellow
}

# 4. Check Agent Logs
Write-Host "`n4. Checking Agent Logs (Last 10 lines)..." -ForegroundColor Yellow
if (Test-Path "C:\agent\agent.log") {
    Get-Content "C:\agent\agent.log" -Tail 10
}
else {
    Write-Host "   No log file found at C:\agent\agent.log" -ForegroundColor Gray
}

Write-Host "`n=== End of Diagnostics ===" -ForegroundColor Cyan
pause
