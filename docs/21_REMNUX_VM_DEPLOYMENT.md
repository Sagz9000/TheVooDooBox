# Remnux VM Deployment Guide (Docker-in-VM)

This guide details how to set up the Remnux MCP server on a dedicated Docker host for malware analysis, connected to TheVooDooBox via shared NFS storage and authenticated MCP calls.

## Network Overview

| Component | IP Address | Notes |
| :--- | :--- | :--- |
| **App Server (VoodooBox)** | `192.168.50.196` | Hosts Backend & Frontend |
| **Remnux Docker Host** | `192.168.50.199` | Runs the MCP Server container |
| **AI Server** | `192.168.50.98` | Runs Ollama / Local AI |

### Docker Compose (On 192.168.50.199)
Ensure `network_mode: "host"` is set so it binds to the VM's IP directly once `socat` is running.

## 1. Remnux Server (192.168.50.199)

```dockerfile
FROM remnux/remnux-distro:noble
USER root

# 1. Install socat (for network bridging) and the MCP server
RUN apt-get update && apt-get install -y socat curl && rm -rf /var/lib/apt/lists/*
RUN npm install -g @remnux/mcp-server

# 2. FIX: Create the missing tool catalog file that causes the crash
# We create an empty JSON array to satisfy the server's requirement
RUN mkdir -p /usr/lib/node_modules/@remnux/mcp-server/data && \
    echo '[]' > /usr/lib/node_modules/@remnux/mcp-server/data/tools-index.json

# 3. Setup permissions
RUN mkdir -p /home/remnux/files && chown remnux:remnux /home/remnux/files

USER remnux
WORKDIR /home/remnux
EXPOSE 8090

# 4. WORKAROUND: Force bind 0.0.0.0:8090 -> 127.0.0.1:3000
# Removed log redirection to see server errors. Added socat verbose logging.
CMD ["sh", "-c", "remnux-mcp-server --mode=local --transport=http & sleep 5 && socat -d -d TCP-LISTEN:8090,fork,bind=0.0.0.0 TCP:127.0.0.1:3000"]
```

### docker-compose.yml

```yaml
services:
  remnux-mcp:
    build: .
    container_name: remnux-mcp
    network_mode: "host"  # Binds directly to 10.10.20.50
    restart: unless-stopped
    environment:
      - MCP_TOKEN=voodoo-secret-token
      - PORT=8090
      - HOST=0.0.0.0
    volumes:
      - /mnt/voodoo_samples:/home/remnux/files
```

### Start

```bash
cd ~/remnux_mcp
docker-compose up -d
```

## 2. Shared Storage (NFS)

Both servers must mount the same NFS share:

```bash
# On App Server (192.168.50.196):
mount 192.168.50.10:/volume/samples /mnt/voodoo_samples

# On Remnux Host (10.10.20.50):
mount 192.168.50.10:/volume/samples /mnt/voodoo_samples
```

> **Note**: The NFS export path depends on your NAS/Proxmox host configuration.

## 3. pfSense Firewall Rule

| Field | Value |
|---|---|
| Action | Pass |
| Interface | Management (192.168.50.x) |
| Source | `192.168.50.196` |
| Destination | `10.10.20.50` |
| Port | `8090` |

## 4. VooDooBox Integration

In your main `docker-compose.yaml`, the following environment variables are set on the `hyper-bridge` service:

```env
REMNUX_MCP_URL=http://10.10.20.50:8090/sse
REMNUX_MCP_TOKEN=voodoo-secret-token
SHARED_MALWARE_DIR=/mnt/voodoo_samples
```

The hyper-bridge container also mounts the shared volume:

```yaml
volumes:
  - /mnt/voodoo_samples:/mnt/voodoo_samples
```

## 5. Data Flow

1. User uploads `suspect.exe` via the web UI.
2. Backend copies sample to `/mnt/voodoo_samples/<task_id>/suspect.exe`.
3. Backend calls Remnux MCP at `http://10.10.20.50:8090/mcp/tools/call` with `Authorization: Bearer voodoo-secret-token`.
4. Remnux reads the file from its volume mount at `/home/remnux/files/<task_id>/suspect.exe`.
5. Results are returned via MCP and stored in the `tasks` table.
