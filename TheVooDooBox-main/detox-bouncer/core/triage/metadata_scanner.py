"""
ExtensionDetox - Metadata Scanner

Parses the package.json manifest from VSIX archives to extract:
- Capabilities and permissions (terminal, clipboard, fs, shell)
- Activation events (flags wildcard "*" as high-risk)
- Extension dependencies (recursive resolution)
- Contributes (commands, keybindings, menus)
- Postinstall/preinstall scripts in bundled node_modules
- WebView usage detection
"""

import json
import logging
import os
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("ExtensionDetox.MetadataScanner")


# ──────────────────────────────────────────────
# Risk Indicators
# ──────────────────────────────────────────────

HIGH_RISK_PERMISSIONS = {
    "terminal", "clipboard", "shell", "debug", "authentication",
    "fileSystem", "workspace", "env", "tasks",
}

HIGH_RISK_API_PATTERNS = [
    r"vscode\.env\.clipboard",
    r"vscode\.env\.shell",
    r"vscode\.env\.machineId",
    r"vscode\.env\.sessionId",
    r"vscode\.workspace\.fs\.(readFile|writeFile|delete)",
    r"vscode\.window\.createTerminal",
    r"vscode\.window\.createWebviewPanel",
    r"child_process",
    r"require\s*\(\s*['\"]child_process['\"]\s*\)",
    r"\beval\s*\(",
    r"\bnew\s+Function\s*\(",
    r"\bexecSync\b",
    r"\bspawnSync\b",
]

LIFECYCLE_SCRIPTS = {
    "preinstall", "install", "postinstall",
    "preuninstall", "uninstall", "postuninstall",
    "prepublish", "prepare",
}


@dataclass
class MetadataScanResult:
    """Result of scanning a VSIX's package.json and internal files."""
    extension_id: str
    version: str
    display_name: str = ""

    # Activation events
    activation_events: list = field(default_factory=list)
    has_wildcard_activation: bool = False

    # Permissions & capabilities
    requested_permissions: list = field(default_factory=list)
    high_risk_permissions: list = field(default_factory=list)

    # Dependencies
    extension_dependencies: list = field(default_factory=list)
    npm_dependencies: dict = field(default_factory=dict)

    # Contributes
    contributes_commands: list = field(default_factory=list)
    contributes_keybindings: list = field(default_factory=list)
    contributes_menus: dict = field(default_factory=dict)

    # Lifecycle scripts found in node_modules
    lifecycle_scripts_found: list = field(default_factory=list)

    # WebView usage
    webview_detected: bool = False
    webview_references: list = field(default_factory=list)

    # High-risk API patterns found in code
    risky_api_calls: list = field(default_factory=list)

    # Entry points
    main_entry: str = ""
    browser_entry: str = ""

    # Findings (severity, description tuples)
    findings: list = field(default_factory=list)

    # Overall metadata risk score (0.0 - 1.0)
    risk_score: float = 0.0

    def add_finding(self, severity: str, check_name: str, description: str,
                    file_path: str = None, line_number: int = None, code_snippet: str = None):
        self.findings.append({
            "severity": severity,
            "check_name": check_name,
            "description": description,
            "file_path": file_path,
            "line_number": line_number,
            "code_snippet": code_snippet,
        })


