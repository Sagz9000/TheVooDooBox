import os
import sys
import socket
import platform
import subprocess
import logging
from xmlrpc.server import SimpleXMLRPCServer
import base64
import json

# ==========================================
# TheVooDooBox - Unified Sandbox Agent
# ==========================================
# Designed for deep integration with TheVooDooBox Backend.
# Compatible with CAPE XML-RPC protocol for analyzer support.

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(os.path.join(os.environ.get("TEMP", "C:\\"), "voodoobox_agent.log"))
    ]
)
log = logging.getLogger("VooDooBoxAgent")

class VooDooBoxAgent:
    def __init__(self):
        self.system = platform.system()
        self.version = platform.version()
        self.hostname = socket.gethostname()
        log.info(f"Agent initialized on {self.hostname} ({self.system} {self.version})")

    def get_status(self):
        """Returns the current status of the agent."""
        return "READY"

    def get_info(self):
        """Returns detailed system information."""
        return {
            "os": self.system,
            "version": self.version,
            "hostname": self.hostname,
            "python": sys.version,
            "cwd": os.getcwd()
        }

    def execute(self, command, wait=False):
        """Executes a system command."""
        log.info(f"Executing: {command} (wait={wait})")
        try:
            if wait:
                result = subprocess.run(command, shell=True, capture_output=True, text=True)
                return {
                    "success": result.returncode == 0,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "code": result.returncode
                }
            else:
                subprocess.Popen(command, shell=True)
                return {"success": True, "message": "Command started in background"}
        except Exception as e:
            log.error(f"Execution failed: {e}")
            return {"success": False, "error": str(e)}

    def upload(self, b64_content, dest_path):
        """Decodes and saves a file to the VM."""
        log.info(f"Uploading file to: {dest_path}")
        try:
            content = base64.b64decode(b64_content)
            # Ensure directory exists
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            with open(dest_path, "wb") as f:
                f.write(content)
            return True
        except Exception as e:
            log.error(f"Upload failed: {e}")
            return False

    def download(self, file_path):
        """Reads a file and returns it as a base64 string."""
        log.info(f"Downloading file from: {file_path}")
        try:
            if not os.path.exists(file_path):
                return {"success": False, "error": "File not found"}
            with open(file_path, "rb") as f:
                content = base64.b64encode(f.read()).decode("utf-8")
            return {"success": True, "data": content}
        except Exception as e:
            log.error(f"Download failed: {e}")
            return {"success": False, "error": str(e)}

    def kill(self):
        """Stops the agent."""
        log.warning("Agent kill signal received.")
        sys.exit(0)

if __name__ == "__main__":
    # Standard TheVooDooBox/CAPE Agent Port
    PORT = 8000
    HOST = "0.0.0.0"
    
    server = SimpleXMLRPCServer((HOST, PORT), allow_none=True)
    server.register_instance(VooDooBoxAgent())
    
    log.info(f"TheVooDooBox Agent listening on {HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Agent shutting down...")
