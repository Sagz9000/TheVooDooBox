# How to Build the VoodooBox Kernel Driver

## Prerequisites
*   **Docker Desktop** running in **Windows Containers** mode.
*   (Or) **Visual Studio 2022** + **Windows Driver Kit (WDK)** installed locally.

## Option 1: Docker Build (Recommended)
This method ensures a clean build environment without cluttering your host machine.

1.  **Switch to Windows Containers**: 
    Right-click Docker Desktop tray icon -> "Switch to Windows containers...".

2.  **Build the Image**:
    ```powershell
    cd c:\AntiCode\TheVooDooBox\TheVooDooBox-main\kernel-driver
    docker build -f Dockerfile.driver -t voodoobox-driver-builder .
    ```

3.  **Extract the Driver**:
    ```powershell
    docker run --name driver-extract voodoobox-driver-builder
    docker cp driver-extract:C:\build\target\x86_64-pc-windows-msvc\release\voodoobox_eye.sys .\voodoobox_eye.sys
    docker rm driver-extract
    ```

4.  **Install**:
    Copy `voodoobox_eye.sys` to the `guest-setup` folder and run `install_driver.ps1` inside the VM.

## Option 2: Local Build
If you have Rust and WDK installed:

```powershell
cargo build --release --package voodoobox-filter
```
The output will be in `target\x86_64-pc-windows-msvc\release\voodoobox_eye.sys`.
