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
        from utils.scraper.marketplace_scraper import MarketplaceScraper
        from core.triage.pipeline import triage_vsix
        from core.reporting.threat_report import ThreatReportGenerator
        from db.models import get_connection

        conn = get_connection()
        scraper = MarketplaceScraper(conn)

        # 1. Fetch metadata from marketplace
        meta = scraper.fetch_extension_metadata(req.extension_id)
        if not meta:
            raise HTTPException(status_code=404, detail=f"Extension '{req.extension_id}' not found on marketplace")

        # 2. Upsert extension into DB so triage has a row to update
        from db.models import upsert_extension, upsert_publisher
        pub_db_id = upsert_publisher(
            conn,
            publisher_id=meta.get("publisher_id", ""),
            publisher_name=meta.get("publisher_name", ""),
            domain=meta.get("publisher_domain", ""),
            is_domain_verified=meta.get("is_domain_verified", False),
        )
        upsert_extension(
            conn,
            extension_id=req.extension_id,
            version=meta.get("version", "latest"),
            display_name=meta.get("display_name", ""),
            short_desc=meta.get("short_desc", ""),
            published_date=meta.get("published_date", ""),
            last_updated=meta.get("last_updated", ""),
            install_count=meta.get("install_count", 0),
            average_rating=meta.get("average_rating", 0.0),
            publisher_db_id=pub_db_id,
        )

        # 3. Download VSIX
        version_to_download = req.version or meta.get("version", "latest")
        vsix_path = scraper.download_vsix(req.extension_id, version_to_download)
        if not vsix_path:
            raise HTTPException(status_code=500, detail="Failed to download VSIX")

        # 4. Run triage pipeline
        config = scraper.config
        triage_result = triage_vsix(vsix_path, config=config)

        # 5. Generate threat report and persist to DB
        try:
            from db.models import get_extension
            ext_row = get_extension(conn, req.extension_id, meta.get("version", "latest"))
            if ext_row:
                report_gen = ThreatReportGenerator(conn, config)
                report = report_gen.generate(ext_row["id"], triage_result=triage_result)
            else:
                print(f"[BOUNCER] Warning: Could not find DB row for {req.extension_id} to generate report")
        except Exception as report_err:
            print(f"[BOUNCER] Warning: Threat report generation failed: {report_err}")
            traceback.print_exc()

        return {
            "status": "complete",
            "extension_id": req.extension_id,
            "risk_score": triage_result.composite_risk,
            "verdict": triage_result.verdict,
            "findings_count": triage_result.total_findings,
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
        from utils.scraper.marketplace_scraper import MarketplaceScraper
        from core.triage.pipeline import triage_vsix
        from core.reporting.threat_report import ThreatReportGenerator
        from db.models import get_connection

        conn = get_connection()
        scraper = MarketplaceScraper(conn)
        config = scraper.config
        count = scraper.discover_and_store(max_pages=req.max_pages, page_size=50)
        
        # Trigger a small batch of downloads for any newly queued extensions
        downloaded = scraper.download_queued(limit=10)
        
        triage_started = 0
        # Automatically run triage on the downloaded extensions
        for ext in downloaded:
            try:
                triage_result = triage_vsix(ext["vsix_path"], config=config)
                # Generate threat report
                try:
                    from db.models import get_extension
                    ext_row = get_extension(conn, ext["extension_id"], ext["version"])
                    if ext_row:
                        report_gen = ThreatReportGenerator(conn, config)
                        report_gen.generate(ext_row["id"], triage_result=triage_result)
                except Exception as report_err:
                    print(f"[BOUNCER] Warning: Report generation failed for {ext['extension_id']}: {report_err}")
                triage_started += 1
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


# ── Purge Extension ──────────────────────────────────────────────────────────
@app.delete("/purge/{ext_id}")
async def purge_extension(ext_id: int):
    """Delete an extension, its scan history, and its VSIX file."""
    try:
        from db.models import get_connection
        import psycopg2.extras

        conn = get_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # 1. Look up the extension
        cur.execute("SELECT extension_id, version FROM detox_extensions WHERE id = %s", (ext_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Extension with id {ext_id} not found")

        extension_id = row["extension_id"]
        version = row["version"]

        # 2. Delete scan history
        cur.execute("DELETE FROM detox_scan_history WHERE extension_id = %s", (ext_id,))

        # 3. Delete the extension row
        cur.execute("DELETE FROM detox_extensions WHERE id = %s", (ext_id,))
        conn.commit()

        # 4. Delete the VSIX file if it exists
        vsix_path = f"/app/data/vsix_archive/{extension_id}_{version}.vsix"
        if os.path.exists(vsix_path):
            os.remove(vsix_path)
            print(f"[BOUNCER] Deleted VSIX: {vsix_path}")

        cur.close()
        return {"status": "purged", "extension_id": extension_id, "version": version}

    except HTTPException:
        raise
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
