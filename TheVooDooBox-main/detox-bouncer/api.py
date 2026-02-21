"""
ExtensionDetox Bouncer — FastAPI HTTP API
==========================================
Ghidra-style sidecar container. The Rust backend (hyper-bridge) calls
these endpoints to trigger scans, scrapes, and blocklist syncs.
"""

import os
import traceback
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="ExtensionDetox Bouncer", version="1.0.0")

# ── Startup ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    from db.models import init_db
    init_db()
    print("[BOUNCER] Database initialized. Ready for scans.")


# ── Health ───────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "detox-bouncer"}


# ── Scan Request ─────────────────────────────────────────────────────────────
class ScanRequest(BaseModel):
    extension_id: str                # Marketplace extension ID, e.g. "ms-python.python"
    version: Optional[str] = None    # Specific version, or None for latest

@app.post("/scan")
async def scan_extension(req: ScanRequest):
    """
    Run the full static triage pipeline on a single extension.
    Downloads the VSIX if needed, then runs metadata scan, forensic check,
    YARA, Semgrep, deobfuscation, and AI Vibe Check.
    """
    try:
        from utils.scraper.marketplace_scraper import fetch_extension_metadata, download_vsix
        from core.triage.pipeline import run_triage
        from db.models import get_connection

        conn = get_connection()

        # 1. Fetch metadata from marketplace
        meta = fetch_extension_metadata(req.extension_id)
        if not meta:
            raise HTTPException(status_code=404, detail=f"Extension '{req.extension_id}' not found on marketplace")

        # 2. Download VSIX
        vsix_path = download_vsix(meta, conn)
        if not vsix_path:
            raise HTTPException(status_code=500, detail="Failed to download VSIX")

        # 3. Run triage pipeline
        result = run_triage(vsix_path, meta, conn)

        return {
            "status": "complete",
            "extension_id": req.extension_id,
            "risk_score": result.get("risk_score", 0),
            "verdict": result.get("verdict", "unknown"),
            "findings_count": len(result.get("findings", [])),
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Marketplace Scraper ──────────────────────────────────────────────────────
class ScrapeRequest(BaseModel):
    max_pages: int = 5
    sort_by: str = "UpdatedDate"

@app.post("/scrape")
async def scrape_marketplace(req: ScrapeRequest):
    """Trigger the marketplace scraper to discover new/updated extensions."""
    try:
        from utils.scraper.marketplace_scraper import MarketplaceScraper, fetch_extension_metadata
        from core.triage.pipeline import run_triage
        from db.models import get_connection

        conn = get_connection()
        scraper = MarketplaceScraper(conn)
        count = scraper.discover_and_store(max_pages=req.max_pages, page_size=50)
        
        # Trigger a small batch of downloads for any newly queued extensions
        downloaded = scraper.download_queued(limit=10)
        
        triage_started = 0
        # Automatically run triage on the downloaded extensions
        for ext in downloaded:
            try:
                # Fetch metadata required for triage
                meta = fetch_extension_metadata(ext["extension_id"])
                if meta:
                    run_triage(ext["vsix_path"], meta, conn)
                    triage_started += 1
                else:
                    print(f"[BOUNCER] Warning: No metadata found for {ext['extension_id']} during auto-triage")
            except Exception as e:
                print(f"[BOUNCER] Error auto-triaging {ext['extension_id']}: {e}")
                traceback.print_exc()

        return {"status": "complete", "extensions_discovered": count, "triage_started": triage_started}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Blocklist Sync ───────────────────────────────────────────────────────────
@app.post("/blocklist/sync")
async def sync_blocklist():
    """Pull the latest RemovedPackages.md from Microsoft's GitHub."""
    try:
        from utils.scraper.blocklist_sync import sync_blocklist
        from db.models import get_connection

        conn = get_connection()
        count = sync_blocklist(conn)
        return {"status": "complete", "blocklist_entries": count}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Dashboard Stats (convenience endpoint) ───────────────────────────────────
@app.get("/stats")
async def get_stats():
    """Return aggregate stats for the dashboard."""
    try:
        from db.models import get_connection

        conn = get_connection()
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM detox_extensions")
        total = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM detox_extensions WHERE latest_state = 'clean'")
        clean = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM detox_extensions WHERE latest_state = 'flagged'")
        flagged = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM detox_extensions WHERE latest_state = 'pending'")
        pending = cur.fetchone()[0]

        cur.execute("SELECT COALESCE(AVG(risk_score), 0) FROM detox_scan_history WHERE risk_score IS NOT NULL")
        avg_risk = round(cur.fetchone()[0], 1)

        cur.execute("SELECT COUNT(*) FROM detox_blocklist")
        blocklist_count = cur.fetchone()[0]

        return {
            "total_extensions": total,
            "clean": clean,
            "flagged": flagged,
            "pending": pending,
            "avg_risk_score": avg_risk,
            "blocklist_count": blocklist_count,
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
