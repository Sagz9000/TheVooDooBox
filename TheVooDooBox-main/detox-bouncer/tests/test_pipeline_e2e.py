"""
End-to-end triage pipeline test.

Downloads a small real VSIX and runs the full static analysis pipeline
(skipping AI since the server may not be reachable from dev machine).
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

# Init DB
conn = init_db("./data/extensiondetox.db")

# Search for a small, known extension to test with
scraper = MarketplaceScraper(conn)

# Discover a few extensions
print("=== Step 1: Discover extensions ===")
total = scraper.discover_and_store(search_text="color highlight", max_pages=1, page_size=3)
print(f"Discovered: {total}")

# Get first queued extension
row = conn.execute(
    "SELECT * FROM extensions WHERE scan_state = 'QUEUED' ORDER BY install_count DESC LIMIT 1"
).fetchone()

if not row:
    print("No queued extensions found. Exiting.")
    sys.exit(0)

ext_id = row["extension_id"]
version = row["version"]
print(f"\n=== Step 2: Download VSIX: {ext_id} v{version} ===")

vsix_path = scraper.download_vsix(ext_id, version)
if not vsix_path:
    print("Download failed. Exiting.")
    sys.exit(1)

print(f"Downloaded to: {vsix_path}")

# Run the triage pipeline (skip AI for this test)
print(f"\n=== Step 3: Run Triage Pipeline (AI skipped) ===")
pipeline = TriagePipeline(skip_ai=True)
result = pipeline.run(vsix_path)

# Summary
print(f"\n{'='*60}")
print(f"Extension: {result.extension_id} v{result.version}")
print(f"Verdict:   {result.verdict}")
print(f"Composite: {result.composite_risk:.2f}")
print(f"Scores:    metadata={result.metadata_risk:.2f}, forensic={result.forensic_risk:.2f}, yara={result.yara_risk:.2f}")
print(f"Findings:  {result.total_findings} total, {result.high_findings} HIGH, {result.critical_findings} CRITICAL")
print(f"Escalate:  {result.escalate_to_chamber}")
if result.escalation_reasons:
    print(f"Reasons:   {', '.join(result.escalation_reasons)}")

# Show specific metadata findings
if result.metadata_result:
    print(f"\n--- Metadata Findings ({len(result.metadata_result.findings)}) ---")
    for f in result.metadata_result.findings[:10]:
        print(f"  [{f['severity']:8s}] {f['check_name']}: {f['description'][:100]}")
    if result.metadata_result.activation_events:
        print(f"  Activation Events: {result.metadata_result.activation_events[:5]}")

# Show YARA findings
if result.yara_result and result.yara_result.findings:
    print(f"\n--- YARA Findings ({len(result.yara_result.findings)}) ---")
    for f in result.yara_result.findings[:10]:
        print(f"  [{f.severity:8s}] {f.rule_name}: {f.file_path}:{f.line_number}")

# Show forensic findings
if result.forensic_result and result.forensic_result.findings:
    print(f"\n--- Forensic Findings ({len(result.forensic_result.findings)}) ---")
    for f in result.forensic_result.findings[:5]:
        print(f"  [{f.severity:8s}] {f.check_name}: {f.description[:100]}")

conn.close()
print("\nDone!")
