# Telemetry Generator - Test Binary for Malware Lab

This is a **test binary** designed to generate telemetry events for testing malware detection sensors in a lab environment. It simulates common malware behaviors without being malicious.

## Features

The binary performs the following actions to generate telemetry:

### 1. **Registry Modifications**
- Creates a `RunOnce` entry in `HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce`
- Creates a `Run` entry (startup) in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- Creates custom registry keys under `HKCU\Software\TelemetryTest`

### 2. **Network Activity**
- Makes HTTP requests to various URLs (simulating C2 beaconing)
- Connects to: example.com, httpbin.org, google.com, ipify.org, amazonaws.com
- Uses custom User-Agent: "TelemetryBot/1.0"

### 3. **DNS Queries**
- Performs DNS lookups for multiple domains
- Includes both legitimate and suspicious-looking domain names

### 4. **File Operations**
- Creates configuration files in the temp directory
- Creates log files with timestamps
- Creates hidden files (FILE_ATTRIBUTE_HIDDEN)

### 5. **Process Artifacts**
- Creates a named mutex: `Global\TelemetryTestMutex`
- Generates random sleep intervals between operations

## Building

### Requirements
- Windows 10/11
- Visual Studio 2019 or later (with C++ build tools)
- OR Windows SDK with cl.exe compiler

### Compilation

**Option 1: Using the build script**
```batch
# Open "Developer Command Prompt for VS" or "x64 Native Tools Command Prompt"
cd testbin
build.bat
```

**Option 2: Manual compilation**
```batch
cl.exe /W3 /O2 /Fe:telemetry_generator.exe telemetry_generator.c /link ws2_32.lib wininet.lib advapi32.lib
```

**Option 3: Using MinGW-w64**
```batch
gcc telemetry_generator.c -o telemetry_generator.exe -lwininet -lws2_32 -ladvapi32
```

## Usage

Simply run the compiled executable:
```batch
telemetry_generator.exe
```

The program will:
1. Display status messages for each operation
2. Generate telemetry events
3. Wait for user input before exiting

## Cleanup

To remove the registry entries created by this tool:

```batch
# Remove RunOnce entry
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v TelemetryTest /f

# Remove Run entry
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v TelemetryService /f

# Remove custom key
reg delete "HKCU\Software\TelemetryTest" /f
```

To remove created files:
```batch
del %TEMP%\telemetry_config.dat
del %TEMP%\telemetry_log.txt
del %TEMP%\.telemetry_cache
```

## Safety Notes

⚠️ **This is a test tool for lab environments only!**

- This binary is **NOT malware** - it only simulates telemetry generation
- All network requests go to legitimate, safe websites
- Registry entries are created in HKCU (current user) only, not HKLM
- No data exfiltration or malicious payload
- No privilege escalation attempts
- No system damage or destructive operations

## Expected Telemetry

Your malware sensor should detect:
- ✅ Registry persistence mechanisms (RunOnce, Run keys)
- ✅ Network connections to multiple domains
- ✅ DNS queries
- ✅ File creation in temp directories
- ✅ Mutex creation
- ✅ Suspicious user-agent strings

## Customization

You can modify the source code to:
- Add more URLs for web requests
- Change registry key locations
- Add additional file operations
- Modify sleep intervals
- Add more DNS lookups
- Include additional telemetry-generating behaviors

## License

This is a test tool for educational and lab testing purposes. Use responsibly and only in controlled environments.
