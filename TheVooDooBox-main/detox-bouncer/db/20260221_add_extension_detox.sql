-- ═══════════════════════════════════════════════
-- TheVooDooBox - ExtensionDetox Migration
-- ═══════════════════════════════════════════════
-- This script integrates the ExtensionDetox schema into the main
-- PostgreSQL database of TheVooDooBox.

-- 1. Publishers
CREATE TABLE IF NOT EXISTS detox_publishers (
    id SERIAL PRIMARY KEY,
    publisher_id VARCHAR(255) UNIQUE NOT NULL,
    publisher_name VARCHAR(255),
    is_domain_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Extensions
CREATE TABLE IF NOT EXISTS detox_extensions (
    id SERIAL PRIMARY KEY,
    publisher_id INTEGER REFERENCES detox_publishers(id),
    extension_id VARCHAR(255) NOT NULL, -- e.g., 'publisher.extension'
    extension_name VARCHAR(255),
    display_name VARCHAR(255),
    version VARCHAR(50) NOT NULL,
    install_count BIGINT DEFAULT 0,
    average_rating REAL DEFAULT 0.0,
    scan_state VARCHAR(50) DEFAULT 'QUEUED',
    vsix_path VARCHAR(1024),
    vsix_hash_sha256 VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extension_id, version)
);
CREATE INDEX IF NOT EXISTS idx_detox_extensions_state ON detox_extensions(scan_state);
CREATE INDEX IF NOT EXISTS idx_detox_extensions_hash ON detox_extensions(vsix_hash_sha256);

-- 3. Scan History
CREATE TABLE IF NOT EXISTS detox_scan_history (
    id SERIAL PRIMARY KEY,
    extension_db_id INTEGER REFERENCES detox_extensions(id) ON DELETE CASCADE,
    scan_type VARCHAR(50),      -- e.g., 'STATIC_TRIAGE', 'CHAMBER_DETONATION', 'UNIFIED_REPORT'
    voodoo_task_id VARCHAR(100), -- Maps to TheVooDooBox global task ID
    ai_vibe_score REAL DEFAULT 0.0,
    static_score REAL DEFAULT 0.0,
    behavioral_score REAL DEFAULT 0.0,
    composite_score REAL DEFAULT 0.0,
    verdict VARCHAR(50),        -- 'CLEAN', 'SUSPICIOUS', 'MALICIOUS'
    raw_ai_response JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_detox_scan_history_ext ON detox_scan_history(extension_db_id);

-- 4. Blocklist Sync
CREATE TABLE IF NOT EXISTS detox_blocklist (
    id SERIAL PRIMARY KEY,
    extension_id VARCHAR(255) UNIQUE NOT NULL,
    publisher VARCHAR(255),
    removal_type VARCHAR(100),
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Indicators of Compromise (IOCs)
CREATE TABLE IF NOT EXISTS detox_iocs (
    id SERIAL PRIMARY KEY,
    scan_history_id INTEGER REFERENCES detox_scan_history(id) ON DELETE CASCADE,
    ioc_type VARCHAR(50) NOT NULL,  -- 'DOMAIN', 'IP', 'HASH', 'URL'
    ioc_value VARCHAR(1024) NOT NULL,
    source_file VARCHAR(1024),
    vt_detections INTEGER DEFAULT 0,
    vt_total INTEGER DEFAULT 0,
    is_malicious BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_detox_iocs_value ON detox_iocs(ioc_value);

-- 6. Static Findings
CREATE TABLE IF NOT EXISTS detox_static_findings (
    id SERIAL PRIMARY KEY,
    extension_db_id INTEGER REFERENCES detox_extensions(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL, -- 'OBFUSCATION', 'PERMISSIONS', 'MALWARE_SIGNATURE'
    severity VARCHAR(50) NOT NULL,  -- 'CRITICAL', 'HIGH', 'MEDIUM', 'INFO'
    description TEXT NOT NULL,
    file_path VARCHAR(1024),
    match_snippet TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
