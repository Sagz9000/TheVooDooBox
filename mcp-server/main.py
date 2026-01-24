from mcp.server.fastmcp import FastMCP
import requests
import os

# Mallab V3 - Agentic MCP Server
mcp = FastMCP("Mallab-V3-Investigator")

BACKEND_URL = os.environ.get("BACKEND_URL", "http://hyper-bridge:8080")

@mcp.tool()
def list_lab_vms():
    """Returns a list of all VMs in the lab and their current power status."""
    return requests.get(f"{BACKEND_URL}/vms").json()

@mcp.tool()
def get_vm_telemetry(limit: int = 100):
    """Fetches recent process events from the database."""
    history = requests.get(f"{BACKEND_URL}/vms/telemetry/history").json()
    return history[:limit] if history else []

@mcp.tool()
def trigger_ghidra_analysis(binary_name: str):
    """Triggers headless Ghidra analysis on an uploaded binary."""
    GHIDRA_API = os.environ.get("GHIDRA_API", "http://ghidra:8000")
    payload = {"binary_name": binary_name}
    return requests.post(f"{GHIDRA_API}/analyze", json=payload).json()

@mcp.tool()
def query_static_functions(binary_name: str):
    """Retrieves list of functions identified by Ghidra."""
    GHIDRA_API = os.environ.get("GHIDRA_API", "http://ghidra:8000")
    return requests.get(f"{GHIDRA_API}/binary/{binary_name}/functions").json()

@mcp.tool()
def decompile_function(binary_name: str, address: str):
    """Decompiles a specific function at the given address."""
    GHIDRA_API = os.environ.get("GHIDRA_API", "http://ghidra:8000")
    return requests.get(f"{GHIDRA_API}/binary/{binary_name}/decompile/{address}").json()

@mcp.tool()
def rollback_vm(node: str, vmid: int, snapshot: str = "GOLD_IMAGE"):
    """Rolls back a VM to a known clean state."""
    payload = {"snapshot": snapshot}
    return requests.post(f"{BACKEND_URL}/vms/{node}/{vmid}/revert", json=payload).json()

if __name__ == "__main__":
    import uvicorn
    import os
    
    port = int(os.environ.get("UVICORN_PORT", 8001))
    host = os.environ.get("UVICORN_HOST", "0.0.0.0")
    
    print(f"Starting Mallab V3 Investigator MCP Server on {host}:{port} (SSE mode)...")
    uvicorn.run(mcp.sse_app, host=host, port=port)