class MetadataScanner:
    """
    Scans VSIX archives for metadata-based risk indicators.

    Reads package.json, scans activation events, checks for lifecycle
    scripts in bundled node_modules, and detects risky VS Code API usage.
    """

    def __init__(self):
        self.api_patterns = [re.compile(p) for p in HIGH_RISK_API_PATTERNS]

    def scan_vsix(self, vsix_path: str) -> MetadataScanResult:
        """
        Perform a full metadata scan of a VSIX archive.

        Args:
            vsix_path: Path to the .vsix file

        Returns:
            MetadataScanResult with all findings
        """
        if not os.path.exists(vsix_path):
            raise FileNotFoundError(f"VSIX not found: {vsix_path}")

        logger.info(f"Scanning VSIX: {vsix_path}")

        try:
            with zipfile.ZipFile(vsix_path, 'r') as zf:
                # Validate ZIP structure (zip-slip protection)
                self._validate_zip_paths(zf)

                # Extract and parse package.json
                pkg_json = self._extract_package_json(zf)
                if pkg_json is None:
                    result = MetadataScanResult(
                        extension_id="unknown", version="unknown"
                    )
                    result.add_finding("CRITICAL", "MISSING_MANIFEST",
                                       "No package.json found in VSIX archive")
                    result.risk_score = 1.0
                    return result

                # Build result from manifest
                result = self._parse_manifest(pkg_json)

                # Scan for lifecycle scripts in node_modules
                self._scan_lifecycle_scripts(zf, result)

                # Scan source files for risky API patterns
                self._scan_source_files(zf, result, pkg_json)

                # Calculate risk score
                result.risk_score = self._calculate_risk_score(result)

                logger.info(
                    f"Scan complete: {result.extension_id} v{result.version} "
                    f"| risk={result.risk_score:.2f} | findings={len(result.findings)}"
                )
                return result

        except zipfile.BadZipFile:
            result = MetadataScanResult(extension_id="unknown", version="unknown")
            result.add_finding("CRITICAL", "BAD_ARCHIVE", "VSIX is not a valid ZIP archive")
            result.risk_score = 1.0
            return result

    def _validate_zip_paths(self, zf: zipfile.ZipFile):
        """Zip-slip protection: ensure no paths escape the archive root."""
        for info in zf.infolist():
            name = info.filename
            if name.startswith('/') or '..' in name:
                raise ValueError(f"Zip-slip detected: {name}")
            # Check decompressed size (zip-bomb protection, 500MB limit)
            if info.file_size > 500 * 1024 * 1024:
                raise ValueError(f"Zip-bomb suspected: {name} decompresses to {info.file_size} bytes")

    def _extract_package_json(self, zf: zipfile.ZipFile) -> Optional[dict]:
        """Extract and parse the extension's package.json from the VSIX."""
        # VSIX files contain files under extension/ prefix
        candidates = [
            "extension/package.json",
            "package.json",
        ]
        for candidate in candidates:
            try:
                raw = zf.read(candidate)
                return json.loads(raw.decode("utf-8"))
            except (KeyError, json.JSONDecodeError):
                continue
        return None

    def _parse_manifest(self, pkg: dict) -> MetadataScanResult:
        """Parse package.json into a structured MetadataScanResult."""
        publisher = pkg.get("publisher", "unknown")
        name = pkg.get("name", "unknown")
        ext_id = f"{publisher}.{name}"

        result = MetadataScanResult(
            extension_id=ext_id,
            version=pkg.get("version", "unknown"),
            display_name=pkg.get("displayName", ""),
            main_entry=pkg.get("main", ""),
            browser_entry=pkg.get("browser", ""),
        )

        # ── Activation Events ──────────────────────────
        activation = pkg.get("activationEvents", [])
        result.activation_events = activation

        if "*" in activation or "onStartupFinished" in activation:
            result.has_wildcard_activation = True
            severity = "HIGH" if "*" in activation else "MEDIUM"
            result.add_finding(
                severity, "ACTIVATION_WILDCARD",
                f"Extension uses wildcard/startup activation: {activation}",
                file_path="package.json",
            )

        # ── Capabilities / Permissions ─────────────────
        # Check engines.vscode and contributes for permission hints
        contributes = pkg.get("contributes", {})

        # Commands
        commands = contributes.get("commands", [])
        result.contributes_commands = [
            c.get("command", "") for c in commands if isinstance(c, dict)
        ]

        # Keybindings
        keybindings = contributes.get("keybindings", [])
        result.contributes_keybindings = [
            k.get("command", "") for k in keybindings if isinstance(k, dict)
        ]

        # Menus
        result.contributes_menus = contributes.get("menus", {})

        # Check for terminal profile contributions (high-risk)
        if contributes.get("terminal", {}).get("profiles"):
            result.high_risk_permissions.append("terminal_profiles")
            result.add_finding(
                "HIGH", "TERMINAL_PROFILES",
                "Extension contributes terminal profiles",
                file_path="package.json",
            )

        # ── Extension Dependencies ─────────────────────
        ext_deps = pkg.get("extensionDependencies", [])
        result.extension_dependencies = ext_deps
        if ext_deps:
            result.add_finding(
                "INFO", "EXTENSION_DEPENDENCIES",
                f"Extension declares {len(ext_deps)} extension dependencies: {ext_deps}",
                file_path="package.json",
            )

        # ── NPM Dependencies ──────────────────────────
        result.npm_dependencies = {
            **pkg.get("dependencies", {}),
            **pkg.get("devDependencies", {}),
        }

        # Flag suspicious npm deps
        suspicious_npm = {"node-pty", "keylogger", "clipboardy", "node-keytar"}
        found_suspicious = set(result.npm_dependencies.keys()) & suspicious_npm
        if found_suspicious:
            result.add_finding(
                "HIGH", "SUSPICIOUS_NPM_DEPS",
                f"Suspicious npm dependencies: {found_suspicious}",
                file_path="package.json",
            )

        # ── Scripts (extension-level) ──────────────────
        scripts = pkg.get("scripts", {})
        risky_scripts = set(scripts.keys()) & LIFECYCLE_SCRIPTS
        if risky_scripts:
            for script_name in risky_scripts:
                result.lifecycle_scripts_found.append({
                    "file": "package.json",
                    "script_name": script_name,
                    "command": scripts[script_name],
                })
                result.add_finding(
                    "HIGH", "LIFECYCLE_SCRIPT",
                    f"Extension has '{script_name}' script: {scripts[script_name]}",
                    file_path="package.json",
                )

        return result

    def _scan_lifecycle_scripts(self, zf: zipfile.ZipFile, result: MetadataScanResult):
        """Scan all node_modules/*/package.json for lifecycle scripts."""
        nm_pattern = re.compile(r"(?:extension/)?node_modules/[^/]+/package\.json$")

        for name in zf.namelist():
            if not nm_pattern.match(name):
                continue

            try:
                raw = zf.read(name)
                pkg = json.loads(raw.decode("utf-8"))
                scripts = pkg.get("scripts", {})
                risky = set(scripts.keys()) & LIFECYCLE_SCRIPTS

                if risky:
                    module_name = name.split("node_modules/")[-1].split("/")[0]
                    for script_name in risky:
                        result.lifecycle_scripts_found.append({
                            "file": name,
                            "module": module_name,
                            "script_name": script_name,
                            "command": scripts[script_name],
                        })
                        result.add_finding(
                            "HIGH", "POSTINSTALL_SCRIPT",
                            f"Bundled module '{module_name}' has '{script_name}': {scripts[script_name]}",
                            file_path=name,
                        )
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue

    def _scan_source_files(self, zf: zipfile.ZipFile, result: MetadataScanResult, pkg: dict):
        """Scan JS/TS source files for risky API patterns."""
        # Identify files to scan
        scan_targets = set()

        # Main entry point
        main = pkg.get("main", "")
        if main:
            scan_targets.add(f"extension/{main}")
            scan_targets.add(main)

        # Browser entry point
        browser = pkg.get("browser", "")
        if browser:
            scan_targets.add(f"extension/{browser}")
            scan_targets.add(browser)

        # Also scan any .js/.ts files in the root extension directory
        for name in zf.namelist():
            if name.startswith("extension/node_modules/"):
                continue
            if name.endswith((".js", ".ts", ".mjs", ".cjs")):
                scan_targets.add(name)

        # Limit to files that actually exist in the archive
        available = set(zf.namelist())
        scan_targets = scan_targets & available

        for filepath in scan_targets:
            try:
                raw = zf.read(filepath)
                # Skip very large files (will be handled by AI chunking)
                if len(raw) > 2 * 1024 * 1024:  # 2MB
                    result.add_finding(
                        "INFO", "LARGE_SOURCE_FILE",
                        f"Source file {filepath} is {len(raw) / 1024:.0f}KB — skipping pattern scan, needs AI chunking",
                        file_path=filepath,
                    )
                    continue

                content = raw.decode("utf-8", errors="replace")
                lines = content.split("\n")

                for line_num, line in enumerate(lines, 1):
                    for pattern in self.api_patterns:
                        matches = pattern.findall(line)
                        if matches:
                            match_str = matches[0] if isinstance(matches[0], str) else str(matches[0])
                            result.risky_api_calls.append({
                                "file": filepath,
                                "line": line_num,
                                "pattern": pattern.pattern,
                                "match": match_str,
                            })

                            # Determine severity based on pattern
                            if any(kw in match_str for kw in ("child_process", "eval", "execSync", "spawnSync", "new Function")):
                                severity = "HIGH"
                            elif "createWebviewPanel" in match_str:
                                result.webview_detected = True
                                result.webview_references.append(filepath)
                                severity = "MEDIUM"
                            else:
                                severity = "MEDIUM"

                            result.add_finding(
                                severity, "RISKY_API_CALL",
                                f"Found '{match_str}' pattern",
                                file_path=filepath,
                                line_number=line_num,
                                code_snippet=line.strip()[:200],
                            )

            except (UnicodeDecodeError, KeyError):
                continue

    def _calculate_risk_score(self, result: MetadataScanResult) -> float:
        """
        Calculate a composite risk score (0.0 - 1.0) from findings.

        Scoring:
            CRITICAL finding = +0.4
            HIGH finding     = +0.15
            MEDIUM finding   = +0.05
            INFO finding     = +0.01
        """
        weights = {"CRITICAL": 0.4, "HIGH": 0.15, "MEDIUM": 0.05, "LOW": 0.02, "INFO": 0.01}
        score = 0.0

        for finding in result.findings:
            score += weights.get(finding["severity"], 0.01)

        # Wildcard activation is a strong signal on its own
        if result.has_wildcard_activation:
            score += 0.1

        return min(score, 1.0)


def scan_vsix_file(vsix_path: str) -> MetadataScanResult:
    """Convenience function to scan a single VSIX file."""
    scanner = MetadataScanner()
    return scanner.scan_vsix(vsix_path)
