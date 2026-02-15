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

# --- FORENSIC MEMORY TOOLS ---

@mcp.tool()
def add_analyst_note(task_id: str, content: str, is_hint: bool = False):
    """Saves a forensic finding or observation to the task's permanent record.
    Use this to record insights during investigation so they persist across sessions.
    Set is_hint=True for AI-generated insights, False for factual observations."""
    payload = {"task_id": task_id, "content": content, "is_hint": is_hint}
    return requests.post(f"{BACKEND_URL}/tasks/notes", json=payload).json()

@mcp.tool()
def get_notes(task_id: str):
    """Retrieves all analyst notes (both human and AI-generated) for a task.
    Use this to review the forensic memory and maintain investigation continuity."""
    return requests.get(f"{BACKEND_URL}/tasks/{task_id}/notes").json()

@mcp.tool()
def tag_telemetry_event(task_id: str, event_id: int, tag_type: str, comment: str = ""):
    """Tags a specific telemetry event with a forensic classification.
    tag_type examples: 'suspicious', 'malicious', 'benign', 'c2', 'persistence', 'exfiltration'."""
    payload = {"task_id": task_id, "event_id": event_id, "tag_type": tag_type, "comment": comment}
    return requests.post(f"{BACKEND_URL}/tasks/tags", json=payload).json()

@mcp.tool()
def search_knowledge_base(query: str, n_results: int = 5):
    """Searches the local malware intelligence vector database (ChromaDB) for relevant knowledge.
    Use this to find MITRE techniques, malware family info, or forensic procedures."""
    CHROMADB_URL = os.environ.get("CHROMADB_URL", "http://chromadb:8000")
    payload = {
        "query_texts": [query],
        "n_results": n_results,
        "include": ["documents", "distances"]
    }
    try:
        collection_name = "malware_knowledge"
        resp = requests.post(f"{CHROMADB_URL}/api/v1/collections/{collection_name}/query", json=payload)
        if resp.status_code == 200:
            return resp.json()
        return {"error": f"ChromaDB returned {resp.status_code}", "detail": resp.text}
    except Exception as e:
        return {"error": str(e)}

@mcp.tool()
def get_task_status(task_id: str):
    """Returns the full metadata and current status of an analysis task, including verdicts and report status."""
    tasks = requests.get(f"{BACKEND_URL}/tasks").json()
    for task in tasks:
        if task.get("id") == task_id:
            return task
    return {"error": f"Task {task_id} not found"}

if __name__ == "__main__":
    import uvicorn
    import os
    
    port = int(os.environ.get("UVICORN_PORT", 8001))
    host = os.environ.get("UVICORN_HOST", "0.0.0.0")
    
    print(f"Starting Mallab V3 Investigator MCP Server on {host}:{port} (SSE mode)...")
    uvicorn.run(mcp.sse_app, host=host, port=port)
