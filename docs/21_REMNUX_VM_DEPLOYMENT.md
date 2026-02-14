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
const os = require('os');

// --- Configuration ---
const MCP_SCRIPT = '/usr/lib/node_modules/@remnux/mcp-server/dist/cli.js';
const PORT = 8090;
const WORK_DIR = '/home/remnux/files/samples';
const ANALYSIS_TIMEOUT = 600000; // 10 minutes

// Hardened Environment
const ENV = { ...process.env };
ENV.PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
ENV.SHELL = '/bin/bash';

// Ensure Work Dir exists
if (!fs.existsSync(WORK_DIR)) {
  console.log(`[GATEWAY] Creating working directory: ${WORK_DIR}`);
  fs.mkdirSync(WORK_DIR, { recursive: true });
}

/**
 * MCP Worker Class
 * Manages a single instance of the MCP Server (single-threaded).
 */
class MCPWorker {
    constructor(id, pool) {
        this.id = id;
        this.pool = pool;
        this.busy = false;
        this.process = null;
        this.buffer = '';
        this.currentRes = null;
        this.currentId = null;
        this.checkInterval = null;
        this.timeoutTimer = null;
        this.ready = false;

        this.start();
    }

    start() {
        console.log(`[WORKER-${this.id}] Booting MCP Server...`);
        this.process = spawn('node', [MCP_SCRIPT], { 
            env: ENV, 
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'] 
        });

        // Capture Output
        this.process.stdout.on('data', (chunk) => {
            const data = chunk.toString();
            this.buffer += data;
            // Check for initialization
            if (!this.ready && data.includes('"id":"init"')) {
                console.log(`[WORKER-${this.id}] Initialized & Ready!`);
                this.ready = true;
                this.sendJson({ jsonrpc: "2.0", method: "notifications/initialized" });
                this.buffer = ''; // Clear buffer to save RAM
                
                // If we were restarting and had a queue, the pool will auto-assign work
                this.pool.notifyWorkerReady(this);
            }
        });

        this.process.stderr.on('data', (data) => {
           // Optional: Log stderr if needed, but keep it quiet for now
           // process.stderr.write(`[WORKER-${this.id} ERR] ${data}`);
        });

        // Handle Crashes/Exits
        this.process.on('exit', (code) => {
            console.error(`[WORKER-${this.id}] Died with code ${code}. Restarting...`);
            this.cleanup();
            if (this.currentRes) {
                 this.currentRes.writeHead(500, { 'Content-Type': 'application/json' });
                 this.currentRes.end(JSON.stringify({ error: "Analysis Worker Crashed" }));
                 this.currentRes = null;
            }
            this.busy = false; 
            this.ready = false;
            this.start(); // Auto-restart
        });

        // Send Handshake
        this.sendJson({
            jsonrpc: "2.0", id: "init", method: "initialize",
            params: { 
                protocolVersion: "2024-11-05", 
                capabilities: {}, 
                clientInfo: { name: `voodoo-worker-${this.id}`, version: "1.0" } 
            }
        });
    }

    sendJson(obj) {
        if (this.process && this.process.stdin.writable) {
            this.process.stdin.write(JSON.stringify(obj) + '\n');
        }
    }

    analyze(file, res) {
        if (this.busy || !this.ready) return false;
        
        this.busy = true;
        this.currentRes = res;
        this.currentId = Date.now();
        this.buffer = ''; // Reset buffer for clean capture

        console.log(`[WORKER-${this.id}] Starting Analysis: ${file}`);
        
        this.sendJson({
             jsonrpc: "2.0", 
             id: this.currentId, 
             method: "tools/call",
             params: { name: "analyze_file", arguments: { file } }
        });

        // Poll for completion (looking for response ID)
        this.checkInterval = setInterval(() => this.checkCompletion(), 500);

        // Timeout Watchdog
        this.timeoutTimer = setTimeout(() => {
            if (this.busy) {
                console.error(`[WORKER-${this.id}] TIMEOUT on ${file} - Killing Worker.`);
                // Send timeout response to client
                if (this.currentRes) {
                    this.currentRes.writeHead(504, { 'Content-Type': 'application/json' });
                    this.currentRes.end(JSON.stringify({ error: "Analysis Timeout (10m Limit)" }));
                    this.currentRes = null;
                }
                // Kill worker to ensure no lingering processes (loops, etc.)
                if (this.process) this.process.kill(); 
                // exit handler will restart it
            }
        }, ANALYSIS_TIMEOUT);

        return true;
    }

    checkCompletion() {
        if (!this.busy) return;
        
        // Simple string search is safer than trying to parse partial JSON
        // We look for our specific Request ID in the output
        const lines = this.buffer.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(`"id":${this.currentId}`) || lines[i].includes(`"id":"${this.currentId}"`)) {
                console.log(`[WORKER-${this.id}] Finished Analysis.`);
                
                if (this.currentRes) {
                    this.currentRes.writeHead(200, { 'Content-Type': 'application/json' });
                    this.currentRes.end(lines[i]);
                    this.currentRes = null;
                }
                
                this.cleanup();
                this.busy = false;
                
                // Notify pool we are free
                this.pool.notifyWorkerReady(this);
                return;
            }
        }
    }

    cleanup() {
        if (this.checkInterval) clearInterval(this.checkInterval);
        if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    }
}

/**
 * Worker Pool Class
 * Load balances requests across multiple workers.
 */
class WorkerPool {
    constructor(size) {
        this.workers = [];
        this.queue = [];
        console.log(`[POOL] Spawning ${size} workers...`);
        for (let i = 0; i < size; i++) {
            this.workers.push(new MCPWorker(i, this));
        }
    }

    handleRequest(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
             try {
                const { file } = JSON.parse(body);
                // Try to find a free worker
                const worker = this.workers.find(w => !w.busy && w.ready);
                if (worker) {
                    worker.analyze(file, res);
                } else {
                    console.log(`[POOL] All workers busy. Queued: ${file}`);
                    this.queue.push({ file, res });
                }
             } catch (e) {
                 res.writeHead(400); res.end("Invalid JSON");
             }
        });
    }

    notifyWorkerReady(worker) {
        // If there's work in the queue, assign it immediately
        if (this.queue.length > 0) {
            const job = this.queue.shift();
            // Verify worker is actually ready (in case of race/restart)
            if (worker.ready && !worker.busy) {
                console.log(`[POOL] Assigning queued job to WORKER-${worker.id}`);
                worker.analyze(job.file, job.res);
            } else {
                 // Should not happen, but put back in queue if worker died mid-assign
                 this.queue.unshift(job);
            }
        }
    }
}

// --- Main ---

// Detect CPU Cores
const CPU_COUNT = os.cpus().length;
console.log(`[GATEWAY] Parallel Remnux Gateway v2.0 starting on ${CPU_COUNT} cores.`);

const pool = new WorkerPool(CPU_COUNT);

http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/analyze') {
        pool.handleRequest(req, res);
    } else {
        res.writeHead(404); res.end();
    }
}).listen(PORT, '0.0.0.0', () => console.log(`[GATEWAY] Listening on port ${PORT}`));
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
