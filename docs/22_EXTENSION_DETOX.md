# ExtensionDetox Integration

The **ExtensionDetox** module provides automated triage and detonation capabilities specifically designed for Visual Studio Code extensions (`.vsix` files). It integrates directly into TheVooDooBox architecture to provide a seamless extension analysis pipeline.

## Architecture & Container Strategy

ExtensionDetox is deployed using the **Ghidra Pattern**:
1. **Sidecar Container:** It runs as a dedicated Python FastAPI container (`detox-bouncer` on port `8006`) within the main Docker Compose stack.
2. **PostgreSQL Integration:** It connects directly to the shared `postgres_data` database using `psycopg2`. All ExtensionDetox tables are prefixed with `detox_` (e.g., `detox_extensions`, `detox_scan_history`).
3. **Shared Volume Handoff:** The `detox-bouncer` and the Rust `hyper-bridge` backend share a named Docker volume (`detox_vsix_data`). When a VSIX needs to be detonated, `hyper-bridge` serves the payload to the sandbox agent directly from this shared volume via a lightweight `/vsix_archive` static file endpoint.

## The Analysis Pipeline

The ExtensionDetox pipeline is split into two phases: **The Bouncer** and **The Chamber**.

### Phase 1: The Bouncer (Static Triage)
The `detox-bouncer` container handles all static analysis prior to detonation:
- **Heuristic Analysis:** Analyzes the `package.json` for excessive permissions, missing repository links, or suspicious publisher metadata.
- **Blocklist Sync:** Synchronizes with community-maintained blocklists (e.g. Microsoft's marketplace blocklist) to proactively flag known bad extensions.
- **Heavyweight Handling:** Automatically detects VSIX files exceeding 20MB. These are flagged as `HEAVYWEIGHT` and their analyses can be manually forced by operators to bypass standard safety limits.
- **Auto-Discovery Engine:** A background task running every **30 minutes** that queries the marketplace for new extensions and queues them for static triage.


### Phase 2: The Chamber (Dynamic Detonation)
If an extension requires deeper analysis, it is sent to the Proxmox sandbox:
1. **Delivery:** The Windows Agent (`agent-windows`) polls the backend for tasks. It receives an `INSTALL_VSIX` command containing the URL to the VSIX file hosted on the `hyper-bridge` `/vsix_archive` endpoint.
2. **Installation:** The agent silently installs the extension using the official VS Code CLI: `code --install-extension <file.vsix> --force`.
3. **Behavioral Monitoring:** Sysmon and the VooDooBox kernel driver monitor the system for malicious behaviors triggered by the extension (e.g., unauthorized network connections, file system modifications, credential dumping).
4. **Agent Telemetry:** The agent reports `VSIX_INSTALLED` or `VSIX_ERROR` events back to the backend, along with standard behavioral telemetry.

## React Frontend Integration

ExtensionDetox provides a dedicated **Mission Control Dashboard** (`DetoxDashboard.tsx`) accessible via the "Detox" (Shield icon) sidebar navigation item.

The dashboard features:
- **Risk Distribution Ring:** A visual representation of the current queue (Clean, Flagged, Pending).
- **Stat Cards:** High-level metrics tracking total extensions, clean/flagged counts, and the average risk score.
- **Extension Table:** A sortable, filterable list of all tracked extensions. Supports universal sorting across all columns (Risk, Installs, Size, Date). Clicking any row opens the **Extension Detail Drawer**.
- **Extension Detail Drawer:** A slide-out panel (`ExtensionDetailDrawer.tsx`) that provides a granular breakdown of an extension's threat report, including YARA findings with syntax-highlighted code snippets, neural AI reasoning logic, and full raw JSON findings.
- **Dynamic Sandbox Submission:** Selecting "Send to Sandbox" from the row actions opens a `SubmissionModal` tailored for VSIX submissions, enabling deployment into Proxmox VMs for behavioral analysis.
- **Custom Scrape Trigger:** A button to trigger a marketplace scraping run with custom search terms, sort methods, and page depth.
- **Global Wipe:** A "Wipe" button in the header to permanently clear the Detox database and VSIX archive for a clean environment state.

## API Endpoints

### `detox-bouncer` (Python FastAPI)
- `GET /health` - Service health status.
- `POST /scan` - Triggers static analysis for a specific extension.
- `POST /scrape` - Triggers a marketplace scrape.
- `POST /scan-pending` - Processes the queue of extensions awaiting triage.
- `DELETE /purge/all` - Wipes all DB records and archived VSIX files.
- `DELETE /purge/{ext_id}` - Deletes a specific extension.
- `POST /blocklist/sync` - Forces a synchronization of the blocklist.
- `GET /stats` - Retrieves high-level dashboard statistics.

### `hyper-bridge` (Rust Actix-Web)
The Rust backend proxies these requests and provides direct database access via the `detox_api` module:
- `GET /api/detox/dashboard` - Dashboard metrics.
- `GET /api/detox/extensions` - List of extensions (filterable by state).
- `GET /api/detox/extension/{id}` - Detailed view of a single extension including scan history and raw findings.
- `POST /api/detox/scan` - Proxies scan requests to the bouncer.
- `POST /api/detox/scrape` - Proxies custom scrape requests to the bouncer.
- `POST /api/detox/scan-pending` - Proxies bulk triage requests.
- `DELETE /api/detox/purge-all` - Proxies global wipe requests.
- `POST /api/detox/sandbox` - Submits a VSIX to the sandbox orchestration queue.
- `GET /api/detox/blocklist` - Retrieves the current blocklist.

## Database Schema (Inline)

The schema is defined inline within `backend/src/main.rs` and consists of six core tables:
- `detox_publishers`: Publisher metadata and reputation.
- `detox_extensions`: Extension metadata, risk scores, and current state.
- `detox_scan_history`: Historical scan results (static, behavioral, AI scores).
- `detox_blocklist`: Synced blocklist entries.
- `detox_iocs`: Extracted Indicators of Compromise.
- `detox_static_findings`: Specific findings from YARA/heuristic analysis.
