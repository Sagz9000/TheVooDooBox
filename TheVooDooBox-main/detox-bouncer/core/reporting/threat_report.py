"""
ExtensionDetox - Unified Threat Report Generator

Combines results from all analysis stages into a single,
actionable threat report. Calculates composite scores,
integrates marketplace trust signals, and produces
structured output for the UI and database.
"""

import json
import logging
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("ExtensionDetox.ThreatReport")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


@dataclass
class ThreatReport:
    """Unified threat report for a single extension version."""
    # Identity
    extension_id: str = ""
    version: str = ""
    display_name: str = ""
    publisher_name: str = ""
    publisher_verified: bool = False
    vsix_hash_sha256: str = ""

    # Marketplace Trust Signals
    install_count: int = 0
    average_rating: float = 0.0
    published_date: str = ""
    is_blocklisted: bool = False
    blocklist_type: str = ""  # Malware, Impersonation, Untrustworthy

    # Scores (0.0 - 1.0)
    ai_vibe_score: float = 0.0
    static_analysis_score: float = 0.0
    behavioral_score: float = 0.0       # From Chamber (Phase 2), 0 if not detonated
    trust_signal_score: float = 0.0
    composite_score: float = 0.0

    # Verdict
    verdict: str = "UNKNOWN"  # CLEAN, SUSPICIOUS, MALICIOUS
    confidence: float = 0.0

    # Findings
    total_findings: int = 0
    critical_findings: list = field(default_factory=list)
    high_findings: list = field(default_factory=list)
    medium_findings: list = field(default_factory=list)
    info_findings: list = field(default_factory=list)

    # IOCs
    iocs: list = field(default_factory=list)
    ioc_enrichment: list = field(default_factory=list)

    # Cross-Reference
    shared_infrastructure: dict = field(default_factory=dict)
    campaign_score: float = 0.0

    # VirusTotal
    vt_detection_count: int = 0
    vt_total_engines: int = 0
    vt_known_malicious: bool = False

    # Escalation
    escalated_to_chamber: bool = False
    escalation_reasons: list = field(default_factory=list)

    # Metadata
    report_timestamp: str = ""
    analysis_duration_seconds: float = 0.0

    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        return asdict(self)

    def to_json(self, indent: int = 2) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), indent=indent, default=str)

    def severity_summary(self) -> str:
        """One-line severity summary."""
        return (
            f"{len(self.critical_findings)}C / {len(self.high_findings)}H / "
            f"{len(self.medium_findings)}M / {len(self.info_findings)}I"
        )


