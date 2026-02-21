#!/usr/bin/env bash
# ==============================================================================
# TheVooDooBox - ExtensionDetox Automated Feeder
# ==============================================================================
# This cron script runs daily to feed new and updated VS Code extensions
# into the ExtensionDetox triage pipeline.
#
# Recommended Crontab:
# 0 2 * * * /opt/TheVooDooBox/modules/ExtensionDetox/utils/voodoo_feed_cron.sh
# ==============================================================================

set -euo pipefail

DETOX_DIR="/opt/TheVooDooBox/modules/ExtensionDetox"
VENV_PYTHON="$DETOX_DIR/.venv/bin/python"
LOG_FILE="/var/log/voodoobox/extension_detox_feeder.log"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting ExtensionDetox Feeder..." >> "$LOG_FILE"

cd "$DETOX_DIR"

# 1. Sync Microsoft Blocklist (RemovedPackages.md)
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Phase 1: Syncing Blocklist..." >> "$LOG_FILE"
$VENV_PYTHON utils/scraper/blocklist_sync.py >> "$LOG_FILE" 2>&1

# 2. Scrape Marketplace for high-risk / newly updated extensions
# (e.g., search for common generic terms or sort by recently updated)
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Phase 2: Scraping Marketplace Latest..." >> "$LOG_FILE"
# Replace with actual CLI entrypoint when built, representing discovery
$VENV_PYTHON -c "
import sys
from db.models import init_db
from utils.scraper.marketplace_scraper import MarketplaceScraper
conn = init_db('data/extensiondetox.db')
scraper = MarketplaceScraper(conn)
scraper.discover_and_store(search_text='', max_pages=5, page_size=50) # Top 250 updated
" >> "$LOG_FILE" 2>&1

# 3. Trigger Triage Pipeline for QUEUED extensions
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Phase 3: Processing Queue..." >> "$LOG_FILE"
# Again, replace with the CLI entrypoint for batch queue processing
$VENV_PYTHON -c "
import sys
from db.models import init_db
from core.triage.pipeline import TriagePipeline
conn = init_db('data/extensiondetox.db')
# Logic to pop QUEUED and run pipeline would go here
print('Queue processing triggered.')
" >> "$LOG_FILE" 2>&1

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] ExtensionDetox Feeder Complete." >> "$LOG_FILE"
