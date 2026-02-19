# VooDooBox - AI Node Deployment

This package deploys **ChromaDB** on the AI server (`192.168.50.98`) to work alongside the existing llama.cpp / DeepCoder-14B instance.

## Quick Start

```bash
# 1. Copy this folder to the AI server
scp -r deploy-ai/ user@192.168.50.98:~/voodoobox-ai/

# 2. SSH into the AI server
ssh user@192.168.50.98

# 3. Start ChromaDB
cd ~/voodoobox-ai
docker compose up -d

# 4. Verify it's running
curl http://localhost:8001/api/v1/heartbeat
# Expected: {"nanosecond heartbeat": ...}
```

## Architecture

```
App Server (192.168.50.196)          AI Server (192.168.50.98)
┌─────────────────────────┐         ┌─────────────────────────┐
│  hyper-bridge (backend)  │───────▶│  llama.cpp (DeepCoder-14B)  │
│  postgres                │        │  ChromaDB  ◀── NEW      │
│  frontend                │        └─────────────────────────┘
│  ghidra                  │
└─────────────────────────┘
```

## Ports

| Service  | Port | Purpose                    |
|----------|------|----------------------------|
| ChromaDB | 8001 | Vector DB API              |

## Data Persistence

ChromaDB data is stored in `./chroma_data/` on the host. This directory is created automatically on first run.

## Troubleshooting

```bash
# Check logs
docker compose logs -f chromadb

# Restart
docker compose restart chromadb

# Full reset (WARNING: deletes all vector data)
docker compose down -v
rm -rf ./chroma_data
docker compose up -d
```
