"""
ExtensionDetox - Proxmox Chamber Manager

Orchestrates Proxmox VM lifecycle for dynamic analysis (detonation).
Mirrors TheVooDooBox's ProxmoxClient interface for seamless merging.

Lifecycle:
1. Clone Gold Image -> Fresh detonation VM
2. Inject VSIX into VM
3. Start monitoring (Sysmon, Zeek)
4. Execute extension in VS Code
5. Collect telemetry
6. Snapshot for forensics
7. Destroy VM
"""

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

import requests
import urllib3

# Suppress SSL warnings for self-signed Proxmox certs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger("ExtensionDetox.ProxmoxManager")


@dataclass
class VMState:
    """State of a detonation VM."""
    vmid: int
    name: str
    node: str
    status: str = "unknown"         # running, stopped, etc.
    ip_address: str = ""
    clone_source: int = 0           # Gold Image VMID
    task_id: str = ""               # ExtensionDetox task ID
    extension_id: str = ""
    created_at: str = ""


class ProxmoxManager:
    """
    Manages Proxmox VMs for the detonation chamber.

    Mirrors TheVooDooBox's ProxmoxClient Rust trait,
    providing Python equivalents for clone, start, stop, and destroy.

    Usage:
        pm = ProxmoxManager(config)
        vm = pm.clone_gold_image("my-detox-vm-001", extension_id="evil.ext")
        pm.start_vm(vm.vmid)
        # ... do analysis ...
        pm.snapshot_vm(vm.vmid, "post-detonation")
        pm.destroy_vm(vm.vmid)
    """

    def __init__(self, config: dict):
        prox_cfg = config.get("proxmox", {})
        self.base_url = prox_cfg.get("url", "https://192.168.50.200:8006")
        self.user = prox_cfg.get("user", "root@pam")
        self.token_id = prox_cfg.get("token_id", "MalwareLab")
        self.token_secret = (
            os.environ.get("PROXMOX_TOKEN_SECRET", "")
            or prox_cfg.get("token_secret_env", "")
        )
        self.gold_image_vmid = prox_cfg.get("gold_image_vmid")
        self.target_node = prox_cfg.get("target_node")

        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"PVEAPIToken={self.user}!{self.token_id}={self.token_secret}",
        })
        self.session.verify = False  # Self-signed certs in lab

        # Auto-detect node if not configured
        if not self.target_node:
            self._detect_node()

    def _detect_node(self):
        """Auto-detect the first Proxmox node."""
        try:
            resp = self._api_get("/api2/json/nodes")
            nodes = resp.get("data", [])
            if nodes:
                self.target_node = nodes[0].get("node", "pve")
                logger.info(f"Auto-detected Proxmox node: {self.target_node}")
        except Exception as e:
            logger.warning(f"Could not auto-detect node: {e}. Defaulting to 'pve'.")
            self.target_node = "pve"

    def _api_get(self, endpoint: str) -> dict:
        """Make a GET request to the Proxmox API."""
        url = f"{self.base_url}{endpoint}"
        resp = self.session.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _api_post(self, endpoint: str, data: dict = None) -> dict:
        """Make a POST request to the Proxmox API."""
        url = f"{self.base_url}{endpoint}"
        resp = self.session.post(url, data=data, timeout=60)
        resp.raise_for_status()
        return resp.json()

    def _api_delete(self, endpoint: str) -> dict:
        """Make a DELETE request to the Proxmox API."""
        url = f"{self.base_url}{endpoint}"
        resp = self.session.delete(url, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _wait_for_task(self, upid: str, timeout: int = 120):
        """Wait for a Proxmox task to complete."""
        endpoint = f"/api2/json/nodes/{self.target_node}/tasks/{upid}/status"
        start = time.time()
        while time.time() - start < timeout:
            try:
                resp = self._api_get(endpoint)
                status = resp.get("data", {}).get("status", "")
                if status == "stopped":
                    exitstatus = resp.get("data", {}).get("exitstatus", "")
                    if exitstatus == "OK":
                        return True
                    else:
                        raise RuntimeError(f"Proxmox task failed: {exitstatus}")
            except requests.exceptions.RequestException:
                pass
            time.sleep(2)
        raise TimeoutError(f"Proxmox task {upid} timed out after {timeout}s")

    # ──────────────────────────────────────────
    # VM Lifecycle
    # ──────────────────────────────────────────

    def clone_gold_image(
        self,
        vm_name: str,
        extension_id: str = "",
        new_vmid: int = None,
    ) -> VMState:
        """
        Clone the Gold Image to create a fresh detonation VM.

        Args:
            vm_name: Name for the new VM
            extension_id: Extension being analyzed (for tracking)
            new_vmid: Optional specific VMID. If None, Proxmox auto-assigns.

        Returns:
            VMState for the new VM
        """
        if not self.gold_image_vmid:
            raise ValueError("Gold Image VMID not configured")

        endpoint = f"/api2/json/nodes/{self.target_node}/qemu/{self.gold_image_vmid}/clone"
        data = {
            "name": vm_name,
            "full": 1,  # Full clone, not linked (for isolation)
            "description": f"ExtensionDetox detonation VM for {extension_id}",
        }
        if new_vmid:
            data["newid"] = new_vmid

        logger.info(f"Cloning Gold Image {self.gold_image_vmid} -> {vm_name}")
        resp = self._api_post(endpoint, data)

        # Wait for clone task
        upid = resp.get("data", "")
        if upid:
            self._wait_for_task(upid, timeout=180)

        # Get the new VMID from the task or auto-detect
        vmid = new_vmid or self._find_vm_by_name(vm_name)
        if not vmid:
            raise RuntimeError(f"Failed to find cloned VM: {vm_name}")

        vm = VMState(
            vmid=vmid,
            name=vm_name,
            node=self.target_node,
            status="stopped",
            clone_source=self.gold_image_vmid,
            extension_id=extension_id,
        )

        logger.info(f"Clone complete: VMID={vmid}")
        return vm

    def start_vm(self, vmid: int):
        """Start a detonation VM."""
        endpoint = f"/api2/json/nodes/{self.target_node}/qemu/{vmid}/status/start"
        logger.info(f"Starting VM {vmid}")
        resp = self._api_post(endpoint)
        upid = resp.get("data", "")
        if upid:
            self._wait_for_task(upid)
        logger.info(f"VM {vmid} started")

    def stop_vm(self, vmid: int):
        """Stop a detonation VM."""
        endpoint = f"/api2/json/nodes/{self.target_node}/qemu/{vmid}/status/stop"
        logger.info(f"Stopping VM {vmid}")
        resp = self._api_post(endpoint)
        upid = resp.get("data", "")
        if upid:
            self._wait_for_task(upid)

    def snapshot_vm(self, vmid: int, snapshot_name: str = "post-detonation"):
        """Take a snapshot of the VM for forensic analysis."""
        endpoint = f"/api2/json/nodes/{self.target_node}/qemu/{vmid}/snapshot"
        data = {
            "snapname": snapshot_name,
            "description": f"ExtensionDetox forensic snapshot",
            "vmstate": 1,  # Include RAM state
        }
        logger.info(f"Snapshotting VM {vmid}: {snapshot_name}")
        resp = self._api_post(endpoint, data)
        upid = resp.get("data", "")
        if upid:
            self._wait_for_task(upid, timeout=300)
        logger.info(f"Snapshot complete: {snapshot_name}")

    def destroy_vm(self, vmid: int):
        """Destroy a detonation VM after analysis."""
        # Stop first if running
        try:
            self.stop_vm(vmid)
        except Exception:
            pass

        endpoint = f"/api2/json/nodes/{self.target_node}/qemu/{vmid}"
        logger.info(f"Destroying VM {vmid}")
        resp = self._api_delete(endpoint)
        upid = resp.get("data", "")
        if upid:
            self._wait_for_task(upid)
        logger.info(f"VM {vmid} destroyed")

    def get_vm_status(self, vmid: int) -> dict:
        """Get current VM status."""
        endpoint = f"/api2/json/nodes/{self.target_node}/qemu/{vmid}/status/current"
        resp = self._api_get(endpoint)
        return resp.get("data", {})

    def _find_vm_by_name(self, name: str) -> Optional[int]:
        """Find a VM's ID by its name."""
        endpoint = f"/api2/json/nodes/{self.target_node}/qemu"
        resp = self._api_get(endpoint)
        for vm in resp.get("data", []):
            if vm.get("name") == name:
                return vm.get("vmid")
        return None

    # ──────────────────────────────────────────
    # Detonation Helpers
    # ──────────────────────────────────────────

    def inject_vsix(self, vmid: int, vsix_path: str, method: str = "scp"):
        """
        Copy the VSIX file into the detonation VM.

        Args:
            vmid: Target VM ID
            vsix_path: Local path to the .vsix file
            method: Transfer method ('scp' or 'shared_folder')
        """
        vm_status = self.get_vm_status(vmid)
        vm_ip = self._extract_ip(vm_status)

        if not vm_ip:
            raise RuntimeError(f"Cannot determine IP for VM {vmid}")

        if method == "scp":
            # This would use paramiko or subprocess in production
            logger.info(f"Would SCP {vsix_path} to {vm_ip}:/tmp/extension.vsix")
        elif method == "shared_folder":
            logger.info(f"Would copy {vsix_path} to shared NFS mount for VM {vmid}")

    def _extract_ip(self, vm_status: dict) -> str:
        """Extract the IP address from VM status/QEMU agent data."""
        # Try QEMU guest agent first
        net = vm_status.get("agent", {}).get("network-interfaces", [])
        for iface in net:
            for addr in iface.get("ip-addresses", []):
                ip = addr.get("ip-address", "")
                if ip and not ip.startswith("127.") and not ip.startswith("fe80"):
                    return ip
        return ""
