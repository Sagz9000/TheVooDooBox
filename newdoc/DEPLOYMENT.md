# MallabV3 Deployment Guide

This guide covers the full deployment of the MallabV3 analysis platform.

## 🐳 Infrastructure (Docker)

The core platform runs as a collection of Docker containers.

1. **Environment Setup**: 
   Copy `.env.example` to `.env` and fill in your Proxmox and database credentials.
2. **Launch**:
   ```bash
   docker-compose up --build -d
   ```
3. **Access**:
   - Web UI: `http://localhost:3000`
   - API Docs: `http://localhost:8080/docs`

## 🖥️ Sandbox Infrastructure (Proxmox)

MallabV3 integrates with Proxmox to manage VM states.

### Snapshot Convention
For the "Revert" functionality to work, your VM must have a snapshot named exactly:
**`GOLD_IMAGE`**

### Networking
Ensure your Proxmox host allows traffic on:
- **Port 9001**: Agent telemetry (TCP).
- **Port 8006**: Proxmox API (HTTPS).
- **VNC Range**: As configured in your firewall.

## 🛠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| No Telemetry | Check guest VM's connectivity to host port 9001. |
| VNC Fail | Verify `VM.Console` permissions for the Proxmox API user. |
| DB Errors | Ensure Postgres container is healthy and migrations ran. |
