# Start Development Environment
# 1. Build the Windows Agent (Docker)
Write-Host "Building Windows Agent..." -ForegroundColor Cyan
./build_agent_docker.ps1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Agent build failed. Halting."
    exit 1
}

# 2. Start VooDooBox Stack
Write-Host "Starting VooDooBox Stack..." -ForegroundColor Cyan
docker-compose up --build -d

Write-Host "Environment Started!" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000"
Write-Host "Backend: http://localhost:8080"
