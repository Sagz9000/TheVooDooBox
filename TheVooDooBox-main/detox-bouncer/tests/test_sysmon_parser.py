"""Unit test: Sysmon parser with synthetic event data."""
import sys
sys.path.insert(0, r"c:\AntiCode\ExtensionDetox")

from core.detonation.sysmon_parser import SysmonParser, analyze_sysmon_log

# Simulate Sysmon JSON lines as they'd come from Winlogbeat
sysmon_json = """
{"event_id": 1, "ProcessId": 100, "ParentProcessId": 1, "Image": "C:\\\\Program Files\\\\Microsoft VS Code\\\\Code.exe", "CommandLine": "code.exe --verbose", "timestamp": "2026-02-21T10:00:00Z"}
{"event_id": 1, "ProcessId": 200, "ParentProcessId": 100, "Image": "C:\\\\Program Files\\\\Microsoft VS Code\\\\extensionHost.exe", "CommandLine": "extensionHost --type=extensionHost", "timestamp": "2026-02-21T10:00:01Z"}
{"event_id": 1, "ProcessId": 300, "ParentProcessId": 200, "Image": "C:\\\\Windows\\\\System32\\\\cmd.exe", "CommandLine": "cmd.exe /c whoami > C:\\\\Temp\\\\output.txt", "timestamp": "2026-02-21T10:00:05Z"}
{"event_id": 1, "ProcessId": 301, "ParentProcessId": 200, "Image": "C:\\\\Windows\\\\System32\\\\powershell.exe", "CommandLine": "powershell.exe -enc SQBFAHgA...", "timestamp": "2026-02-21T10:00:06Z"}
{"event_id": 3, "ProcessId": 200, "Image": "extensionHost.exe", "DestinationIp": "185.199.108.133", "DestinationPort": 8443, "DestinationHostname": "evil-c2.tk", "Protocol": "tcp", "timestamp": "2026-02-21T10:00:10Z"}
{"event_id": 11, "ProcessId": 200, "Image": "extensionHost.exe", "TargetFilename": "C:\\\\Users\\\\lab\\\\.ssh\\\\id_rsa.bak", "timestamp": "2026-02-21T10:00:12Z"}
{"event_id": 13, "ProcessId": 200, "Image": "extensionHost.exe", "TargetObject": "HKLM\\\\SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run\\\\EvilExtension", "Details": "C:\\\\Temp\\\\payload.exe", "timestamp": "2026-02-21T10:00:15Z"}
{"event_id": 7, "ProcessId": 200, "Image": "extensionHost.exe", "ImageLoaded": "C:\\\\Temp\\\\malicious.dll", "Signature": "", "Signed": "false", "timestamp": "2026-02-21T10:00:18Z"}
{"event_id": 1, "ProcessId": 999, "ParentProcessId": 50, "Image": "C:\\\\Windows\\\\explorer.exe", "CommandLine": "explorer.exe", "timestamp": "2026-02-21T10:00:20Z"}
"""

result = analyze_sysmon_log(sysmon_json, format="json")

print(f"Events processed: {result.events_processed}")
print(f"Extension Host PIDs: {result.extension_host_pids}")
print(f"Process tree entries: {len(result.process_tree)}")
print(f"Network connections: {len(result.network_connections)}")
print(f"Files created: {len(result.files_created)}")
print(f"Registry mods: {len(result.registry_modifications)}")
print(f"Risk score: {result.risk_score:.2f}")
print(f"\nFindings ({len(result.findings)}):")
for f in result.findings:
    mitre = f" [{f.mitre_technique}]" if f.mitre_technique else ""
    print(f"  [{f.severity:8s}] {f.category:20s} {f.description[:80]}{mitre}")

# Assertions
assert result.events_processed >= 7, f"Expected >= 7 events, got {result.events_processed}"
assert len(result.findings) >= 4, f"Expected >= 4 findings, got {len(result.findings)}"
assert result.risk_score > 0.5, f"Expected risk > 0.5, got {result.risk_score}"

# Verify explorer.exe (PID 999) was NOT flagged (not in extension tree)
flagged_pids = {f.event.process_id for f in result.findings}
assert 999 not in flagged_pids, "Explorer.exe should NOT be flagged (not in extension tree)"

print("\nAll assertions passed!")
