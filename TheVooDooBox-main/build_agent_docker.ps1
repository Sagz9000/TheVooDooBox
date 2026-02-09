# Build script for Voodoobox Agent (Windows) using Docker
# Usage: .\build_agent_docker.ps1

Write-Host "Building Agent Builder Image..." -ForegroundColor Cyan
docker build -f Dockerfile.agent -t voodoobox-agent-builder .

if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build failed."
    exit 1
}

Write-Host "Compiling Agent for Windows x86_64..." -ForegroundColor Cyan
# Mount current directory/agent-windows to /app so target is written to host
# We override the COPY in Dockerfile by mounting over /app
docker run --rm -v "${PWD}/agent-windows:/app" -v "${PWD}/agent-windows/.cargo:/root/.cargo" voodoobox-agent-builder cargo build --release --target x86_64-pc-windows-gnu

if ($LASTEXITCODE -ne 0) {
    Write-Error "Compilation failed."
    exit 1
}

$source = ".\agent-windows\target\x86_64-pc-windows-gnu\release\mallab_agent_windows.exe"
$dest = ".\binaries\agent.exe"

if (Test-Path $source) {
    Write-Host "Build Successful! Copying to $dest" -ForegroundColor Green
    Copy-Item $source $dest -Force
}
else {
    Write-Error "Build artifact not found at $source. Checking for alternate name..."
    $source_alt = ".\agent-windows\target\x86_64-pc-windows-gnu\release\mallab-agent-windows.exe"
    if (Test-Path $source_alt) {
        Write-Host "Found alternate name! Copying..." -ForegroundColor Green
        Copy-Item $source_alt $dest -Force
    }
    else {
        Write-Error "Could not find binary. Check target directory."
    }
}
