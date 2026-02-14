# Remnux VM Deployment Guide (Docker-in-VM)

This guide details how to set up the Remnux MCP server on a dedicated Docker host for malware analysis, connected to TheVooDooBox via shared NFS storage and authenticated MCP calls.

## Network Overview

| Component | IP Address | Notes |
| :--- | :--- | :--- |
| **App Server (VoodooBox)** | `192.168.50.196` | Hosts Backend & Frontend |
| **Remnux Docker Host** | `192.168.50.199` | Runs the MCP Server container |
| **AI Server** | `192.168.50.98` | Runs Ollama / Local AI |

### 1. Configure NFS Server (On App Server: 192.168.50.196)
The App Server must export the shared directory so the Remnux VM can mount it.

```bash
# 1. Install NFS Kernel Server
sudo apt update && sudo apt install nfs-kernel-server -y

# 2. Add the export (Match the 192.168.50.0 range)
# rw: Read-Write, sync: synchronous writes, no_root_squash: allow root to write
echo "/mnt/voodoo_samples 192.168.50.0/24(rw,sync,no_subtree_check,no_root_squash)" | sudo tee -a /etc/exports

# 3. Apply changes
sudo exportfs -ra

# 4. Ensure service is running
sudo systemctl restart nfs-kernel-server

# 5. Check firewall (NFSv4 + NFSv3 auxiliary ports)
sudo ufw allow from 192.168.50.199 to any port nfs
sudo ufw allow from 192.168.50.199 to any port 111
sudo ufw allow from 192.168.50.199 to any port 2049
```

> [!CAUTION]
> If it still hangs, try disabling the firewall temporarily: `sudo ufw disable` to confirm it's a network block.

### 2. Configure NFS Mount (On Remnux VM: 192.168.50.199)
The Remnux VM must be able to see the files staged by the App Server.

```bash
# Install NFS client
sudo apt update && sudo apt install nfs-common -y

# Create mount point
sudo mkdir -p /mnt/voodoo_samples

# Mount the App Server share
sudo mount 192.168.50.196:/mnt/voodoo_samples /mnt/voodoo_samples

# Verify mount
ls -la /mnt/voodoo_samples
```

> [!TIP]
> To make it permanent, add this line to /etc/fstab:
> `192.168.50.196:/mnt/voodoo_samples /mnt/voodoo_samples nfs defaults 0 0`

## 1. Remnux Server (192.168.50.199)

We use a tiny Node.js gateway to bridge the complex MCP protocol to a simple REST API (`POST /analyze`).

### voodoo-gateway.js

