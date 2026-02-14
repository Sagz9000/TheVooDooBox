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

We use a tiny Node.js gateway to bridge the complex MCP protocol to a simple REST API (`POST /analyze`).

### voodoo-gateway.js

```javascript
const { spawn } = require('child_process');
const http = require('http');

// Start the MCP server in stdio mode
const mcp = spawn('remnux-mcp-server', [], { 
  shell: '/bin/bash', 
  env: { ...process.env, PATH: process.env.PATH + ':/usr/local/bin' } 
});

let buffer = '';

// MCP Handshake on startup
mcp.stdin.write(JSON.stringify({
  jsonrpc: "2.0", id: 0, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "voodoo-bridge", version: "1.0" } }
}) + '\n');

// Global collector for stdout to handle multi-line/chunked JSON-RPC
mcp.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
});

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/analyze') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { file } = JSON.parse(body);
        const id = Date.now();
        
        mcp.stdin.write(JSON.stringify({
          jsonrpc: "2.0", id, method: "tools/call",
          params: { name: "analyze_file", arguments: { file } }
        }) + '\n');

        // Poll the buffer for the specific ID
        const checkBuffer = setInterval(() => {
          const lines = buffer.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(`"id":${id}`)) {
              clearInterval(checkBuffer);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(lines[i]);
              // Clear the processed line to keep buffer small
              lines.splice(i, 1);
              buffer = lines.join('\n');
              return;
            }
          }
        }, 100);

      } catch (e) {
        res.writeHead(400); res.end("Invalid Request");
      }
    });
  }
});

server.listen(8090, '0.0.0.0', () => console.log('Voodoo Gateway listening on 8090'));
```

### Dockerfile

```dockerfile
FROM remnux/remnux-distro:noble
USER root

# 1. Install dependencies
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN npm install -g @remnux/mcp-server

# 2. Fix missing catalog
RUN mkdir -p /usr/lib/node_modules/@remnux/mcp-server/data && \
    echo '[]' > /usr/lib/node_modules/@remnux/mcp-server/data/tools-index.json

# 3. Setup files directory
RUN mkdir -p /home/remnux/files && chown remnux:remnux /home/remnux/files

COPY voodoo-gateway.js /home/remnux/voodoo-gateway.js
USER remnux
WORKDIR /home/remnux
EXPOSE 8090

# 4. Start the Gateway with a full environment
CMD ["/bin/bash", "-c", "export PATH=$PATH:/usr/local/bin && node voodoo-gateway.js"]
```

### docker-compose.yml

```yaml
services:
  remnux-mcp:
    build: .
    container_name: remnux-mcp
    network_mode: "host"
    restart: unless-stopped
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
