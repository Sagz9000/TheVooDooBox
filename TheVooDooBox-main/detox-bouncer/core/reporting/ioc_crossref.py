"""
ExtensionDetox - IOC Cross-Referencing

When an IOC (IP, domain, hash) is found in one extension,
query the database to find all other extensions that share
the same infrastructure. Catches coordinated campaigns.
"""

import logging
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger("ExtensionDetox.IOCCrossRef")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def crossref_iocs_for_extension(conn, extension_db_id: int) -> dict:
    """
    Cross-reference all IOCs from a specific extension against
    the entire IOC database to find shared infrastructure.

    Args:
        conn: SQLite connection
        extension_db_id: The extension's DB id

    Returns:
        dict with:
            - shared_iocs: list of IOCs found in multiple extensions
            - related_extensions: list of extension IDs sharing infrastructure
            - campaign_score: 0.0-1.0 likelihood of coordinated campaign
    """
    # Get all IOCs for this extension
    iocs = conn.execute(
        """
        SELECT DISTINCT i.ioc_type, i.ioc_value
        FROM iocs i
        JOIN scan_history sh ON i.scan_history_id = sh.id
        WHERE sh.extension_db_id = ?
        """,
        (extension_db_id,),
    ).fetchall()

    if not iocs:
        return {"shared_iocs": [], "related_extensions": [], "campaign_score": 0.0}

    shared_iocs = []
    related_ext_ids = set()

    for ioc in iocs:
        ioc_type = ioc["ioc_type"]
        ioc_value = ioc["ioc_value"]

        # Find other extensions with the same IOC
        others = conn.execute(
            """
            SELECT DISTINCT e.id, e.extension_id, e.version, e.scan_state,
                            i.ioc_type, i.context
            FROM iocs i
            JOIN scan_history sh ON i.scan_history_id = sh.id
            JOIN extensions e ON sh.extension_db_id = e.id
            WHERE i.ioc_value = ?
              AND e.id != ?
            """,
            (ioc_value, extension_db_id),
        ).fetchall()

        if others:
            shared_iocs.append({
                "ioc_type": ioc_type,
                "ioc_value": ioc_value,
                "shared_with": [
                    {
                        "extension_id": o["extension_id"],
                        "version": o["version"],
                        "scan_state": o["scan_state"],
                    }
                    for o in others
                ],
            })
            for o in others:
                related_ext_ids.add(o["extension_id"])

    # Campaign score: more shared IOCs = higher likelihood
    campaign_score = min(len(shared_iocs) * 0.2, 1.0)

    result = {
        "shared_iocs": shared_iocs,
        "related_extensions": list(related_ext_ids),
        "campaign_score": campaign_score,
    }

    if shared_iocs:
        logger.warning(
            f"Extension {extension_db_id} shares {len(shared_iocs)} IOCs "
            f"with {len(related_ext_ids)} other extensions (campaign_score={campaign_score:.2f})"
        )

    return result


def find_all_shared_infrastructure(conn) -> list[dict]:
    """
    Scan the entire IOC database for clusters of extensions
    sharing the same infrastructure.

    Returns:
        List of IOC clusters, each with the shared IOC value
        and the extensions involved.
    """
    clusters = conn.execute(
        """
        SELECT i.ioc_value, i.ioc_type, COUNT(DISTINCT sh.extension_db_id) as ext_count
        FROM iocs i
        JOIN scan_history sh ON i.scan_history_id = sh.id
        GROUP BY i.ioc_value, i.ioc_type
        HAVING ext_count > 1
        ORDER BY ext_count DESC
        """,
    ).fetchall()

    results = []
    for cluster in clusters:
        extensions = conn.execute(
            """
            SELECT DISTINCT e.extension_id, e.version, e.scan_state
            FROM iocs i
            JOIN scan_history sh ON i.scan_history_id = sh.id
            JOIN extensions e ON sh.extension_db_id = e.id
            WHERE i.ioc_value = ?
            """,
            (cluster["ioc_value"],),
        ).fetchall()

        results.append({
            "ioc_type": cluster["ioc_type"],
            "ioc_value": cluster["ioc_value"],
            "extension_count": cluster["ext_count"],
            "extensions": [dict(e) for e in extensions],
        })

    if results:
        logger.info(f"Found {len(results)} shared IOC clusters across the database")

    return results
