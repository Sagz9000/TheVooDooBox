# Host-Side URL Verification Script
# Run this on the Host to verify the download URL is generated correctly and accessible

Write-Host "=== Host-Side URL Verification ===" -ForegroundColor Cyan

# 1. Get Host IP
$HostIP = $env:HOST_IP
if (-not $HostIP) { $HostIP = "192.168.50.196" }
Write-Host "Configured Host IP: $HostIP"

# 2. Check if uploads directory has files
$uploads = Get-ChildItem ".\uploads" -Filter "*_*"
if ($uploads.Count -eq 0) {
    Write-Host "No uploaded samples found in .\uploads" -ForegroundColor Yellow
    exit
}

$latest = $uploads | Sort-Object CreationTime -Descending | Select-Object -First 1
Write-Host "Testing with latest sample: $($latest.Name)" -ForegroundColor Yellow

# 3. Construct URL
$url = "http://$($HostIP):8080/uploads/$($latest.Name)"
Write-Host "Generated URL: $url"

# 4. Test Connectivity
try {
    $response = Invoke-WebRequest -Uri $url -Method Head -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "[PASS] URL is accessible from Host!" -ForegroundColor Green
    }
}
catch {
    Write-Host "[FAIL] URL is NOT accessible from Host" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    
    # Suggest Fixes
    Write-Host "`nTroubleshooting:"
    Write-Host "1. Is the 'mallabv3-hyper-bridge-1' container running?"
    Write-Host "2. Is port 8080 mapped correctly in docker-compose?"
    Write-Host "3. Is 192.168.50.196 the correct IP for this interface?"
}
