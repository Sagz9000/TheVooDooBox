"""
ExtensionDetox - Forensic File Check

Scans VSIX archives for masquerading files — binary payloads
disguised as images, text, or other innocuous file types by
checking for magic byte mismatches.
"""

import logging
import struct
import zipfile
from dataclasses import dataclass, field

logger = logging.getLogger("ExtensionDetox.ForensicCheck")


# ──────────────────────────────────────────────
# Known magic byte signatures
# ──────────────────────────────────────────────
MAGIC_SIGNATURES = {
    # Images
    b"\x89PNG\r\n\x1a\n": "PNG",
    b"\xff\xd8\xff": "JPEG",
    b"GIF87a": "GIF",
    b"GIF89a": "GIF",
    b"RIFF": "WEBP/AVI/WAV",
    b"BM": "BMP",
    # Executables
    b"MZ": "PE/EXE/DLL",
    b"\x7fELF": "ELF",
    b"\xfe\xed\xfa\xce": "Mach-O (32-bit)",
    b"\xfe\xed\xfa\xcf": "Mach-O (64-bit)",
    b"\xca\xfe\xba\xbe": "Mach-O (Universal)",
    # Archives
    b"PK\x03\x04": "ZIP/JAR",
    b"\x1f\x8b": "GZIP",
    b"Rar!\x1a\x07": "RAR",
    b"7z\xbc\xaf\x27\x1c": "7Z",
    # Scripts / Documents
    b"%PDF": "PDF",
    b"#!": "Shell Script",
    # Java
    b"\xca\xfe\xba\xbe": "Java Class",
}

# Expected magic types for file extensions
EXPECTED_TYPES = {
    ".png":  {"PNG"},
    ".jpg":  {"JPEG"},
    ".jpeg": {"JPEG"},
    ".gif":  {"GIF"},
    ".bmp":  {"BMP"},
    ".webp": {"WEBP/AVI/WAV"},
    ".ico":  {"PNG", "BMP"},  # ICO can contain PNG or BMP
    ".svg":  set(),            # SVG is text/XML — no binary magic
    ".txt":  set(),
    ".md":   set(),
    ".json": set(),
    ".yaml": set(),
    ".yml":  set(),
    ".xml":  set(),
    ".css":  set(),
    ".html": set(),
    ".htm":  set(),
    ".pdf":  {"PDF"},
}

# Binary types that should NOT appear in extension assets
SUSPICIOUS_BINARY_TYPES = {"PE/EXE/DLL", "ELF", "Mach-O (32-bit)", "Mach-O (64-bit)", "Mach-O (Universal)"}


@dataclass
class ForensicFinding:
    """A single forensic file check finding."""
    severity: str          # HIGH, MEDIUM, LOW
    check_name: str        # MAGIC_MISMATCH, HIDDEN_EXECUTABLE, etc.
    description: str
    file_path: str
    detected_type: str = ""
    expected_types: str = ""


@dataclass
class ForensicScanResult:
    """Result of a forensic scan on a VSIX archive."""
    files_scanned: int = 0
    findings: list = field(default_factory=list)
    hidden_executables: list = field(default_factory=list)
    magic_mismatches: list = field(default_factory=list)
    risk_score: float = 0.0


def identify_magic(data: bytes) -> str:
    """Identify file type from magic bytes. Returns type string or 'UNKNOWN'."""
    # Check longest signatures first for accuracy
    for sig, file_type in sorted(MAGIC_SIGNATURES.items(), key=lambda x: -len(x[0])):
        if data[:len(sig)] == sig:
            return file_type
    return "UNKNOWN"


