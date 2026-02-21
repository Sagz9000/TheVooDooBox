"""
ExtensionDetox - Sysmon Telemetry Parser

Parses Sysmon event logs from detonation VMs to detect
malicious behavior performed by VS Code extensions.

Monitors critical Sysmon Event IDs:
- 1:  Process Creation (new processes spawned by extensions)
- 3:  Network Connection (egress from extension processes)
- 7:  Image Loaded (DLL sideloading via extensions)
- 10: Process Access (credential harvesting, injection)
- 11: File Create (dropped files, persistence artifacts)
- 13: Registry Value Set (persistence, config modification)
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Optional
from xml.etree import ElementTree as ET

logger = logging.getLogger("ExtensionDetox.SysmonParser")


# ──────────────────────────────────────────────
# Suspicious patterns for each event type
# ──────────────────────────────────────────────

# Event 1: Process Creation - suspicious parent/child relationships
SUSPICIOUS_PROCESSES = {
    "cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "wsl.exe",
    "python.exe", "python3.exe", "node.exe", "curl.exe", "wget.exe",
    "certutil.exe", "bitsadmin.exe", "mshta.exe", "regsvr32.exe",
    "rundll32.exe", "wscript.exe", "cscript.exe", "msiexec.exe",
    "schtasks.exe", "net.exe", "net1.exe", "whoami.exe", "systeminfo.exe",
}

# Event 11: File Create - suspicious paths
SUSPICIOUS_FILE_PATHS = [
    re.compile(r"\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\", re.IGNORECASE),
    re.compile(r"\\Temp\\.*\.(exe|dll|bat|cmd|ps1|vbs|js)$", re.IGNORECASE),
    re.compile(r"\\System32\\.*\.(exe|dll)$", re.IGNORECASE),
    re.compile(r"\\ProgramData\\.*\.(exe|dll|bat)$", re.IGNORECASE),
    re.compile(r"\\.ssh\\", re.IGNORECASE),
    re.compile(r"\\.aws\\", re.IGNORECASE),
    re.compile(r"\\.kube\\", re.IGNORECASE),
]

# Event 13: Registry persistence keys
PERSISTENCE_REGISTRY_KEYS = [
    re.compile(r"\\CurrentVersion\\Run\\", re.IGNORECASE),
    re.compile(r"\\CurrentVersion\\RunOnce\\", re.IGNORECASE),
    re.compile(r"\\CurrentVersion\\Policies\\Explorer\\Run\\", re.IGNORECASE),
    re.compile(r"\\Environment\\", re.IGNORECASE),
    re.compile(r"\\Services\\", re.IGNORECASE),
    re.compile(r"\\Image File Execution Options\\", re.IGNORECASE),
]


@dataclass
class SysmonEvent:
    """Parsed Sysmon event."""
    event_id: int
    timestamp: str = ""
    process_id: int = 0
    parent_process_id: int = 0
    image: str = ""             # Process path
    parent_image: str = ""
    command_line: str = ""
    user: str = ""
    # Network (Event 3)
    dest_ip: str = ""
    dest_port: int = 0
    dest_hostname: str = ""
    protocol: str = ""
    # File (Event 11)
    target_filename: str = ""
    # Registry (Event 13)
    target_object: str = ""
    registry_details: str = ""
    # DLL (Event 7)
    image_loaded: str = ""
    signature: str = ""
    signed: bool = False
    # Raw
    raw_xml: str = ""


@dataclass
class BehavioralFinding:
    """A single behavioral analysis finding."""
    severity: str           # CRITICAL, HIGH, MEDIUM, LOW
    category: str           # PROCESS_SPAWN, NETWORK_EGRESS, FILE_DROP, PERSISTENCE, DLL_SIDELOAD
    description: str
    event: SysmonEvent
    mitre_technique: str = ""   # MITRE ATT&CK technique ID


@dataclass
class BehavioralScanResult:
    """Result of analyzing Sysmon telemetry from a detonation."""
    events_processed: int = 0
    extension_host_pids: list = field(default_factory=list)
    findings: list = field(default_factory=list)
    process_tree: list = field(default_factory=list)
    network_connections: list = field(default_factory=list)
    files_created: list = field(default_factory=list)
    registry_modifications: list = field(default_factory=list)
    risk_score: float = 0.0


class SysmonParser:
    """
    Parses Sysmon XML event logs and analyzes them for malicious
    behavior originating from the VS Code extension host process tree.
    """

    # The extension host process name
    EXTENSION_HOST = "extensionhost"

    def __init__(self):
        self._extension_pids = set()

    def parse_events(self, xml_data: str) -> list[SysmonEvent]:
        """
        Parse Sysmon XML log data into structured events.

        Handles both individual events and Windows Event Log XML format.
        """
        events = []

        try:
            # Wrap in root if needed
            if not xml_data.strip().startswith("<Events"):
                xml_data = f"<Events>{xml_data}</Events>"

            root = ET.fromstring(xml_data)

            for event_elem in root.iter("Event"):
                evt = self._parse_event_xml(event_elem)
                if evt:
                    events.append(evt)

        except ET.ParseError as e:
            logger.error(f"Failed to parse Sysmon XML: {e}")
            # Try line-by-line parsing as fallback
            events = self._parse_json_lines(xml_data)

        logger.info(f"Parsed {len(events)} Sysmon events")
        return events

    def parse_json_events(self, json_lines: str) -> list[SysmonEvent]:
        """Parse Sysmon events exported as JSON lines (e.g., from Winlogbeat)."""
        return self._parse_json_lines(json_lines)

    def _parse_event_xml(self, event_elem) -> Optional[SysmonEvent]:
        """Parse a single Sysmon event from XML."""
        try:
            system = event_elem.find("System")
            event_data = event_elem.find("EventData")

            if system is None or event_data is None:
                return None

            event_id_elem = system.find("EventID")
            if event_id_elem is None:
                return None

            event_id = int(event_id_elem.text)

            # Only process events we care about
            if event_id not in (1, 3, 7, 10, 11, 13):
                return None

            # Build data dict from EventData
            data = {}
            for item in event_data:
                name = item.get("Name", "")
                data[name] = item.text or ""

            evt = SysmonEvent(event_id=event_id)

            # Common fields
            time_elem = system.find("TimeCreated")
            evt.timestamp = time_elem.get("SystemTime", "") if time_elem is not None else ""
            evt.process_id = int(data.get("ProcessId", 0))
            evt.image = data.get("Image", "")
            evt.user = data.get("User", "")

            # Event-specific fields
            if event_id == 1:  # Process Creation
                evt.parent_process_id = int(data.get("ParentProcessId", 0))
                evt.parent_image = data.get("ParentImage", "")
                evt.command_line = data.get("CommandLine", "")

            elif event_id == 3:  # Network Connection
                evt.dest_ip = data.get("DestinationIp", "")
                evt.dest_port = int(data.get("DestinationPort", 0))
                evt.dest_hostname = data.get("DestinationHostname", "")
                evt.protocol = data.get("Protocol", "")

            elif event_id == 7:  # Image Loaded (DLL)
                evt.image_loaded = data.get("ImageLoaded", "")
                evt.signature = data.get("Signature", "")
                evt.signed = data.get("Signed", "").lower() == "true"

            elif event_id == 11:  # File Create
                evt.target_filename = data.get("TargetFilename", "")

            elif event_id == 13:  # Registry Value Set
                evt.target_object = data.get("TargetObject", "")
                evt.registry_details = data.get("Details", "")

            return evt

        except Exception as e:
            logger.debug(f"Failed to parse event: {e}")
            return None

    def _parse_json_lines(self, data: str) -> list[SysmonEvent]:
        """Parse JSON-line formatted Sysmon events."""
        events = []
        for line in data.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                evt = SysmonEvent(
                    event_id=int(obj.get("event_id", obj.get("EventID", 0))),
                    timestamp=obj.get("timestamp", obj.get("@timestamp", "")),
                    process_id=int(obj.get("process_id", obj.get("ProcessId", 0))),
                    parent_process_id=int(obj.get("parent_process_id", obj.get("ParentProcessId", 0))),
                    image=obj.get("image", obj.get("Image", "")),
                    parent_image=obj.get("parent_image", obj.get("ParentImage", "")),
                    command_line=obj.get("command_line", obj.get("CommandLine", "")),
                    dest_ip=obj.get("dest_ip", obj.get("DestinationIp", "")),
                    dest_port=int(obj.get("dest_port", obj.get("DestinationPort", 0))),
                    dest_hostname=obj.get("dest_hostname", obj.get("DestinationHostname", "")),
                    target_filename=obj.get("target_filename", obj.get("TargetFilename", "")),
                    target_object=obj.get("target_object", obj.get("TargetObject", "")),
                    image_loaded=obj.get("image_loaded", obj.get("ImageLoaded", "")),
                    signed=obj.get("signed", "").lower() == "true" if isinstance(obj.get("signed"), str) else bool(obj.get("signed", False)),
                )
                if evt.event_id in (1, 3, 7, 10, 11, 13):
                    events.append(evt)
            except (json.JSONDecodeError, ValueError):
                continue
        return events

    def analyze(self, events: list[SysmonEvent]) -> BehavioralScanResult:
        """
        Analyze Sysmon events for malicious behavior originating
        from the VS Code extension host process tree.

        Returns:
            BehavioralScanResult with findings and risk score.
        """
        result = BehavioralScanResult()
        result.events_processed = len(events)

        # Step 1: Build extension host process tree
        self._build_extension_tree(events)
        result.extension_host_pids = list(self._extension_pids)

        # Step 2: Analyze events from extension processes
        for event in events:
            # Only analyze events from extension host tree
            if event.process_id not in self._extension_pids:
                # Check if parent is in tree (catches new children)
                if event.event_id == 1 and event.parent_process_id in self._extension_pids:
                    self._extension_pids.add(event.process_id)
                else:
                    continue

            if event.event_id == 1:
                self._analyze_process_creation(event, result)
            elif event.event_id == 3:
                self._analyze_network(event, result)
            elif event.event_id == 7:
                self._analyze_dll_load(event, result)
            elif event.event_id == 11:
                self._analyze_file_create(event, result)
            elif event.event_id == 13:
                self._analyze_registry(event, result)

        # Calculate risk
        weights = {"CRITICAL": 0.4, "HIGH": 0.15, "MEDIUM": 0.05, "LOW": 0.01}
        result.risk_score = min(
            sum(weights.get(f.severity, 0.01) for f in result.findings),
            1.0,
        )

        logger.info(
            f"Behavioral analysis: {result.events_processed} events, "
            f"{len(result.findings)} findings, risk={result.risk_score:.2f}"
        )
        return result

    def _build_extension_tree(self, events: list[SysmonEvent]):
        """Identify extension host processes and their children."""
        self._extension_pids.clear()

        # Find extensionHost processes
        for evt in events:
            if evt.event_id == 1:
                image_lower = evt.image.lower()
                if self.EXTENSION_HOST in image_lower or "code" in image_lower:
                    self._extension_pids.add(evt.process_id)

        # Walk children iteratively
        changed = True
        while changed:
            changed = False
            for evt in events:
                if evt.event_id == 1 and evt.parent_process_id in self._extension_pids:
                    if evt.process_id not in self._extension_pids:
                        self._extension_pids.add(evt.process_id)
                        changed = True

    def _analyze_process_creation(self, event: SysmonEvent, result: BehavioralScanResult):
        """Analyze Event ID 1: Process Creation."""
        proc_name = event.image.split("\\")[-1].lower()

        result.process_tree.append({
            "pid": event.process_id,
            "ppid": event.parent_process_id,
            "image": event.image,
            "command_line": event.command_line,
            "timestamp": event.timestamp,
        })

        if proc_name in SUSPICIOUS_PROCESSES:
            # Determine severity
            critical_procs = {"powershell.exe", "pwsh.exe", "cmd.exe", "certutil.exe", "mshta.exe"}
            severity = "CRITICAL" if proc_name in critical_procs else "HIGH"

            result.findings.append(BehavioralFinding(
                severity=severity,
                category="PROCESS_SPAWN",
                description=f"Extension spawned suspicious process: {proc_name} -> {event.command_line[:200]}",
                event=event,
                mitre_technique="T1059" if proc_name in critical_procs else "T1106",
            ))

    def _analyze_network(self, event: SysmonEvent, result: BehavioralScanResult):
        """Analyze Event ID 3: Network Connection."""
        result.network_connections.append({
            "dest_ip": event.dest_ip,
            "dest_port": event.dest_port,
            "dest_hostname": event.dest_hostname,
            "protocol": event.protocol,
            "timestamp": event.timestamp,
            "source_image": event.image,
        })

        # Flag non-standard ports
        standard_ports = {80, 443, 53}
        if event.dest_port and event.dest_port not in standard_ports:
            result.findings.append(BehavioralFinding(
                severity="MEDIUM",
                category="NETWORK_EGRESS",
                description=f"Outbound connection to {event.dest_ip}:{event.dest_port} ({event.dest_hostname})",
                event=event,
                mitre_technique="T1071",
            ))
        elif event.dest_ip:
            # Standard port but still noteworthy
            result.findings.append(BehavioralFinding(
                severity="LOW",
                category="NETWORK_EGRESS",
                description=f"Network connection: {event.dest_ip}:{event.dest_port}",
                event=event,
            ))

    def _analyze_dll_load(self, event: SysmonEvent, result: BehavioralScanResult):
        """Analyze Event ID 7: Image Loaded (DLL sideloading)."""
        if not event.signed and event.image_loaded:
            # Unsigned DLL loaded by extension process
            result.findings.append(BehavioralFinding(
                severity="HIGH",
                category="DLL_SIDELOAD",
                description=f"Unsigned DLL loaded: {event.image_loaded}",
                event=event,
                mitre_technique="T1574.001",
            ))

    def _analyze_file_create(self, event: SysmonEvent, result: BehavioralScanResult):
        """Analyze Event ID 11: File Create."""
        result.files_created.append({
            "target": event.target_filename,
            "timestamp": event.timestamp,
            "source_image": event.image,
        })

        for pattern in SUSPICIOUS_FILE_PATHS:
            if pattern.search(event.target_filename):
                # Check if it's a honey token access
                is_honeytok = any(
                    tok in event.target_filename.lower()
                    for tok in (".ssh", ".aws", ".kube")
                )

                severity = "CRITICAL" if is_honeytok else "HIGH"
                category = "CREDENTIAL_ACCESS" if is_honeytok else "FILE_DROP"

                result.findings.append(BehavioralFinding(
                    severity=severity,
                    category=category,
                    description=f"Suspicious file operation: {event.target_filename}",
                    event=event,
                    mitre_technique="T1552" if is_honeytok else "T1105",
                ))
                break

    def _analyze_registry(self, event: SysmonEvent, result: BehavioralScanResult):
        """Analyze Event ID 13: Registry Value Set."""
        result.registry_modifications.append({
            "target": event.target_object,
            "details": event.registry_details,
            "timestamp": event.timestamp,
            "source_image": event.image,
        })

        for pattern in PERSISTENCE_REGISTRY_KEYS:
            if pattern.search(event.target_object):
                result.findings.append(BehavioralFinding(
                    severity="CRITICAL",
                    category="PERSISTENCE",
                    description=f"Registry persistence: {event.target_object} = {event.registry_details[:100]}",
                    event=event,
                    mitre_technique="T1547.001",
                ))
                break


def analyze_sysmon_log(log_data: str, format: str = "xml") -> BehavioralScanResult:
    """Convenience function to parse and analyze Sysmon logs."""
    parser = SysmonParser()
    if format == "json":
        events = parser.parse_json_events(log_data)
    else:
        events = parser.parse_events(log_data)
    return parser.analyze(events)
