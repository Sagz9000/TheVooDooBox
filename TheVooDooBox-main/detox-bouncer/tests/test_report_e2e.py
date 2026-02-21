"""
E2E test: Triage + Reporting pipeline.

Runs the full flow: discover -> download -> triage -> generate report.
"""
import sys
sys.path.insert(0, r"c:\AntiCode\ExtensionDetox")

import logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
)

from db.models import init_db
from utils.scraper.marketplace_scraper import MarketplaceScraper
from core.triage.pipeline import TriagePipeline
from core.reporting.threat_report import ThreatReportGenerator

# Init
conn = init_db("./data/extensiondetox.db")
scraper = MarketplaceScraper(conn)

# Get an existing downloaded VSIX, or download one
row = conn.execute(
    "SELECT * FROM extensions WHERE vsix_hash_sha256 IS NOT NULL ORDER BY install_count DESC LIMIT 1"
).fetchone()

if not row:
    print("No downloaded extensions found. Discovering and downloading...")
    scraper.discover_and_store(search_text="color highlight", max_pages=1, page_size=3)
    row = conn.execute(
        "SELECT * FROM extensions WHERE scan_state = 'QUEUED' ORDER BY install_count DESC LIMIT 1"
    ).fetchone()
    if row:
        scraper.download_vsix(row["extension_id"], row["version"])
        row = conn.execute("SELECT * FROM extensions WHERE id = ?", (row["id"],)).fetchone()

if not row:
    print("Failed to get extension. Exiting.")
    sys.exit(1)

ext_id = row["extension_id"]
version = row["version"]
db_id = row["id"]

# Find the VSIX file
from pathlib import Path
vsix_path = Path("data/vsix_archive") / f"{ext_id}_{version}.vsix"
if not vsix_path.exists():
    print(f"VSIX not found at {vsix_path}. Exiting.")
    sys.exit(1)

print(f"\n{'='*60}")
print(f"TESTING: {ext_id} v{version}")
print(f"{'='*60}")

# Step 1: Triage
print("\n--- Triage Pipeline ---")
pipeline = TriagePipeline(skip_ai=True)
triage = pipeline.run(str(vsix_path))

# Step 2: Generate Report
print("\n--- Threat Report ---")
generator = ThreatReportGenerator(conn)
report = generator.generate(db_id, triage_result=triage)

# Print report summary
print(f"\n{'='*60}")
print(f"THREAT REPORT: {report.extension_id} v{report.version}")
print(f"{'='*60}")
print(f"Publisher:     {report.publisher_name} {'[VERIFIED]' if report.publisher_verified else '[UNVERIFIED]'}")
print(f"Installs:      {report.install_count:,}")
print(f"Rating:        {report.average_rating:.1f}")
print(f"Blocklisted:   {report.is_blocklisted}")
print(f"")
print(f"AI Vibe:       {report.ai_vibe_score:.2f}")
print(f"Static:        {report.static_analysis_score:.2f}")
print(f"Behavioral:    {report.behavioral_score:.2f}")
print(f"Trust Signal:  {report.trust_signal_score:.2f}")
print(f"VT Detections: {report.vt_detection_count}/{report.vt_total_engines}")
print(f"Campaign:      {report.campaign_score:.2f}")
print(f"")
print(f"COMPOSITE:     {report.composite_score:.2f}")
print(f"VERDICT:       {report.verdict}")
print(f"CONFIDENCE:    {report.confidence:.2f}")
print(f"FINDINGS:      {report.severity_summary()}")
print(f"ESCALATE:      {report.escalated_to_chamber}")

# Verify DB persistence
scan = conn.execute(
    "SELECT * FROM scan_history WHERE extension_db_id = ? ORDER BY id DESC LIMIT 1",
    (db_id,),
).fetchone()
if scan:
    print(f"\nDB Scan Record: ID={scan['id']}, type={scan['scan_type']}, composite={scan['composite_score']}")
else:
    print("\nWARNING: No scan record found in DB!")

conn.close()
print("\nDone!")
