"""Debug: inspect raw Marketplace API response."""
import sys, json
sys.path.insert(0, r"c:\AntiCode\ExtensionDetox")

from db.models import init_db
from utils.scraper.marketplace_scraper import MarketplaceScraper

conn = init_db("./data/extensiondetox.db")
scraper = MarketplaceScraper(conn)

# Raw API call
resp = scraper.query_extensions(page_number=1, page_size=3, sort_by=4, sort_order=2)

# Dump keys at each level
print("Top-level keys:", list(resp.keys()))
for r in resp.get("results", []):
    print("  Result keys:", list(r.keys()))
    exts = r.get("extensions", [])
    print(f"  Extensions count: {len(exts)}")
    if exts:
        ext = exts[0]
        print("  First ext keys:", list(ext.keys()))
        print(f"  extensionName: {ext.get('extensionName')}")
        pub = ext.get("publisher", {})
        print(f"  publisher keys: {list(pub.keys())}")
        print(f"  publisherName: {pub.get('publisherName')}")
        print(f"  isDomainVerified: {pub.get('isDomainVerified')}")
        versions = ext.get("versions", [])
        print(f"  versions count: {len(versions)}")
        if versions:
            print(f"  latest version: {versions[0].get('version')}")
        stats = ext.get("statistics", [])
        print(f"  statistics count: {len(stats)}")
        if stats:
            for s in stats[:3]:
                print(f"    {s.get('statisticName')}: {s.get('value')}")

conn.close()
