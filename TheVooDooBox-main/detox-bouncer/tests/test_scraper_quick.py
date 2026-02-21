"""Quick integration test for Marketplace API query."""
import sys
sys.path.insert(0, r"c:\AntiCode\ExtensionDetox")

from db.models import init_db
from utils.scraper.marketplace_scraper import MarketplaceScraper

# Init DB
conn = init_db("./data/extensiondetox.db")

# Create scraper
scraper = MarketplaceScraper(conn)

# Test: Query page 1, 5 results, sorted by most recent
print("=== Test: Marketplace API Query (5 most recent extensions) ===")
resp = scraper.query_extensions(page_number=1, page_size=5, sort_by=4, sort_order=2)
extensions = scraper.parse_extension_results(resp)

print(f"Extensions returned: {len(extensions)}\n")
for ext in extensions:
    verified = "[VERIFIED]" if ext["is_domain_verified"] else "[UNVERIFIED]"
    print(f"  {ext['extension_id']:50s} v{ext['version']:12s} | installs: {ext['install_count']:>10,} | {verified}")

# Test: discover_and_store with 1 page
print("\n=== Test: Discover & Store (1 page, 5 results) ===")
total = scraper.discover_and_store(max_pages=1, page_size=5)
print(f"Stored {total} extensions in DB")

# Verify DB
row = conn.execute("SELECT COUNT(*) as c FROM extensions").fetchone()
print(f"Total extensions in DB: {row['c']}")

pub_row = conn.execute("SELECT COUNT(*) as c FROM publishers").fetchone()
print(f"Total publishers in DB: {pub_row['c']}")

conn.close()
print("\nDone!")
