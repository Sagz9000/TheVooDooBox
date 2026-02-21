"""
ExtensionDetox - Triage Pipeline Orchestrator

Coordinates all static analysis checks on a VSIX archive:
1. Metadata scan (package.json, activationEvents, contributes)
2. Forensic file check (magic byte mismatches)
3. YARA/Semgrep rule matching
4. JS deobfuscation
5. AI Vibe Check (llama.cpp)

Produces a unified triage result that feeds into the
scan state machine and composite scoring.
"""

import json
import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("ExtensionDetox.TriagePipeline")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


@dataclass
class TriageResult:
    """Unified result from the full triage pipeline."""
    extension_id: str = ""
    version: str = ""
    vsix_path: str = ""

    # Individual check results
    metadata_result: object = None
    forensic_result: object = None
    yara_result: object = None
    ai_result: dict = field(default_factory=dict)
    deobfuscation_info: dict = field(default_factory=dict)

    # Aggregated scores
    metadata_risk: float = 0.0
    forensic_risk: float = 0.0
    yara_risk: float = 0.0
    ai_risk: float = 0.0
    composite_risk: float = 0.0

    # Verdict
    verdict: str = "UNKNOWN"  # CLEAN, SUSPICIOUS, MALICIOUS, ERROR
    total_findings: int = 0
    high_findings: int = 0
    critical_findings: int = 0

    # Should this be sent to the Chamber for dynamic analysis?
    escalate_to_chamber: bool = False
    escalation_reasons: list = field(default_factory=list)


