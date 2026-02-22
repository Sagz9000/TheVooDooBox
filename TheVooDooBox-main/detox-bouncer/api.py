"""
ExtensionDetox Bouncer — FastAPI HTTP API
==========================================
Ghidra-style sidecar container. The Rust backend (hyper-bridge) calls
these endpoints to trigger scans, scrapes, and blocklist syncs.
"""

import os
import traceback
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="ExtensionDetox Bouncer", version="1.0.0")

# ── Global Control ──
STOP_SIGNAL = False

def check_stop():
    global STOP_SIGNAL
    if STOP_SIGNAL:
        print("[BOUNCER] 🛑 Received STOP_SIGNAL. Halting operations.")
        return True
    return False

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


class ScanRequest(BaseModel):
    extension_id: str                # Marketplace extension ID, e.g. "ms-python.python"
    version: Optional[str] = None    # Specific version, or None for latest
    force: bool = False              # If true, overrides the 20MB heavyweight limit

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
            
        resolved_ext_id = meta.get("extension_id", req.extension_id)

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
            extension_id=resolved_ext_id,
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
        vsix_path = scraper.download_vsix(resolved_ext_id, version_to_download, allow_heavyweight=req.force)
        
        if not vsix_path:
            # Check if it failed because it was too large
            from db.models import get_extension
            ext_row = get_extension(conn, resolved_ext_id, version_to_download)
            if ext_row and ext_row.get("scan_state") == "HEAVYWEIGHT":
                raise HTTPException(status_code=413, detail="Extension is >20MB. Use force=true to download.")
            raise HTTPException(status_code=500, detail="Failed to download VSIX")

        # Look up DB row for state tracking
        from db.models import get_extension, update_scan_state
        ext_row = get_extension(conn, resolved_ext_id, meta.get("version", "latest"))
        ext_db_id = ext_row["id"] if ext_row else None

        # 4. Mark as scanning
        if ext_db_id:
            update_scan_state(conn, ext_db_id, "STATIC_SCANNING")
            conn.commit()
            print(f"[BOUNCER] ► Scanning {resolved_ext_id}...")

        # 5. Run triage pipeline
        config = scraper.config
        
        def make_pre_ai_callback(db_id):
            def cb(partial_triage_result):
                if not db_id: return
                try:
                    from core.reporting.threat_report import ThreatReportGenerator
                    update_scan_state(conn, db_id, "STATIC_SCANNED")
                    report_gen = ThreatReportGenerator(conn, config)
                    report_gen.generate(db_id, triage_result=partial_triage_result)
                    conn.commit()
                    print(f"[BOUNCER] ◷ Intermediate report generated for {resolved_ext_id}")
                except Exception as cb_err:
                    print(f"[BOUNCER] Warning: Intermediate report failed: {cb_err}")
            return cb

        triage_result = await run_in_threadpool(
            triage_vsix, 
            vsix_path, 
            config=config,
            pre_ai_callback=make_pre_ai_callback(ext_db_id)
        )

        # 6. Generate threat report (which calculates final composite score and verdict)
        report = None
        try:
            if ext_db_id:
                report_gen = ThreatReportGenerator(conn, config)
                report = await run_in_threadpool(report_gen.generate, ext_db_id, triage_result=triage_result)
        except Exception as report_err:
            print(f"[BOUNCER] Warning: Threat report generation failed: {report_err}")
            traceback.print_exc()

        # 7. Update state and risk_score based on the FINAL report verdict
        final_risk = report.composite_score if report else triage_result.composite_risk
        final_verdict = report.verdict if report else triage_result.verdict

        if ext_db_id:
            final_state = "FLAGGED" if final_verdict in ("SUSPICIOUS", "MALICIOUS") else "CLEAN"
            update_scan_state(conn, ext_db_id, final_state)
            
            # Persist risk_score to detox_extensions
            cur = conn.cursor()
            cur.execute(
                "UPDATE detox_extensions SET risk_score = %s WHERE id = %s",
                (final_risk, ext_db_id),
            )
            cur.close()
            conn.commit()
            print(f"[BOUNCER] ✓ {resolved_ext_id}: {final_state} (risk={final_risk:.2f})")

        return {
            "status": "complete",
            "extension_id": resolved_ext_id,
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
    search_text: str = ""
    max_pages: int = 5
    sort_by: str = "PublishedDate"

@app.post("/scrape")
async def scrape_marketplace(req: ScrapeRequest):
    """Trigger the marketplace scraper to discover new/updated extensions."""
    global STOP_SIGNAL
    STOP_SIGNAL = False # Reset on new request
    try:
        from utils.scraper.marketplace_scraper import MarketplaceScraper
        from core.triage.pipeline import triage_vsix
        from core.reporting.threat_report import ThreatReportGenerator
        from db.models import get_connection

        conn = get_connection()
        scraper = MarketplaceScraper(conn)
        config = scraper.config
        
        # Map sort string to Marketplace API sort_by int
        sort_map = {
            "PublishedDate": 4,
            "UpdatedDate": 8,
            "InstallCount": 10,
            "Rating": 12
        }
        sort_int = sort_map.get(req.sort_by, 4)  # Default PublishedDate

        count = await run_in_threadpool(
            scraper.discover_and_store,
            search_text=req.search_text,
            max_pages=req.max_pages, 
            page_size=50,
            sort_by=sort_int,
            stop_check=check_stop
        )
        
        # No longer triggering downloads or triage here. 
        # /scrape is now strictly for discovery and queuing.
        return {"status": "complete", "extensions_discovered": count}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ── Bulk Scan Pending ────────────────────────────────────────────────────────
class ScanPendingRequest(BaseModel):
    limit: int = 10

@app.post("/scan-pending")
async def scan_pending(req: ScanPendingRequest):
    """Fetch queued extensions, download them, and run them through triage."""
    global STOP_SIGNAL
    STOP_SIGNAL = False # Reset on new request
    try:
        from utils.scraper.marketplace_scraper import MarketplaceScraper
        from core.triage.pipeline import triage_vsix
        from core.reporting.threat_report import ThreatReportGenerator
        from db.models import get_connection

        conn = get_connection()
        scraper = MarketplaceScraper(conn)
        config = scraper.config
        
        # Download up to `limit` extensions that are in QUEUED state
        downloaded = await run_in_threadpool(scraper.download_queued, limit=req.limit)
        
        triage_started = 0
        for ext in downloaded:
            if check_stop():
                break
                
            try:
                from db.models import get_extension, update_scan_state
                ext_row = get_extension(conn, ext["extension_id"], ext["version"])
                ext_db_id = ext_row["id"] if ext_row else None

                # Mark as scanning
                if ext_db_id:
                    update_scan_state(conn, ext_db_id, "STATIC_SCANNING")
                    conn.commit()
                    print(f"[BOUNCER] ► Auto-triaging {ext['extension_id']}...")

                def make_pre_ai_callback(db_id):
                    def cb(partial_triage_result):
                        if not db_id: return
                        try:
                            from core.reporting.threat_report import ThreatReportGenerator
                            update_scan_state(conn, db_id, "STATIC_SCANNED")
                            report_gen = ThreatReportGenerator(conn, config)
                            report_gen.generate(db_id, triage_result=partial_triage_result)
                            conn.commit()
                            print(f"[BOUNCER] ◷ Intermediate report generated for {ext['extension_id']}")
                        except Exception as cb_err:
                            print(f"[BOUNCER] Warning: Intermediate report failed: {cb_err}")
                    return cb

                triage_result = await run_in_threadpool(
                    triage_vsix, 
                    ext["vsix_path"], 
                    config=config,
                    pre_ai_callback=make_pre_ai_callback(ext_db_id)
                )

                # Generate threat report FIRST (which calculates final composite score and verdict)
                report = None
                try:
                    if ext_db_id:
                        report_gen = ThreatReportGenerator(conn, config)
                        report = await run_in_threadpool(report_gen.generate, ext_db_id, triage_result=triage_result)
                except Exception as report_err:
                    print(f"[BOUNCER] Warning: Report generation failed for {ext['extension_id']}: {report_err}")
                
                # Update state and risk score based on the FINAL report verdict
                final_risk = report.composite_score if report else triage_result.composite_risk
                final_verdict = report.verdict if report else triage_result.verdict

                if ext_db_id:
                    final_state = "FLAGGED" if final_verdict in ("SUSPICIOUS", "MALICIOUS") else "CLEAN"
                    update_scan_state(conn, ext_db_id, final_state)
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE detox_extensions SET risk_score = %s WHERE id = %s",
                        (final_risk, ext_db_id),
                    )
                    cur.close()
                    conn.commit()
                    print(f"[BOUNCER] ✓ {ext['extension_id']}: {final_state} (risk={final_risk:.2f})")
                triage_started += 1
            except Exception as e:
                print(f"[BOUNCER] Error auto-triaging {ext['extension_id']}: {e}")
                traceback.print_exc()

        return {"status": "complete", "triage_started": triage_started}

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


