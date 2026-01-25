# Malicious Simulation Binaries (Rust Edition)

This folder contains a suite of "safe" malware simulations rewritten in **Rust** for the VoodooBox lab. 

## Why Rust?
- **Native performance**: No managed runtime or VM required.
- **Massive size reduction**: Binaries are ~1.1MB (C# versions were ~67MB).
- **Static linking**: Everything needed to run is packed into the single `.exe`.

## Tools Summary

### 1. ps_encoded
- **Location**: `out_rust/ps_encoded.exe`
- **Behavior**: Launches `powershell.exe` with a Base64-encoded UTF-16LE command.
- **Telemetry**: Process creation (powershell.exe), EncodedCommand CLI analysis.

### 2. lolbin_sim
- **Location**: `out_rust/lolbin_sim.exe`
- **Behavior**: Uses `certutil.exe` to simulate a remote file download.
- **Telemetry**: Process creation (certutil.exe), Network connection, File creation (`voodootest_rust.txt`).

### 3. beacon_sim
- **Location**: `out_rust/beacon_sim.exe`
- **Behavior**: Makes 5 periodic HTTP GET requests using the `ureq` crate.
- **Telemetry**: Network connections (Event ID 3), DNS queries.

### 4. reg_persist
- **Location**: `out_rust/reg_persist.exe`
- **Behavior**: Sets a native registry run key using the `winreg` crate, then cleans up.
- **Telemetry**: Registry value set (Event ID 13).

### 5. schtask_sim
- **Location**: `out_rust/schtask_sim.exe`
- **Behavior**: Creates a scheduled task via `schtasks.exe`, then deletes it.
- **Telemetry**: Task creation/deletion events.

### 6. reg_tamper
- **Location**: `out_rust/reg_tamper.exe`
- **Behavior**: Modifies Explorer's "Hidden files" registry setting to simulate system hijacking.
- **Telemetry**: Registry modification.

### 7. artifact_gen
- **Location**: `out_rust/artifact_gen.exe`
- **Behavior**: Generates `simulation_rust.hta` and `malicious_link_rust.lnk`.
- **Telemetry**: File creation events.

## Build Requirements
- **Docker Desktop**: The project uses a multi-stage Docker build to cross-compile from Linux to Windows targets.

## Quick Start
To recompile:
```powershell
powershell -ExecutionPolicy Bypass -File ./build_rust.ps1
```
The binaries will appear in the `out_rust/` directory.
