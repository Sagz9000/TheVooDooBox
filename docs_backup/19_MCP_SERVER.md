# MCP Server: The "Investigator"

The **Model Context Protocol (MCP)** server acts as the bridge between Agentic AI (like Gemini or the internal VoodooBox Analyst) and the lab's infrastructure. It runs as a standalone Python service, exposing tools that allow LLMs to take action.

## 🏗️ Architecture

*   **Service Name**: `mcp-server`
*   **Port**: `8001` (SSE Mode)
*   **Language**: Python 3.10+
*   **Framework**: `mcp` SDK + `fastapi`

The server does not access the database directly. Instead, it proxies authorized requests to the **Hyper-Bridge** (Port 8080) and **Ghidra Engine** (Port 8000).

---

## 🛠️ Available Tools

The server exposes the following function-calling tools to the AI:

### 1. VM Management
*   **`list_lab_vms()`**: Returns a JSON inventory of all sandboxes (Win10, Win11) and their power state.
*   **`rollback_vm(node, vmid, snapshot="GOLD_IMAGE")`**: "Nukes" a VM and restores it to the clean snapshot. Used by the AI to reset the lab after an infection.

### 2. Telemetry Access
*   **`get_vm_telemetry(limit=100)`**: Fetches the most recent kernel events (Process Create, Network Connect) from the active session. This allows the AI to "see" what happened.

### 3. Ghidra Integration
*   **`trigger_ghidra_analysis(binary_name)`**: Commands the Ghidra Docker container to ingest and analyze a new binary.
*   **`query_static_functions(binary_name)`**: Lists all functions found in the binary.
*   **`decompile_function(binary_name, address)`**: Returns the C-pseudocode for a specific memory address.

---

## ⚙️ Configuration

The MCP server is configured via environment variables in `docker-compose.yaml`:

```yaml
  mcp-server:
    environment:
      - BACKEND_URL=http://hyper-bridge:8080  # Rust Backend
      - GHIDRA_API=http://ghidra:8000         # Ghidra Headless Service
      - OLLAMA_HOST=http://192.168.50.98:11434 # Local LLM (Optional)
```

## 🚀 Usage with Gemini / Claude Desktop

To use this server with your local Gemini or Claude Desktop app for "human-in-the-loop" investigations:

1.  **Add to Config**: Edit `%APPDATA%\Claude\claude_desktop_config.json`:
    ```json
    "mcpServers": {
      "MallabInvestigator": {
        "command": "docker",
        "args": [
          "exec",
          "-i",
          "thevoodoobox-mcp-server-1",
          "python",
          "main.py"
        ]
      }
    }
    ```
2.  **Restart the App**: You will now see the tool icon available in chat.
