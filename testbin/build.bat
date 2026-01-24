@echo off
REM Build script for Telemetry Generator
REM Requires Visual Studio or Windows SDK with cl.exe in PATH

echo Building Telemetry Generator...
echo.

REM Compile the program
cl.exe /nologo /W3 /O2 /Fe:telemetry_generator.exe telemetry_generator.c /link ws2_32.lib wininet.lib advapi32.lib

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [+] Build successful!
    echo [+] Output: telemetry_generator.exe
    echo.
    echo To run: telemetry_generator.exe
) else (
    echo.
    echo [-] Build failed!
    echo.
    echo Make sure you have Visual Studio installed and run this from:
    echo "Developer Command Prompt for VS" or "x64 Native Tools Command Prompt"
)

pause
