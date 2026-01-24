# Driver & Development Guide

## 👁️ "The Eye" Kernel Driver

"The Eye" is a Windows Kernel-Mode driver designed for **Anti-Tamper protection**. It ensures the Mallab Agent remains active even when targeted by aggressive malware.

### Building
The driver is written in Rust and requires the Windows Driver Kit (WDK) and the `wdk` build integration.

```bash
cd driver
cargo build --release
```

### Installation
1. Move the `.sys` file to the guest VM.
2. Use the provided script:
   ```powershell
   .\scripts\guest\install_driver.ps1
   ```

## 🛠️ Project Development

### Backend (Rust)
The bridge is a high-performance asynchronous server.
- **Path**: `backend/`
- **Build**: `cargo build`

### Frontend (React)
The dashboard uses Vite and TailwindCSS.
- **Path**: `frontend/`
- **Install**: `npm install`
- **Dev**: `npm run dev`

### Project Structure
See the [Architecture Guide](./ARCHITECTURE.md) for a map of the codebase.