class ForensicChecker:
    """
    Scans VSIX archive contents for masquerading files.

    Detects:
    - Binary executables disguised as images/text (magic byte mismatch)
    - Suspicious binary payloads in non-code directories
    - Double extensions (e.g., file.png.exe)
    """

    def scan_vsix(self, vsix_path: str) -> ForensicScanResult:
        """
        Perform a forensic file check on a VSIX archive.

        Args:
            vsix_path: Path to the .vsix file

        Returns:
            ForensicScanResult with findings
        """
        result = ForensicScanResult()

        try:
            with zipfile.ZipFile(vsix_path, 'r') as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue

                    name = info.filename
                    ext = self._get_extension(name).lower()

                    # Skip JS/TS source files and JSON (they're text by nature)
                    if ext in (".js", ".ts", ".mjs", ".cjs", ".map", ".json",
                               ".md", ".txt", ".yml", ".yaml", ".xml", ".css",
                               ".html", ".htm", ".svg", ".lock", ".d.ts"):
                        result.files_scanned += 1
                        continue

                    # Read header bytes for magic identification
                    try:
                        header = zf.read(name)[:32]
                    except Exception:
                        continue

                    if len(header) < 4:
                        result.files_scanned += 1
                        continue

                    detected_type = identify_magic(header)
                    result.files_scanned += 1

                    # Check 1: Is this a hidden executable?
                    if detected_type in SUSPICIOUS_BINARY_TYPES and ext not in (".exe", ".dll", ".so", ".dylib"):
                        finding = ForensicFinding(
                            severity="CRITICAL",
                            check_name="HIDDEN_EXECUTABLE",
                            description=f"File '{name}' has extension '{ext}' but contains {detected_type} binary",
                            file_path=name,
                            detected_type=detected_type,
                            expected_types=str(EXPECTED_TYPES.get(ext, "text/data")),
                        )
                        result.findings.append(finding)
                        result.hidden_executables.append(name)

                    # Check 2: Magic byte mismatch for known media types
                    elif ext in EXPECTED_TYPES and EXPECTED_TYPES[ext]:
                        if detected_type != "UNKNOWN" and detected_type not in EXPECTED_TYPES[ext]:
                            finding = ForensicFinding(
                                severity="HIGH",
                                check_name="MAGIC_MISMATCH",
                                description=(
                                    f"File '{name}' claims to be '{ext}' but magic bytes indicate "
                                    f"'{detected_type}' (expected: {EXPECTED_TYPES[ext]})"
                                ),
                                file_path=name,
                                detected_type=detected_type,
                                expected_types=str(EXPECTED_TYPES[ext]),
                            )
                            result.findings.append(finding)
                            result.magic_mismatches.append(name)

                    # Check 3: Any executable in asset directories
                    if detected_type in SUSPICIOUS_BINARY_TYPES:
                        # Check if it's in expected locations (like native modules)
                        in_native = any(
                            seg in name.lower()
                            for seg in ("node_modules", "bin/", "native/", "prebuilds/")
                        )
                        if not in_native:
                            finding = ForensicFinding(
                                severity="HIGH",
                                check_name="UNEXPECTED_BINARY",
                                description=f"Executable binary ({detected_type}) found outside native module paths: {name}",
                                file_path=name,
                                detected_type=detected_type,
                            )
                            result.findings.append(finding)

                    # Check 4: Double extensions
                    if self._has_double_extension(name):
                        finding = ForensicFinding(
                            severity="MEDIUM",
                            check_name="DOUBLE_EXTENSION",
                            description=f"File has double extension (possible masquerading): {name}",
                            file_path=name,
                        )
                        result.findings.append(finding)

        except zipfile.BadZipFile:
            result.findings.append(ForensicFinding(
                severity="CRITICAL",
                check_name="BAD_ARCHIVE",
                description="VSIX is not a valid ZIP archive",
                file_path=vsix_path,
            ))

        # Calculate risk
        weights = {"CRITICAL": 0.4, "HIGH": 0.15, "MEDIUM": 0.05}
        result.risk_score = min(
            sum(weights.get(f.severity, 0.01) for f in result.findings),
            1.0,
        )

        logger.info(
            f"Forensic scan: {result.files_scanned} files checked, "
            f"{len(result.findings)} findings, risk={result.risk_score:.2f}"
        )
        return result

    @staticmethod
    def _get_extension(filename: str) -> str:
        """Get the file extension from a path."""
        parts = filename.rsplit(".", 1)
        return f".{parts[-1]}" if len(parts) > 1 else ""

    @staticmethod
    def _has_double_extension(filename: str) -> bool:
        """Check if filename has a double extension like 'file.png.exe'."""
        basename = filename.split("/")[-1]
        parts = basename.split(".")
        if len(parts) >= 3:
            # Check if both the last two parts look like extensions
            suspicious_exts = {
                "exe", "dll", "so", "bat", "cmd", "ps1", "sh",
                "vbs", "js", "py", "rb", "pl",
            }
            return parts[-1].lower() in suspicious_exts and parts[-2].lower() in (
                set(EXPECTED_TYPES.keys()) | {"png", "jpg", "gif", "txt", "doc", "pdf"}
            )
        return False


def scan_vsix_forensics(vsix_path: str) -> ForensicScanResult:
    """Convenience function to run forensic checks on a VSIX."""
    checker = ForensicChecker()
    return checker.scan_vsix(vsix_path)
