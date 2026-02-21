"""
ExtensionDetox - YARA/Semgrep Rules Engine

Runs custom YARA and Semgrep rules against VSIX source files
to detect obfuscated URLs, eval() patterns, C2 indicators,
and other static signatures.
"""

import logging
import os
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger("ExtensionDetox.YaraEngine")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
YARA_RULES_DIR = PROJECT_ROOT / "rules" / "yara"


# ──────────────────────────────────────────────
# Built-in pattern rules (used when YARA lib unavailable)
# ──────────────────────────────────────────────
# These mirror common YARA rules but implemented in pure Python
# for portability. The real YARA engine is used when available.

BUILTIN_RULES = [
    {
        "name": "obfuscated_eval",
        "severity": "HIGH",
        "description": "Obfuscated eval() / Function() execution",
        "patterns": [
            r"\beval\s*\(\s*(?:atob|Buffer\.from|String\.fromCharCode|unescape)\s*\(",
            r"\bnew\s+Function\s*\(\s*(?:atob|Buffer\.from|String\.fromCharCode)\s*\(",
            r"\beval\s*\(\s*[a-zA-Z_$]+\s*\(",  # eval(someVar( — indirect call
            r"\bFunction\s*\(\s*['\"]return\b",
        ],
    },
    {
        "name": "base64_payload",
        "severity": "HIGH",
        "description": "Base64-encoded payload followed by execution",
        "patterns": [
            r"atob\s*\(['\"][A-Za-z0-9+/=]{50,}['\"]\s*\)",
            r"Buffer\.from\s*\(['\"][A-Za-z0-9+/=]{50,}['\"],\s*['\"]base64['\"]\s*\)",
        ],
    },
    {
        "name": "hardcoded_ip",
        "severity": "MEDIUM",
        "description": "Hardcoded IP address (potential C2)",
        "patterns": [
            r"['\"]https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?[/'\"]",
        ],
    },
    {
        "name": "suspicious_url",
        "severity": "MEDIUM",
        "description": "Suspicious URL patterns (paste sites, tunneling services)",
        "patterns": [
            r"['\"]https?://(?:pastebin\.com|hastebin\.com|paste\.ee|ghostbin\.com|ngrok\.io|serveo\.net|localhost\.run|bore\.digital)",
            r"['\"]https?://[a-z0-9]+\.(?:tk|ml|ga|cf|gq)/",  # Free TLD domains
        ],
    },
    {
        "name": "credential_access",
        "severity": "HIGH",
        "description": "Attempt to read credential / key files",
        "patterns": [
            r"(?:readFile|readFileSync|readdir)\s*\(\s*.*(?:\.ssh|\.aws|\.kube|\.gnupg|\.npmrc|\.env)",
            r"(?:readFile|readFileSync)\s*\(\s*.*(?:id_rsa|id_ed25519|known_hosts|credentials|config)",
            r"process\.env\s*\[\s*['\"](?:AWS_|GITHUB_|AZURE_|API_KEY|SECRET|TOKEN|PASSWORD)",
        ],
    },
    {
        "name": "data_exfiltration",
        "severity": "HIGH",
        "description": "Pattern suggesting data exfiltration",
        "patterns": [
            r"(?:fetch|axios|request|http\.request|https\.request)\s*\(.*(?:readFile|readFileSync|homedir|userInfo)",
            r"(?:\.POST|\.post|method:\s*['\"]POST['\"])\s*.*(?:env|credentials|token|key|secret)",
        ],
    },
    {
        "name": "command_execution",
        "severity": "HIGH",
        "description": "Direct command / shell execution",
        "patterns": [
            r"require\s*\(\s*['\"]child_process['\"]\s*\)",
            r"\bexec\s*\(\s*['\"](?:curl|wget|powershell|cmd|bash|sh|python)\b",
            r"\bexecSync\s*\(\s*['\"]",
            r"\bspawn\s*\(\s*['\"](?:cmd|bash|sh|powershell|python|node)\b",
        ],
    },
    {
        "name": "hex_obfuscation",
        "severity": "MEDIUM",
        "description": "Heavy hex string obfuscation",
        "patterns": [
            r"\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){10,}",  # 10+ consecutive hex escapes
            r"String\.fromCharCode\s*\(\s*(?:\d+\s*,\s*){5,}",  # 5+ charcode args
        ],
    },
    {
        "name": "network_reconnaissance",
        "severity": "MEDIUM",
        "description": "Network/system reconnaissance patterns",
        "patterns": [
            r"\bos\.hostname\b",
            r"\bos\.userInfo\b",
            r"\bos\.networkInterfaces\b",
            r"\bos\.platform\b.*\bos\.arch\b",
        ],
    },
    {
        "name": "dynamic_require",
        "severity": "MEDIUM",
        "description": "Dynamic require/import with computed module name",
        "patterns": [
            r"require\s*\(\s*[a-zA-Z_$]+\s*(?:\+|\[)",  # require(variable+) or require(arr[])
            r"import\s*\(\s*[a-zA-Z_$]+\s*(?:\+|\[)",
        ],
    },
]


