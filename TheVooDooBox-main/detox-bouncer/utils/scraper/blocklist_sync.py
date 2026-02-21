"""
ExtensionDetox - Microsoft Blocklist Sync

Pulls the official Microsoft RemovedPackages.md from GitHub
and populates the local blocklist table.

Source: https://github.com/microsoft/vsmarketplace/blob/main/RemovedPackages.md
"""

import logging
import re
from typing import Optional

import requests
import yaml

logger = logging.getLogger("ExtensionDetox.BlocklistSync")


def fetch_removed_packages(url: str = None) -> str:
    """
    Fetch the raw RemovedPackages.md from GitHub.

    Args:
        url: Override URL (defaults to Microsoft's repo)

    Returns:
        Raw markdown content as string
    """
    if url is None:
        url = (
            "https://raw.githubusercontent.com/microsoft/vsmarketplace/"
            "main/RemovedPackages.md"
        )

    logger.info(f"Fetching blocklist from: {url}")
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.text


def parse_removed_packages(markdown_text: str) -> list[dict]:
    """
    Parse the markdown table from RemovedPackages.md.

    Expected format:
    | Extension Identifier | Removal Date | Type |
    |----------------------|--------------|------|
    | publisher.extension  | M/D/YYYY     | Malware |

    Returns:
        List of dicts with keys: extension_id, removal_date, removal_type
    """
    entries = []

    # Match table rows: | content | content | content |
    # Skip header and separator rows
    row_pattern = re.compile(
        r"^\|?\s*([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*)\s*\|"
        r"\s*(\d{1,2}/\d{1,2}/\d{4})\s*\|"
        r"\s*([A-Za-z]+)\s*\|?\s*$",
        re.MULTILINE,
    )

    for match in row_pattern.finditer(markdown_text):
        ext_id = match.group(1).strip()
        removal_date = match.group(2).strip()
        removal_type = match.group(3).strip()

        entries.append({
            "extension_id": ext_id,
            "removal_date": removal_date,
            "removal_type": removal_type,
        })

    logger.info(f"Parsed {len(entries)} blocklist entries from markdown.")
    return entries


def sync_blocklist(db_conn, config: dict = None) -> int:
    """
    Sync the Microsoft RemovedPackages.md blocklist into the local DB.

    Args:
        db_conn: SQLite connection from db.models.init_db()
        config: Parsed config.yaml (optional)

    Returns:
        Number of blocklist entries synced
    """
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from db.models import upsert_blocklist_entry

    # Get URL from config or use default
    url = None
    if config:
        url = config.get("blocklist", {}).get("url")

    try:
        markdown = fetch_removed_packages(url)
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to fetch blocklist: {e}")
        return 0

    entries = parse_removed_packages(markdown)

    synced = 0
    for entry in entries:
        try:
            upsert_blocklist_entry(
                db_conn,
                extension_id=entry["extension_id"],
                removal_date=entry["removal_date"],
                removal_type=entry["removal_type"],
            )
            synced += 1
        except Exception as e:
            logger.warning(f"Failed to upsert blocklist entry {entry['extension_id']}: {e}")

    logger.info(f"Blocklist sync complete: {synced}/{len(entries)} entries synced.")
    return synced


# ──────────────────────────────────────────────
# Standalone CLI
# ──────────────────────────────────────────────

def main():
    """Run blocklist sync standalone."""
    import sys
    from pathlib import Path

    project_root = Path(__file__).resolve().parent.parent.parent
    sys.path.insert(0, str(project_root))

    from db.models import init_db

    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
    )

    config_path = project_root / "config.yaml"
    config = {}
    if config_path.exists():
        with open(config_path) as f:
            config = yaml.safe_load(f)

    db_path = config.get("database", {}).get("path", "./data/extensiondetox.db")
    conn = init_db(db_path)

    count = sync_blocklist(conn, config)
    print(f"Synced {count} blocklist entries.")

    conn.close()


if __name__ == "__main__":
    main()
