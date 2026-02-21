-- ExtensionDetox Database Schema
-- Designed for SQLite with PostgreSQL-compatible syntax for future migration.

-- ============================================================
-- Extensions: Core identity and tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS extensions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    extension_id    TEXT NOT NULL,                  -- e.g., "ms-python.python"
    version         TEXT NOT NULL,
    display_name    TEXT,
    short_desc      TEXT,
    vsix_hash_sha256 TEXT,                          -- SHA256 of the downloaded .vsix
    published_date  TEXT,                           -- ISO 8601 timestamp
    last_updated    TEXT,                           -- ISO 8601 timestamp
    install_count   INTEGER DEFAULT 0,
    average_rating  REAL DEFAULT 0.0,
    -- Scan lifecycle state machine
    scan_state      TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED|DOWNLOADING|STATIC_SCANNING|STATIC_COMPLETE|DETONATING|DETONATION_COMPLETE|REPORTED|CLEAN|FLAGGED|WHITELISTED
    task_id         TEXT,                           -- Maps to VooDooBox task_id for detonation
    publisher_id    INTEGER,                        -- FK to publishers(id)
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(extension_id, version)
);

-- ============================================================
-- Publishers: Identity and verification status
-- ============================================================
CREATE TABLE IF NOT EXISTS publishers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_id      TEXT NOT NULL UNIQUE,          -- Marketplace publisher ID
    publisher_name    TEXT NOT NULL,
    display_name      TEXT,
    domain            TEXT,
    is_domain_verified INTEGER DEFAULT 0,            -- Boolean: 0=false, 1=true
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Blocklist: Synced from Microsoft RemovedPackages.md
-- ============================================================
CREATE TABLE IF NOT EXISTS blocklist (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    extension_id    TEXT NOT NULL UNIQUE,
    removal_date    TEXT,
    removal_type    TEXT,                           -- Malware|Impersonation|Untrustworthy
    synced_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Scan History: Full audit trail per extension version
-- ============================================================
CREATE TABLE IF NOT EXISTS scan_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    extension_db_id INTEGER NOT NULL REFERENCES extensions(id),
    scan_type       TEXT NOT NULL,                  -- STATIC|DYNAMIC|VIRUSTOTAL|BLOCKLIST
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT,
    -- Scores (0.0 to 1.0, higher = more suspicious)
    ai_vibe_score   REAL,
    static_score    REAL,
    behavioral_score REAL,
    trust_score     REAL,
    composite_score REAL,
    -- Findings
    findings_json   TEXT,                           -- JSON blob of specific findings
    raw_ai_response TEXT                            -- Full AI response for audit
);

-- ============================================================
-- IOCs: Indicators of Compromise extracted during analysis
-- ============================================================
CREATE TABLE IF NOT EXISTS iocs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_history_id INTEGER NOT NULL REFERENCES scan_history(id),
    ioc_type        TEXT NOT NULL,                  -- IP|DOMAIN|HASH|URL|FILE_PATH
    ioc_value       TEXT NOT NULL,
    context         TEXT,                           -- Where/how it was found
    vt_detection    INTEGER,                        -- VirusTotal detection count (null = not checked)
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for cross-referencing IOCs across extensions
CREATE INDEX IF NOT EXISTS idx_iocs_value ON iocs(ioc_value);
CREATE INDEX IF NOT EXISTS idx_iocs_type_value ON iocs(ioc_type, ioc_value);

-- ============================================================
-- Extension Dependencies: Resolved dependency trees
-- ============================================================
CREATE TABLE IF NOT EXISTS extension_dependencies (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_extension_id INTEGER NOT NULL REFERENCES extensions(id),
    dependency_ext_id   TEXT NOT NULL,               -- The extensionId of the dependency
    dependency_version  TEXT
);

-- ============================================================
-- Static Analysis Findings: Detailed per-check results
-- ============================================================
CREATE TABLE IF NOT EXISTS static_findings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    extension_db_id INTEGER NOT NULL REFERENCES extensions(id),
    check_name      TEXT NOT NULL,                  -- ACTIVATION_WILDCARD|POSTINSTALL_SCRIPT|WEBVIEW|TYPOSQUAT|MAGIC_MISMATCH|...
    severity        TEXT NOT NULL DEFAULT 'INFO',   -- INFO|LOW|MEDIUM|HIGH|CRITICAL
    description     TEXT,
    file_path       TEXT,                           -- File within the VSIX where the finding was located
    line_number     INTEGER,
    code_snippet    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_static_findings_ext ON static_findings(extension_db_id);
CREATE INDEX IF NOT EXISTS idx_extensions_state ON extensions(scan_state);
CREATE INDEX IF NOT EXISTS idx_extensions_id_version ON extensions(extension_id, version);
