# ExtensionDetox Bouncer — Ghidra-style Sidecar Container
# Performs static triage of VS Code extensions (VSIX)
# Exposes a FastAPI HTTP API for the Rust backend to call

FROM python:3.12-slim

LABEL maintainer="VooDooBox Team"
LABEL description="ExtensionDetox Bouncer - Static Analysis API"

# Install system dependencies for yara and magic
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    yara \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create data directories
RUN mkdir -p /app/data/vsix_archive

# Expose FastAPI port (mirrors Ghidra's 8000)
EXPOSE 8000

# Run FastAPI via uvicorn
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