class ThreatReportGenerator:
    """
    Generates unified threat reports from triage pipeline results,
    marketplace data, and IOC enrichment.
    """

    def __init__(self, db_conn, config: dict = None):
        self.conn = db_conn
        self.config = config or {}

        # Scoring weights
        scoring = self.config.get("scoring", {})
        self.weights = {
            "ai_vibe": scoring.get("ai_vibe_weight", 0.35),
            "static": scoring.get("static_analysis_weight", 0.25),
            "behavioral": scoring.get("behavioral_weight", 0.25),
            "trust": scoring.get("trust_signal_weight", 0.15),
        }

    def generate(
        self,
        extension_db_id: int,
        triage_result=None,
        vt_result=None,
        crossref_result: dict = None,
    ) -> ThreatReport:
        """
        Generate a complete threat report for an extension.

        Args:
            extension_db_id: Extension's DB row ID
            triage_result: TriageResult from the pipeline (optional)
            vt_result: VirusTotal EnrichmentResult (optional)
            crossref_result: IOC cross-reference result (optional)

        Returns:
            Complete ThreatReport
        """
        report = ThreatReport()
        report.report_timestamp = datetime.now(timezone.utc).isoformat()

        # ── Load extension data from DB ────────────────
        ext = self.conn.execute(
            "SELECT * FROM extensions WHERE id = ?",
            (extension_db_id,),
        ).fetchone()

        if not ext:
            logger.error(f"Extension {extension_db_id} not found in DB")
            report.verdict = "ERROR"
            return report

        report.extension_id = ext["extension_id"]
        report.version = ext["version"]
        report.display_name = ext["display_name"] or ""
        report.vsix_hash_sha256 = ext["vsix_hash_sha256"] or ""
        report.install_count = ext["install_count"] or 0
        report.average_rating = ext["average_rating"] or 0.0
        report.published_date = ext["published_date"] or ""

        # ── Publisher info ─────────────────────────────
        if ext["publisher_id"]:
            pub = self.conn.execute(
                "SELECT * FROM publishers WHERE id = ?",
                (ext["publisher_id"],),
            ).fetchone()
            if pub:
                report.publisher_name = pub["publisher_name"]
                report.publisher_verified = bool(pub["is_domain_verified"])

        # ── Blocklist check ────────────────────────────
        from db.models import is_blocklisted
        report.is_blocklisted = is_blocklisted(self.conn, report.extension_id)
        if report.is_blocklisted:
            bl = self.conn.execute(
                "SELECT * FROM blocklist WHERE extension_id = ?",
                (report.extension_id,),
            ).fetchone()
            if bl:
                report.blocklist_type = bl["removal_type"] or ""

        # ── Trust Signal Score ─────────────────────────
        report.trust_signal_score = self._calculate_trust_score(report)

        # ── Triage Results ─────────────────────────────
        if triage_result:
            report.ai_vibe_score = triage_result.ai_risk
            report.static_analysis_score = max(
                triage_result.metadata_risk,
                triage_result.forensic_risk,
                triage_result.yara_risk,
            )
            report.escalated_to_chamber = triage_result.escalate_to_chamber
            report.escalation_reasons = triage_result.escalation_reasons

            # Categorize findings
            self._categorize_findings(report, triage_result)

        # ── VirusTotal ─────────────────────────────────
        if vt_result:
            report.vt_detection_count = vt_result.detection_count
            report.vt_total_engines = vt_result.total_engines
            report.vt_known_malicious = vt_result.malicious

        # ── IOC Cross-Reference ────────────────────────
        if crossref_result:
            report.shared_infrastructure = crossref_result
            report.campaign_score = crossref_result.get("campaign_score", 0.0)

        # ── Composite Score ────────────────────────────
        report.composite_score = self._calculate_composite(report)

        # ── Final Verdict ──────────────────────────────
        report.verdict = self._determine_verdict(report)
        report.confidence = self._determine_confidence(report)

        # ── Persist to DB ──────────────────────────────
        self._save_scan_record(extension_db_id, report)

        logger.info(
            f"Report: {report.extension_id} v{report.version} | "
            f"Verdict={report.verdict} | Composite={report.composite_score:.2f} | "
            f"Findings={report.severity_summary()}"
        )

        return report

    def _calculate_trust_score(self, report: ThreatReport) -> float:
        """
        Calculate a trust score (0.0 = very trusted, 1.0 = untrusted)
        from marketplace signals.
        """
        score = 0.5  # Neutral baseline

        # Blocklisted = instant max untrust
        if report.is_blocklisted:
            return 1.0

        # Install count (log scale)
        if report.install_count >= 1_000_000:
            score -= 0.3
        elif report.install_count >= 100_000:
            score -= 0.2
        elif report.install_count >= 10_000:
            score -= 0.1
        elif report.install_count < 100:
            score += 0.15
        elif report.install_count < 10:
            score += 0.25

        # Publisher verification
        if report.publisher_verified:
            score -= 0.15
        else:
            score += 0.1

        # Rating
        if report.average_rating >= 4.0:
            score -= 0.05
        elif report.average_rating < 2.0 and report.average_rating > 0:
            score += 0.1

        return max(0.0, min(1.0, score))

    def _categorize_findings(self, report: ThreatReport, triage_result):
        """Sort triage findings into severity buckets."""
        all_findings = []

        if triage_result.metadata_result:
            for f in triage_result.metadata_result.findings:
                all_findings.append(f)

        if triage_result.forensic_result:
            for f in triage_result.forensic_result.findings:
                all_findings.append({
                    "severity": f.severity,
                    "check_name": f.check_name,
                    "description": f.description,
                    "file_path": f.file_path,
                })

        if triage_result.yara_result:
            for f in triage_result.yara_result.findings:
                all_findings.append({
                    "severity": f.severity,
                    "check_name": f.rule_name,
                    "description": f.description,
                    "file_path": f.file_path,
                    "line_number": f.line_number,
                    "code_snippet": f.matched_text,
                })

        report.total_findings = len(all_findings)
        for f in all_findings:
            sev = f.get("severity", "INFO") if isinstance(f, dict) else getattr(f, "severity", "INFO")
            if sev == "CRITICAL":
                report.critical_findings.append(f)
            elif sev == "HIGH":
                report.high_findings.append(f)
            elif sev == "MEDIUM":
                report.medium_findings.append(f)
            else:
                report.info_findings.append(f)

    def _calculate_composite(self, report: ThreatReport) -> float:
        """Calculate weighted composite risk score."""
        # If blocklisted, instant max
        if report.is_blocklisted:
            return 1.0

        # If VT detects it, heavily weight that
        if report.vt_known_malicious:
            vt_boost = min(report.vt_detection_count / 10.0, 0.5)
        else:
            vt_boost = 0.0

        composite = (
            report.ai_vibe_score * self.weights["ai_vibe"]
            + report.static_analysis_score * self.weights["static"]
            + report.behavioral_score * self.weights["behavioral"]
            + report.trust_signal_score * self.weights["trust"]
            + vt_boost
            + report.campaign_score * 0.1
        )

        return min(composite, 1.0)

    def _determine_verdict(self, report: ThreatReport) -> str:
        """Determine the final verdict."""
        if report.is_blocklisted:
            return "MALICIOUS"
        if report.vt_known_malicious and report.vt_detection_count >= 5:
            return "MALICIOUS"
        if report.composite_score >= 0.7:
            return "MALICIOUS"
        if report.composite_score >= 0.35:
            return "SUSPICIOUS"
        if len(report.critical_findings) > 0:
            return "SUSPICIOUS"
        return "CLEAN"

    def _determine_confidence(self, report: ThreatReport) -> float:
        """Estimate confidence in the verdict."""
        confidence = 0.5  # Base

        # More signals = more confidence
        if report.vt_total_engines > 0:
            confidence += 0.15
        if report.ai_vibe_score > 0:
            confidence += 0.1
        if report.behavioral_score > 0:
            confidence += 0.15
        if report.is_blocklisted:
            confidence += 0.3  # Microsoft already confirmed

        return min(confidence, 1.0)

    def _save_scan_record(self, extension_db_id: int, report: ThreatReport):
        """Save the report as a scan_history record in the DB."""
        from db.models import insert_scan_record, complete_scan_record

        scan_id = insert_scan_record(self.conn, extension_db_id, "UNIFIED_REPORT")
        complete_scan_record(
            self.conn,
            scan_id=scan_id,
            ai_vibe_score=report.ai_vibe_score,
            static_score=report.static_analysis_score,
            behavioral_score=report.behavioral_score,
            trust_score=report.trust_signal_score,
            composite_score=report.composite_score,
            findings_json=json.dumps({
                "critical": len(report.critical_findings),
                "high": len(report.high_findings),
                "medium": len(report.medium_findings),
                "info": len(report.info_findings),
                "verdict": report.verdict,
            }),
        )


def generate_threat_report(
    db_conn,
    extension_db_id: int,
    triage_result=None,
    config: dict = None,
) -> ThreatReport:
    """Convenience function to generate a threat report."""
    generator = ThreatReportGenerator(db_conn, config)
    return generator.generate(extension_db_id, triage_result=triage_result)
