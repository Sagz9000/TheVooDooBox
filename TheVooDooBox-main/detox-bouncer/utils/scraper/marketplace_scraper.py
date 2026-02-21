"""
ExtensionDetox - Marketplace Scraper

Polls the VS Code Marketplace API to discover and download extensions.
Implements rate limiting, backoff, and publisher identity tracking.

Aligned with TheVooDooBox infrastructure patterns.
"""

import hashlib
import json
import logging
import os
import random
import time
from pathlib import Path
from typing import Optional

import requests
import yaml
import psycopg2.extras

# Resolve paths relative to project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "config.yaml"

# ──────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ExtensionDetox.Scraper")


# ──────────────────────────────────────────────
# Config Loader
# ──────────────────────────────────────────────
def load_config() -> dict:
    """Load config.yaml from project root."""
    with open(CONFIG_PATH, "r") as f:
        return yaml.safe_load(f)


# ──────────────────────────────────────────────
# Randomized User-Agents for rate-limit evasion
# ──────────────────────────────────────────────
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "VSCode/1.96.0 (ExtensionDetox/0.1.0)",
]


class MarketplaceScraper:
    """
    Scrapes the VS Code Marketplace API for extension metadata
    and downloads VSIX archives.

    Features:
    - Rate limiting with randomized delays
    - Exponential backoff on failures
    - Publisher identity and verification tracking
    - SHA256 hashing of downloaded archives
    - Blocklist checking before processing
    """

    # Marketplace API endpoint
    API_URL = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery"

    # VSIX download URL template
    VSIX_URL_TEMPLATE = (
        "https://{publisher}.gallery.vsassets.io/_apis/public/gallery/"
        "publisher/{publisher}/extension/{extension}/latest/assetbyname/"
        "Microsoft.VisualStudio.Services.VSIXPackage"
    )

    def __init__(self, db_conn, config: dict = None):
        """
        Args:
            db_conn: SQLite connection from db.models.init_db()
            config: Parsed config.yaml dict. If None, loads from default path.
        """
        self.conn = db_conn
        self.config = config or load_config()

        mp_cfg = self.config.get("marketplace", {})
        self.rate_limit_delay = mp_cfg.get("rate_limit_delay_seconds", 2.0)
        self.max_retries = mp_cfg.get("max_retries", 3)
        self.backoff_factor = mp_cfg.get("backoff_factor", 2.0)
        self.query_flags = mp_cfg.get("query_flags", 256)

        storage_cfg = self.config.get("storage", {})
        self.vsix_dir = Path(storage_cfg.get("vsix_dir", "./data/vsix_archive"))
        self.vsix_dir.mkdir(parents=True, exist_ok=True)
        self.max_vsix_size_mb = storage_cfg.get("max_vsix_size_mb", 500)

        self.session = requests.Session()

    def _get_headers(self) -> dict:
        """Generate request headers with a randomized User-Agent."""
        return {
            "Content-Type": "application/json",
            "Accept": "application/json;api-version=6.1-preview.1",
            "User-Agent": random.choice(USER_AGENTS),
        }

    def _rate_limit(self):
        """Sleep with jitter for rate limiting."""
        jitter = random.uniform(0.5, 1.5)
        delay = self.rate_limit_delay * jitter
        time.sleep(delay)

    def _request_with_backoff(self, method: str, url: str, **kwargs) -> requests.Response:
        """Make an HTTP request with exponential backoff on failure."""
        for attempt in range(self.max_retries):
            try:
                kwargs["headers"] = self._get_headers()
                kwargs["timeout"] = 30
                resp = self.session.request(method, url, **kwargs)

                if resp.status_code == 429:
                    # Rate limited — back off aggressively
                    wait = self.backoff_factor ** (attempt + 2)
                    logger.warning(f"Rate limited (429). Waiting {wait:.1f}s...")
                    time.sleep(wait)
                    continue

                resp.raise_for_status()
                return resp

            except requests.exceptions.RequestException as e:
                wait = self.backoff_factor ** (attempt + 1)
                logger.warning(f"Request failed (attempt {attempt + 1}/{self.max_retries}): {e}. Retrying in {wait:.1f}s...")
                time.sleep(wait)

        raise RuntimeError(f"All {self.max_retries} retries exhausted for {url}")

    # ──────────────────────────────────────────
    # Marketplace API Queries
    # ──────────────────────────────────────────

    def query_extensions(
        self,
        search_text: str = "",
        page_number: int = 1,
        page_size: int = 50,
        sort_by: int = 4,  # 4 = PublishedDate
        sort_order: int = 2,  # 2 = Descending
    ) -> dict:
        """
        Query the VS Code Marketplace API.

        Args:
            search_text: Search filter text (empty = all extensions)
            page_number: Page number (1-indexed)
            page_size: Results per page (max 100)
            sort_by: 4=PublishedDate, 10=InstallCount, 12=Rating
            sort_order: 1=Ascending, 2=Descending

        Returns:
            Raw API response as dict
        """
        payload = {
            "filters": [
                {
                    "criteria": [
                        {"filterType": 8, "value": "Microsoft.VisualStudio.Code"},
                    ],
                    "pageNumber": page_number,
                    "pageSize": page_size,
                    "sortBy": sort_by,
                    "sortOrder": sort_order,
                }
            ],
            "assetTypes": [],
            "flags": self.query_flags,  # 256 = include statistics
        }

        if search_text:
            payload["filters"][0]["criteria"].append(
                {"filterType": 10, "value": search_text}
            )

        self._rate_limit()
        resp = self._request_with_backoff("POST", self.API_URL, json=payload)
        return resp.json()

    def parse_extension_results(self, api_response: dict) -> list[dict]:
        """
        Parse the raw Marketplace API response into clean extension records.

        Returns:
            List of dicts with keys: extension_id, version, display_name,
            short_desc, publisher_id, publisher_name, is_domain_verified,
            install_count, average_rating, published_date, last_updated
        """
        results = []
        for result_set in api_response.get("results", []):
            for ext in result_set.get("extensions", []):
                publisher = ext.get("publisher", {})
                publisher_id = publisher.get("publisherId", "")
                publisher_name = publisher.get("publisherName", "")
                is_verified = publisher.get("isDomainVerified", False)
                domain = publisher.get("domain", "")

                # Get version info (depends on query flags)
                versions = ext.get("versions", [])
                if versions:
                    latest = versions[0]
                    version = latest.get("version", "unknown")
                    last_updated = latest.get("lastUpdated", ext.get("lastUpdated", ""))
                else:
                    version = "latest"
                    last_updated = ext.get("lastUpdated", "")

                # Parse statistics
                stats = {
                    s.get("statisticName"): s.get("value", 0)
                    for s in ext.get("statistics", [])
                }
                install_count = int(stats.get("install", stats.get("downloadCount", 0)))
                avg_rating = float(stats.get("averagerating", 0.0))

                ext_id = f"{publisher_name}.{ext.get('extensionName', '')}"

                results.append({
                    "extension_id": ext_id,
                    "version": version,
                    "display_name": ext.get("displayName", ""),
                    "short_desc": ext.get("shortDescription", ""),
                    "publisher_id": publisher_id,
                    "publisher_name": publisher_name,
                    "publisher_domain": domain,
                    "is_domain_verified": is_verified,
                    "install_count": install_count,
                    "average_rating": avg_rating,
                    "published_date": ext.get("publishedDate", ""),
                    "last_updated": last_updated,
                })

        return results

    def discover_and_store(
        self,
        search_text: str = "",
        max_pages: int = 5,
        page_size: int = 50,
    ) -> int:
        """
        Discover extensions from the Marketplace and store them in the DB.

        Args:
            search_text: Optional search filter
            max_pages: Maximum number of pages to walk
            page_size: Results per page

        Returns:
            Total number of extensions processed
        """
        from db.models import (
            upsert_extension,
            upsert_publisher,
            is_blocklisted,
        )

        total_processed = 0

        for page in range(1, max_pages + 1):
            logger.info(f"Querying Marketplace page {page}/{max_pages}...")

            try:
                api_resp = self.query_extensions(
                    search_text=search_text,
                    page_number=page,
                    page_size=page_size,
                )
            except RuntimeError as e:
                logger.error(f"Failed to query page {page}: {e}")
                break

            extensions = self.parse_extension_results(api_resp)

            if not extensions:
                logger.info(f"No more results at page {page}. Done.")
                break

            for ext in extensions:
                ext_id = ext["extension_id"]

                # Skip if on Microsoft's blocklist
                if is_blocklisted(self.conn, ext_id):
                    logger.info(f"⛔ Skipping blocklisted extension: {ext_id}")
                    continue

                # Upsert publisher
                pub_db_id = upsert_publisher(
                    self.conn,
                    publisher_id=ext["publisher_id"],
                    publisher_name=ext["publisher_name"],
                    domain=ext["publisher_domain"],
                    is_domain_verified=ext["is_domain_verified"],
                )

                # Upsert extension
                upsert_extension(
                    self.conn,
                    extension_id=ext_id,
                    version=ext["version"],
                    display_name=ext["display_name"],
                    short_desc=ext["short_desc"],
                    published_date=ext["published_date"],
                    last_updated=ext["last_updated"],
                    install_count=ext["install_count"],
                    average_rating=ext["average_rating"],
                    publisher_db_id=pub_db_id,
                )

                total_processed += 1

            logger.info(f"Page {page}: processed {len(extensions)} extensions.")

        logger.info(f"Discovery complete. Total processed: {total_processed}")
        return total_processed

    # ──────────────────────────────────────────
    # VSIX Download
    # ──────────────────────────────────────────

    def download_vsix(self, extension_id: str, version: str) -> Optional[str]:
        """
        Download the .vsix archive for an extension.

        Args:
            extension_id: e.g., "ms-python.python"
            version: Specific version string

        Returns:
            Path to the downloaded .vsix file, or None on failure.
        """
        from db.models import get_extension, update_scan_state, hash_file_sha256

        parts = extension_id.split(".", 1)
        if len(parts) != 2:
            logger.error(f"Invalid extension_id format: {extension_id}")
            return None

        publisher, ext_name = parts

        # Build versioned download URL
        url = (
            f"https://{publisher}.gallery.vsassets.io/_apis/public/gallery/"
            f"publisher/{publisher}/extension/{ext_name}/{version}/assetbyname/"
            f"Microsoft.VisualStudio.Services.VSIXPackage"
        )

        # Target file path
        safe_name = f"{extension_id}_{version}.vsix"
        target_path = self.vsix_dir / safe_name

        if target_path.exists():
            logger.info(f"VSIX already downloaded: {target_path}")
            return str(target_path)

        # Update state to DOWNLOADING
        ext_row = get_extension(self.conn, extension_id, version)
        if ext_row:
            update_scan_state(self.conn, ext_row["id"], "DOWNLOADING")

        logger.info(f"Downloading VSIX: {extension_id} v{version}...")

        try:
            self._rate_limit()
            resp = self._request_with_backoff("GET", url, stream=True)

            # Check Content-Length for zip-bomb protection
            content_length = int(resp.headers.get("Content-Length", 0))
            max_bytes = self.max_vsix_size_mb * 1024 * 1024
            if content_length > max_bytes:
                logger.warning(
                    f"VSIX too large ({content_length / 1024 / 1024:.1f}MB > {self.max_vsix_size_mb}MB). Skipping."
                )
                return None

            # Stream download
            downloaded = 0
            with open(target_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    downloaded += len(chunk)
                    if downloaded > max_bytes:
                        logger.warning("VSIX exceeded max size during download. Aborting.")
                        f.close()
                        target_path.unlink(missing_ok=True)
                        return None
                    f.write(chunk)

            # Hash the downloaded file
            vsix_hash = hash_file_sha256(str(target_path))
            logger.info(f"Downloaded: {safe_name} (SHA256: {vsix_hash[:16]}...)")

            # Update DB with hash
            if ext_row:
                cur = self.conn.cursor()
                cur.execute(
                    "UPDATE detox_extensions SET vsix_hash_sha256 = %s WHERE id = %s",
                    (vsix_hash, ext_row["id"]),
                )
                cur.close()

            return str(target_path)

        except Exception as e:
            logger.error(f"Failed to download {extension_id} v{version}: {e}")
            target_path.unlink(missing_ok=True)
            return None

    def download_queued(self, limit: int = 10) -> int:
        """
        Download VSIX files for extensions in QUEUED state.

        Args:
            limit: Max number of downloads per run

        Returns:
            Number of successful downloads
        """
        cur = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM detox_extensions WHERE scan_state = 'QUEUED' ORDER BY created_at LIMIT %s",
            (limit,),
        )
        rows = cur.fetchall()
        cur.close()

        downloaded = 0
        for row in rows:
            path = self.download_vsix(row["extension_id"], row["version"])
            if path:
                downloaded += 1

        logger.info(f"Downloaded {downloaded}/{len(rows)} queued extensions.")
        return downloaded


# ──────────────────────────────────────────────
# CLI Entry Point
# ──────────────────────────────────────────────

def main():
    """Main entry point for the scraper."""
    import sys
    sys.path.insert(0, str(PROJECT_ROOT))

    from db.models import init_db
    from utils.scraper.blocklist_sync import sync_blocklist

    config = load_config()

    # Initialize database
    db_path = config.get("database", {}).get("path", "./data/extensiondetox.db")
    conn = init_db(db_path)
    logger.info(f"Database initialized: {db_path}")

    # Sync blocklist first
    logger.info("Syncing Microsoft blocklist...")
    blocklist_count = sync_blocklist(conn, config)
    logger.info(f"Blocklist synced: {blocklist_count} entries")

    # Discover extensions
    scraper = MarketplaceScraper(conn, config)
    total = scraper.discover_and_store(max_pages=5, page_size=50)
    logger.info(f"Discovery complete: {total} extensions indexed")

    # Download queued
    downloaded = scraper.download_queued(limit=10)
    logger.info(f"Download complete: {downloaded} VSIX files acquired")

    conn.close()
    logger.info("Scraper run complete.")


if __name__ == "__main__":
    main()