@app.post("/kill")
async def kill_processing():
    """Immediately stop any active scraping or scan-pending tasks."""
    global STOP_SIGNAL
    STOP_SIGNAL = True
    print("[BOUNCER] ☢ STOP_SIGNAL BROADCAST")
    return {"status": "stopping"}


# ── Global Purge ─────────────────────────────────────────────────────────────
@app.delete("/purge/all")
async def purge_all_data():
    """Wipe all extension records, scan history, and archived VSIX files."""
    try:
        from db.models import get_connection
        import shutil

        conn = get_connection()
        cur = conn.cursor()

        # 1. Delete scan history
        cur.execute("DELETE FROM detox_scan_history")

        # 2. Delete all extensions
        cur.execute("DELETE FROM detox_extensions")
        
        # 3. Delete all publishers
        cur.execute("DELETE FROM detox_publishers")
        
        # Reset IDs
        cur.execute("ALTER SEQUENCE detox_extensions_id_seq RESTART WITH 1")
        cur.execute("ALTER SEQUENCE detox_scan_history_id_seq RESTART WITH 1")
        cur.execute("ALTER SEQUENCE detox_publishers_id_seq RESTART WITH 1")
        
        conn.commit()
        cur.close()

        # 3. Wipe the VSIX archive directory
        vsix_dir = "/app/data/vsix_archive"
        if os.path.exists(vsix_dir):
            for filename in os.listdir(vsix_dir):
                file_path = os.path.join(vsix_dir, filename)
                try:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                except Exception as e:
                    print(f"[BOUNCER] Error deleting {file_path}: {e}")

        print("[BOUNCER] ☢ GLOBAL PURGE COMPLETE")
        return {"status": "all_purged"}

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
        cur.execute("DELETE FROM detox_scan_history WHERE extension_db_id = %s", (ext_id,))

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
