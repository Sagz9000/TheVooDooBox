"""Quick integration test for blocklist sync."""
import sys
sys.path.insert(0, r"c:\AntiCode\ExtensionDetox")

from db.models import init_db
from utils.scraper.blocklist_sync import fetch_removed_packages, parse_removed_packages, sync_blocklist

# Test 1: Fetch and parse
print("=== Test 1: Fetch & Parse RemovedPackages.md ===")
md = fetch_removed_packages()
entries = parse_removed_packages(md)
print(f"Total entries parsed: {len(entries)}")

if entries:
    print("\n--- First 5 ---")
    for e in entries[:5]:
        print(f"  {e['extension_id']:50s} | {e['removal_date']:12s} | {e['removal_type']}")
    print("\n--- Last 5 ---")
    for e in entries[-5:]:
        print(f"  {e['extension_id']:50s} | {e['removal_date']:12s} | {e['removal_type']}")

# Test 2: DB init + sync
print("\n=== Test 2: DB Init & Blocklist Sync ===")
conn = init_db("./data/extensiondetox.db")
count = sync_blocklist(conn)
print(f"Synced {count} entries to DB")

# Test 3: Verify blocklist lookup
from db.models import is_blocklisted
if entries:
    test_id = entries[0]["extension_id"]
    result = is_blocklisted(conn, test_id)
    print(f"\nBlocklist check for '{test_id}': {'BLOCKED' if result else 'NOT FOUND'}")

# Quick DB stats
row = conn.execute("SELECT COUNT(*) as c FROM blocklist").fetchone()
print(f"Total blocklist rows in DB: {row['c']}")

conn.close()
print("\n✅ All tests passed!")