class TriagePipeline:
    """
    Orchestrates the complete static analysis pipeline for a VSIX.

    Usage:
        pipeline = TriagePipeline(config=config)
        result = pipeline.run(vsix_path)
    """

    # Escalation thresholds
    ESCALATION_THRESHOLD = 0.4
    AUTO_MALICIOUS_THRESHOLD = 0.8

    def __init__(self, config: dict = None, skip_ai: bool = False):
        """
        Args:
            config: Parsed config.yaml dict
            skip_ai: If True, skip the AI Vibe Check (for offline/testing)
        """
        self.config = config or {}
        self.skip_ai = skip_ai

        # Scoring weights from config
        scoring = self.config.get("scoring", {})
        self.weights = {
            "ai_vibe": scoring.get("ai_vibe_weight", 0.35),
            "static": scoring.get("static_analysis_weight", 0.25),
            "yara": scoring.get("behavioral_weight", 0.25),  # Reusing behavioral weight for YARA in static-only mode
            "metadata": scoring.get("trust_signal_weight", 0.15),
        }

    def run(self, vsix_path: str) -> TriageResult:
        """
        Run the complete triage pipeline on a VSIX archive.

        Steps:
        1. Metadata scan
        2. Forensic file check
        3. YARA/Semgrep rules
        4. (Optional) AI Vibe Check

        Args:
            vsix_path: Path to the .vsix file

        Returns:
            TriageResult with all findings and composite score
        """
        result = TriageResult(vsix_path=vsix_path)

        logger.info(f"{'='*60}")
        logger.info(f"TRIAGE PIPELINE: {vsix_path}")
        logger.info(f"{'='*60}")

        # ── Step 1: Metadata Scan ──────────────────────
        logger.info("[1/4] Metadata scan...")
        try:
            from core.triage.metadata_scanner import MetadataScanner
            scanner = MetadataScanner()
            meta = scanner.scan_vsix(vsix_path)
            result.metadata_result = meta
            result.metadata_risk = meta.risk_score
            result.extension_id = meta.extension_id
            result.version = meta.version
            logger.info(f"  Metadata risk: {meta.risk_score:.2f} | findings: {len(meta.findings)}")
        except Exception as e:
            logger.error(f"  Metadata scan failed: {e}")
            result.metadata_risk = 0.5

        # ── Step 2: Forensic Check ─────────────────────
        logger.info("[2/4] Forensic file check...")
        try:
            from core.triage.forensic_check import ForensicChecker
            forensic = ForensicChecker()
            forensic_res = forensic.scan_vsix(vsix_path)
            result.forensic_result = forensic_res
            result.forensic_risk = forensic_res.risk_score
            logger.info(
                f"  Forensic risk: {forensic_res.risk_score:.2f} | "
                f"files: {forensic_res.files_scanned} | "
                f"findings: {len(forensic_res.findings)}"
            )
        except Exception as e:
            logger.error(f"  Forensic check failed: {e}")
            result.forensic_risk = 0.0

        # ── Step 3: YARA/Semgrep Rules ─────────────────
        logger.info("[3/4] YARA/Semgrep rule scan...")
        try:
            from core.triage.yara_engine import YaraEngine
            yara = YaraEngine()
            yara_res = yara.scan_vsix(vsix_path)
            result.yara_result = yara_res
            result.yara_risk = yara_res.risk_score
            logger.info(
                f"  YARA risk: {yara_res.risk_score:.2f} | "
                f"matches: {yara_res.rules_matched}"
            )
        except Exception as e:
            logger.error(f"  YARA scan failed: {e}")
            result.yara_risk = 0.0

        # ── Step 4: AI Vibe Check ──────────────────────
        if self.skip_ai:
            logger.info("[4/4] AI Vibe Check: SKIPPED")
            result.ai_risk = 0.0
            result.ai_result = {"verdict": "SKIPPED", "risk_score": 0.0}
        else:
            logger.info("[4/4] AI Vibe Check...")
            try:
                from core.triage.ai_vibe_check import AIVibeChecker
                ai = AIVibeChecker(self.config)
                ai_res = ai.analyze_vsix(vsix_path)
                result.ai_result = ai_res
                result.ai_risk = ai_res.get("risk_score", 0.0)
                logger.info(
                    f"  AI risk: {result.ai_risk:.2f} | "
                    f"verdict: {ai_res.get('verdict', 'N/A')}"
                )
            except Exception as e:
                logger.error(f"  AI Vibe Check failed: {e}")
                result.ai_risk = 0.0
                result.ai_result = {"verdict": "ERROR", "error": str(e)}

        # ── Composite Scoring ──────────────────────────
        result.composite_risk = (
            result.ai_risk * self.weights["ai_vibe"]
            + (result.metadata_risk + result.forensic_risk) / 2 * self.weights["static"]
            + result.yara_risk * self.weights["yara"]
            + result.metadata_risk * self.weights["metadata"]
        )
        result.composite_risk = min(result.composite_risk, 1.0)

        # ── Count Findings ─────────────────────────────
        all_findings = []
        if result.metadata_result:
            all_findings.extend(result.metadata_result.findings)
        if result.forensic_result:
            all_findings.extend([
                {"severity": f.severity} for f in result.forensic_result.findings
            ])
        if result.yara_result:
            all_findings.extend([
                {"severity": f.severity} for f in result.yara_result.findings
            ])

        result.total_findings = len(all_findings)
        result.high_findings = sum(1 for f in all_findings if f.get("severity") == "HIGH")
        result.critical_findings = sum(1 for f in all_findings if f.get("severity") == "CRITICAL")

        # ── Verdict ────────────────────────────────────
        if result.composite_risk >= self.AUTO_MALICIOUS_THRESHOLD:
            result.verdict = "MALICIOUS"
        elif result.composite_risk >= self.ESCALATION_THRESHOLD:
            result.verdict = "SUSPICIOUS"
        elif result.critical_findings > 0:
            result.verdict = "SUSPICIOUS"
        else:
            result.verdict = "CLEAN"

        # ── Escalation Decision ────────────────────────
        if result.verdict in ("MALICIOUS", "SUSPICIOUS"):
            result.escalate_to_chamber = True
            if result.critical_findings > 0:
                result.escalation_reasons.append(f"{result.critical_findings} CRITICAL findings")
            if result.high_findings >= 3:
                result.escalation_reasons.append(f"{result.high_findings} HIGH findings")
            if result.composite_risk >= self.ESCALATION_THRESHOLD:
                result.escalation_reasons.append(f"Composite risk {result.composite_risk:.2f} >= {self.ESCALATION_THRESHOLD}")
            ai_verdict = result.ai_result.get("verdict", "")
            if ai_verdict in ("MALICIOUS", "SUSPICIOUS"):
                result.escalation_reasons.append(f"AI verdict: {ai_verdict}")

        logger.info(f"{'='*60}")
        logger.info(f"VERDICT: {result.verdict} | Composite: {result.composite_risk:.2f}")
        logger.info(f"Findings: {result.total_findings} total, {result.high_findings} HIGH, {result.critical_findings} CRITICAL")
        if result.escalate_to_chamber:
            logger.info(f"ESCALATE TO CHAMBER: {', '.join(result.escalation_reasons)}")
        logger.info(f"{'='*60}")

        return result


def triage_vsix(vsix_path: str, config: dict = None, skip_ai: bool = False) -> TriageResult:
    """Convenience function to run the full triage pipeline."""
    pipeline = TriagePipeline(config=config, skip_ai=skip_ai)
    return pipeline.run(vsix_path)