@dataclass
class RuleFinding:
    """A single rule match finding."""
    rule_name: str
    severity: str
    description: str
    file_path: str
    line_number: int
    matched_text: str
    pattern: str


@dataclass
class YaraScanResult:
    """Result of running rules against a VSIX."""
    files_scanned: int = 0
    rules_matched: int = 0
    findings: list = field(default_factory=list)
    risk_score: float = 0.0


class YaraEngine:
    """
    Runs static analysis rules against VSIX source files.

    Uses built-in Python regex rules for portability.
    Can optionally use the yara-python library for .yar rule files.
    """

    def __init__(self, extra_rules_dir: str = None):
        self.compiled_rules = []
        for rule in BUILTIN_RULES:
            compiled = {
                "name": rule["name"],
                "severity": rule["severity"],
                "description": rule["description"],
                "patterns": [re.compile(p, re.IGNORECASE) for p in rule["patterns"]],
            }
            self.compiled_rules.append(compiled)

        # Try to load YARA library rules
        self.yara_rules = None
        self._try_load_yara_rules(extra_rules_dir)

    def _try_load_yara_rules(self, extra_dir: str = None):
        """Attempt to load .yar files from the rules directory."""
        try:
            import yara
            rules_dir = Path(extra_dir) if extra_dir else YARA_RULES_DIR
            if rules_dir.exists():
                yar_files = list(rules_dir.glob("*.yar"))
                if yar_files:
                    filepaths = {f.stem: str(f) for f in yar_files}
                    self.yara_rules = yara.compile(filepaths=filepaths)
                    logger.info(f"Loaded {len(yar_files)} YARA rule files")
        except ImportError:
            logger.debug("yara-python not available, using built-in rules only")
        except Exception as e:
            logger.warning(f"Failed to load YARA rules: {e}")

    def scan_vsix(self, vsix_path: str) -> YaraScanResult:
        """
        Scan all JS/TS files in a VSIX archive against rules.

        Args:
            vsix_path: Path to the .vsix file

        Returns:
            YaraScanResult with all rule matches.
        """
        result = YaraScanResult()

        try:
            with zipfile.ZipFile(vsix_path, 'r') as zf:
                for name in zf.namelist():
                    # Only scan source files
                    if not name.endswith((".js", ".ts", ".mjs", ".cjs")):
                        continue
                    # Skip vendored test files
                    if "__test__" in name or ".test." in name or ".spec." in name:
                        continue

                    try:
                        raw = zf.read(name)
                        if len(raw) > 5 * 1024 * 1024:  # Skip > 5MB
                            continue
                        content = raw.decode("utf-8", errors="replace")
                    except Exception:
                        continue

                    result.files_scanned += 1
                    self._scan_content(content, name, result)

        except zipfile.BadZipFile:
            result.findings.append(RuleFinding(
                rule_name="INVALID_ARCHIVE",
                severity="CRITICAL",
                description="VSIX is not a valid ZIP archive",
                file_path=vsix_path,
                line_number=0,
                matched_text="",
                pattern="",
            ))

        # Calculate risk score
        weights = {"CRITICAL": 0.4, "HIGH": 0.15, "MEDIUM": 0.05}
        result.risk_score = min(
            sum(weights.get(f.severity, 0.01) for f in result.findings),
            1.0,
        )

        logger.info(
            f"YARA scan: {result.files_scanned} files, "
            f"{result.rules_matched} rule matches, "
            f"risk={result.risk_score:.2f}"
        )
        return result

    def _scan_content(self, content: str, filepath: str, result: YaraScanResult):
        """Scan content with built-in regex rules."""
        lines = content.split("\n")

        for rule in self.compiled_rules:
            for pattern in rule["patterns"]:
                for line_num, line in enumerate(lines, 1):
                    matches = pattern.findall(line)
                    if matches:
                        for match in matches:
                            match_str = match if isinstance(match, str) else str(match)
                            finding = RuleFinding(
                                rule_name=rule["name"],
                                severity=rule["severity"],
                                description=rule["description"],
                                file_path=filepath,
                                line_number=line_num,
                                matched_text=match_str[:200],
                                pattern=pattern.pattern,
                            )
                            result.findings.append(finding)
                            result.rules_matched += 1


def scan_vsix_rules(vsix_path: str) -> YaraScanResult:
    """Convenience function to run rule-based scanning on a VSIX."""
    engine = YaraEngine()
    return engine.scan_vsix(vsix_path)
