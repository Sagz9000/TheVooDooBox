@echo off
echo Building Telemetry Generator using Docker...
echo.

REM Build the Docker image
echo [*] Building Docker image...
docker build -t telemetry-builder .

if %ERRORLEVEL% NEQ 0 (
    echo [-] Docker build failed!
    pause
    exit /b 1
)

echo.
echo [*] Extracting compiled binary...

REM Create a temporary container and copy the executable
docker create --name temp-telemetry telemetry-builder
docker cp temp-telemetry:/build/telemetry_generator.exe .
docker rm temp-telemetry

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [+] Build successful!
    echo [+] Output: telemetry_generator.exe
    echo.
    dir telemetry_generator.exe
) else (
    echo.
    echo [-] Failed to extract binary!
)

echo.
pause