```javascript
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

// RUNTIME FIX: Ensure the CWD exists
const WORK_DIR = '/home/remnux/files/samples';
if (!fs.existsSync(WORK_DIR)) {
  console.log(`[GATEWAY] Creating working directory: ${WORK_DIR}`);
  fs.mkdirSync(WORK_DIR, { recursive: true });
}

// Absolute Environment Hardening
process.env.PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
process.env.SHELL = '/bin/bash';

console.log('[GATEWAY] Environment PATH:', process.env.PATH);

const mcp = spawn('node', ['/usr/lib/node_modules/@remnux/mcp-server/dist/cli.js'], { 
  env: process.env,
  shell: false, 
  stdio: ['pipe', 'pipe', 'pipe']
});

let buffer = '';
let initialized = false;

// 1. MCP Handshake: We MUST wait for initialized before starting tools
mcp.stdin.write(JSON.stringify({
  jsonrpc: "2.0", id: "init", method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "voodoo-bridge", version: "1.0" } }
}) + '\n');

mcp.stdout.on('data', (chunk) => {
  const data = chunk.toString();
  buffer += data;
  
  if (!initialized && data.includes('"id":"init"')) {
    console.log('[GATEWAY] MCP Server Initialized & Ready!');
    initialized = true;
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + '\n');
  }
  
  // Real-time debug logging
  process.stdout.write(`[MCP-STDOUT] Received ${data.length} bytes\n`);
});

mcp.stderr.on('data', (data) => process.stderr.write(`[MCP-STDERR] ${data}`));

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/analyze') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!initialized) {
        res.writeHead(503); return res.end("MCP Server not ready");
      }
      try {
        const { file } = JSON.parse(body);
        const id = Date.now();
        console.log(`[GATEWAY] STARTING ANALYSIS [ID:${id}]: ${file}`);
        
        mcp.stdin.write(JSON.stringify({
          jsonrpc: "2.0", id, method: "tools/call",
          params: { name: "analyze_file", arguments: { file } }
        }) + '\n');

        const checkBuffer = setInterval(() => {
          const lines = buffer.split('\n');
          for (let i = 0; i < lines.length; i++) {
            // Robust check for ID (handle number or string IDs)
            if (lines[i].includes(`"id":${id}`) || lines[i].includes(`"id":"${id}"`)) {
              clearInterval(checkBuffer);
              console.log(`[GATEWAY] FINISHED ANALYSIS [ID:${id}]`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(lines[i]);
              lines.splice(i, 1);
              buffer = lines.join('\n');
              return;
            }
          }
        }, 500);

        // Timeout after 10 minutes (malware analysis is slow)
        setTimeout(() => {
          clearInterval(checkBuffer);
          if (!res.writableEnded) {
            console.error(`[GATEWAY] TIMEOUT [ID:${id}] - Tool likely still running (capa/floss?)`);
            res.writeHead(504); res.end("Analysis Timeout - Check logs for progress");
          }
        }, 600000);

      } catch (e) {
        res.writeHead(400); res.end("Invalid Request");
      }
    });
  } else {
    res.writeHead(404); res.end();
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
RUN mkdir -p /home/remnux/files/samples && chown -R remnux:remnux /home/remnux/files

# NUCLEAR SOURCE PATCH 1: Force-inject PATH at the top of the MCP server code
RUN sed -i '1a process.env.PATH = process.env.PATH || "\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin";' /usr/lib/node_modules/@remnux/mcp-server/dist/cli.js

# NUCLEAR SOURCE PATCH 2: Fix local.js to use absolute bash path and force PATH in spawn
RUN sed -i 's/"bash", "-c"/"\/bin\/bash", "-c"/' /usr/lib/node_modules/@remnux/mcp-server/dist/connectors/local.js && \
    sed -i '/const filteredEnv = {};/a filteredEnv.PATH = "\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin";' /usr/lib/node_modules/@remnux/mcp-server/dist/connectors/local.js

COPY voodoo-gateway.js /home/remnux/voodoo-gateway.js

# Ensure sh points to bash
RUN ln -sf /usr/bin/bash /usr/bin/sh

USER root
WORKDIR /home/remnux
EXPOSE 8090

# 4. Start the Gateway
CMD ["node", "voodoo-gateway.js"]
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

## 2. Shared Storage (NFS Sync)

Ensure the App Server (.196) and Remnux VM (.199) are perfectly synced:

```bash
# On App Server (192.168.50.196):
# Check that files exist
ls -R /mnt/voodoo_samples

# On Remnux Host (192.168.50.199):
# Check that the mount is active
mount | grep voodoo
```

## 4. VooDooBox Integration

In your main `docker-compose.yaml` (on .196), the environment variables must point to the Remnux VM IP:

```env
REMNUX_MCP_URL=http://192.168.50.199:8090/sse
SHARED_MALWARE_DIR=/mnt/voodoo_samples
```

## 5. Data Flow Verification

1. Backend stages file to `/mnt/voodoo_samples/<task_id>/sample.exe`.
2. Backend calls `POST http://192.168.50.199:8090/analyze`.
3. Gateway triggers Remnux MCP and waits up to 10 minutes.
4. results are saved to the database.
