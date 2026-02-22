"""
ExtensionDetox - Database Models & Access Layer (PostgreSQL)

Provides database initialization, connection management,
and data access functions for the ExtensionDetox pipeline.
Uses psycopg2 to connect to TheVooDooBox's shared PostgreSQL instance.
"""

import os
import hashlib
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone
from typing import Optional

# ── Connection ────────────────────────────────────────────────────────────────

_connection = None


def get_connection():
    """Get or create a PostgreSQL connection using DATABASE_URL."""
    global _connection
    if _connection is None or _connection.closed:
        database_url = os.environ.get(
            "DATABASE_URL",
            "postgres://voodoobox:voodoobox_secure@db:5432/voodoobox_telemetry",
        )
        _connection = psycopg2.connect(database_url)
        _connection.autocommit = True
    return _connection


def init_db():
    """
    Initialize the detox tables in the shared PostgreSQL database.
    Uses CREATE TABLE IF NOT EXISTS (safe for repeated calls).
    """
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS detox_publishers (
            id SERIAL PRIMARY KEY,
            publisher_id TEXT UNIQUE NOT NULL,
            publisher_name TEXT NOT NULL,
            display_name TEXT,
            domain TEXT,
            is_domain_verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS detox_extensions (
            id SERIAL PRIMARY KEY,
            extension_id TEXT NOT NULL,
            version TEXT NOT NULL,
            display_name TEXT,
            short_desc TEXT,
            vsix_hash_sha256 TEXT,
            published_date TEXT,
            last_updated TEXT,
            install_count INTEGER DEFAULT 0,
            average_rating REAL DEFAULT 0.0,
            publisher_id INTEGER REFERENCES detox_publishers(id),
            scan_state TEXT DEFAULT 'QUEUED',
            latest_state TEXT DEFAULT 'pending',
            risk_score REAL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(extension_id, version)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS detox_scan_history (
            id SERIAL PRIMARY KEY,
            extension_db_id INTEGER NOT NULL REFERENCES detox_extensions(id),
            scan_type TEXT NOT NULL DEFAULT 'static',
            started_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            ai_vibe_score REAL,
            static_score REAL,
            behavioral_score REAL,
            trust_score REAL,
            composite_score REAL,
            risk_score REAL,
            findings_json JSONB,
            raw_ai_response TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS detox_blocklist (
            id SERIAL PRIMARY KEY,
            extension_id TEXT UNIQUE NOT NULL,
            removal_date TEXT,
            removal_type TEXT,
            synced_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS detox_iocs (
            id SERIAL PRIMARY KEY,
            scan_history_id INTEGER NOT NULL REFERENCES detox_scan_history(id),
            ioc_type TEXT NOT NULL,
            ioc_value TEXT NOT NULL,
            context TEXT,
            vt_detection INTEGER,
            discovered_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS detox_static_findings (
            id SERIAL PRIMARY KEY,
            scan_history_id INTEGER NOT NULL REFERENCES detox_scan_history(id),
            finding_type TEXT NOT NULL,
            severity TEXT DEFAULT 'info',
            file_path TEXT,
            line_number INTEGER,
            description TEXT NOT NULL,
            raw_match TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    print("[BOUNCER-DB] All detox tables initialized.")
    cur.close()


# ── Utilities ─────────────────────────────────────────────────────────────────

def hash_file_sha256(filepath: str) -> str:
    """Generate SHA256 hash of a file."""
    sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


# ──────────────────────────────────────────────
# Extension CRUD
# ──────────────────────────────────────────────

def upsert_extension(
    conn,
    extension_id: str,
    version: str,
    display_name: str = None,
    short_desc: str = None,
    vsix_hash: str = None,
    published_date: str = None,
    last_updated: str = None,
    install_count: int = 0,
    average_rating: float = 0.0,
    publisher_db_id: int = None,
) -> int:
    """Insert or update an extension record. Returns the row ID."""
    now = datetime.now(timezone.utc).isoformat()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO detox_extensions
            (extension_id, version, display_name, short_desc,
             vsix_hash_sha256, published_date, last_updated,
             install_count, average_rating, publisher_id,
             scan_state, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'QUEUED', %s, %s)
        ON CONFLICT(extension_id, version) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            short_desc = EXCLUDED.short_desc,
            vsix_hash_sha256 = COALESCE(EXCLUDED.vsix_hash_sha256, detox_extensions.vsix_hash_sha256),
            install_count = EXCLUDED.install_count,
            average_rating = EXCLUDED.average_rating,
            publisher_id = COALESCE(EXCLUDED.publisher_id, detox_extensions.publisher_id),
            updated_at = EXCLUDED.updated_at
        RETURNING id
        """,
        (
            extension_id, version, display_name, short_desc,
            vsix_hash, published_date, last_updated,
            install_count, average_rating, publisher_db_id,
            now, now,
        ),
    )
    row = cur.fetchone()
    cur.close()
    return row[0] if row else 0


def update_scan_state(conn, extension_db_id: int, new_state: str):
    """Transition an extension's scan state."""
    valid_states = {
        "QUEUED", "DOWNLOADING", "STATIC_SCANNING", "STATIC_COMPLETE",
        "DETONATING", "DETONATION_COMPLETE", "REPORTED",
        "CLEAN", "FLAGGED", "WHITELISTED",
    }
    if new_state not in valid_states:
        raise ValueError(f"Invalid scan state: {new_state}")

    now = datetime.now(timezone.utc).isoformat()
    # Map scan_state to latest_state for dashboard queries
    latest_map = {
        "CLEAN": "clean", "WHITELISTED": "clean",
        "FLAGGED": "flagged",
        "STATIC_SCANNING": "scanning", "DOWNLOADING": "scanning",
        "DETONATING": "detonating",
    }
    latest = latest_map.get(new_state, "pending")

    cur = conn.cursor()
    cur.execute(
        "UPDATE detox_extensions SET scan_state = %s, latest_state = %s, updated_at = %s WHERE id = %s",
        (new_state, latest, now, extension_db_id),
    )
    cur.close()


def get_extension(conn, extension_id: str, version: str):
    """Fetch an extension by its composite key."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT * FROM detox_extensions WHERE extension_id = %s AND version = %s",
        (extension_id, version),
    )
    row = cur.fetchone()
    cur.close()
    return row


def is_blocklisted(conn, extension_id: str) -> bool:
    """Check if an extension ID is on the Microsoft blocklist."""
    cur = conn.cursor()
    cur.execute(
        "SELECT 1 FROM detox_blocklist WHERE extension_id = %s",
        (extension_id,),
    )
    row = cur.fetchone()
    cur.close()
    return row is not None


# ──────────────────────────────────────────────
# Publisher CRUD
# ──────────────────────────────────────────────

def upsert_publisher(
    conn,
    publisher_id: str,
    publisher_name: str,
    display_name: str = None,
    domain: str = None,
    is_domain_verified: bool = False,
) -> int:
    """Insert or update a publisher. Returns the row ID."""
    now = datetime.now(timezone.utc).isoformat()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO detox_publishers
            (publisher_id, publisher_name, display_name, domain,
             is_domain_verified, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(publisher_id) DO UPDATE SET
            publisher_name = EXCLUDED.publisher_name,
            display_name = EXCLUDED.display_name,
            domain = EXCLUDED.domain,
            is_domain_verified = EXCLUDED.is_domain_verified,
            updated_at = EXCLUDED.updated_at
        RETURNING id
        """,
        (
            publisher_id, publisher_name, display_name, domain,
            is_domain_verified, now, now,
        ),
    )
    row = cur.fetchone()
    cur.close()
    return row[0] if row else 0


# ──────────────────────────────────────────────
# Blocklist CRUD
# ──────────────────────────────────────────────

def upsert_blocklist_entry(
    conn,
    extension_id: str,
    removal_date: str = None,
    removal_type: str = None,
) -> int:
    """Insert or update a blocklist entry."""
    now = datetime.now(timezone.utc).isoformat()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO detox_blocklist (extension_id, removal_date, removal_type, synced_at)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT(extension_id) DO UPDATE SET
            removal_date = EXCLUDED.removal_date,
            removal_type = EXCLUDED.removal_type,
            synced_at = EXCLUDED.synced_at
        RETURNING id
        """,
        (extension_id, removal_date, removal_type, now),
    )
    row = cur.fetchone()
    cur.close()
    return row[0] if row else 0


# ──────────────────────────────────────────────
# Scan History
# ──────────────────────────────────────────────

def insert_scan_record(conn, extension_db_id: int, scan_type: str) -> int:
    """Start a new scan record. Returns the scan history ID."""
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO detox_scan_history (extension_db_id, scan_type) VALUES (%s, %s) RETURNING id",
        (extension_db_id, scan_type),
    )
    row = cur.fetchone()
    cur.close()
    return row[0] if row else 0


def complete_scan_record(
    conn,
    scan_id: int,
    ai_vibe_score: float = None,
    static_score: float = None,
    behavioral_score: float = None,
    trust_score: float = None,
    composite_score: float = None,
    findings_json: str = None,
    raw_ai_response: str = None,
):
    """Complete a scan record with scores and findings."""
    now = datetime.now(timezone.utc).isoformat()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE detox_scan_history SET
            completed_at = %s,
            ai_vibe_score = %s,
            static_score = %s,
            behavioral_score = %s,
            trust_score = %s,
            composite_score = %s,
            findings_json = %s,
            raw_ai_response = %s
        WHERE id = %s
        """,
        (
            now, ai_vibe_score, static_score, behavioral_score,
            trust_score, composite_score, findings_json,
            raw_ai_response, scan_id,
        ),
    )
    cur.close()


# ──────────────────────────────────────────────
# IOCs
# ──────────────────────────────────────────────

def insert_ioc(
    conn,
    scan_history_id: int,
    ioc_type: str,
    ioc_value: str,
    context: str = None,
    vt_detection: int = None,
) -> int:
    """Insert an IOC finding."""
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO detox_iocs (scan_history_id, ioc_type, ioc_value, context, vt_detection)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
        """,
        (scan_history_id, ioc_type, ioc_value, context, vt_detection),
    )
    row = cur.fetchone()
    cur.close()
    return row[0] if row else 0


def crossref_ioc(conn, ioc_value: str) -> list:
    """Find all extensions associated with a specific IOC value."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT DISTINCT e.extension_id, e.version, e.scan_state, i.ioc_type, i.context
        FROM detox_iocs i
        JOIN detox_scan_history sh ON i.scan_history_id = sh.id
        JOIN detox_extensions e ON sh.extension_db_id = e.id
        WHERE i.ioc_value = %s
        """,
        (ioc_value,),
    )
    rows = cur.fetchall()
    cur.close()
    return [dict(r) for r in rows]
