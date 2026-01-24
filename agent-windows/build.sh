#!/bin/bash
# Build script for Windows agent using Docker

echo "Building Windows agent using Docker..."

# Build the Docker image
docker build -f Dockerfile.build -t mallab-agent-builder .

# Extract the built executable
docker create --name temp-agent mallab-agent-builder
docker cp temp-agent:/build/target/x86_64-pc-windows-gnu/release/mallab-agent-windows.exe ./mallab-agent-windows.exe
docker rm temp-agent

echo "Build complete! Agent executable: mallab-agent-windows.exe"
echo "File size: $(ls -lh mallab-agent-windows.exe | awk '{print $5}')"
