# TheVooDooBox: Testing Ollama AI Integration

## Quick Test
To verify the Ollama server is accessible and working:

```bash
# Test Ollama connectivity (Using DeepSeek-R1)
curl http://192.168.50.98:11434/api/generate -d '{
  "model": "deepseek-r1:14b",
  "prompt": "Analyze this malware behavior: A process named svchost.exe spawned cmd.exe which then created powershell.exe. Is this suspicious?",
  "stream": false
}'
```

## Expected Response
```json
{
  "model": "deepseek-r1:14b",
  "created_at": "2024-01-19T12:45:00Z",
  "response": "<think>The user is asking for an analysis of a specific process chain... svchost.exe -> cmd.exe -> powershell.exe is a classic indicator of malware trying to disguise itself...</think> Yes, this is highly suspicious...",
  "done": true
}
```

## Integration Test via Mallab UI
1. Start the Hyper-Bridge backend (already configured with `OLLAMA_URL=http://192.168.50.98:11434`)
2. Navigate to the Analysis Arena
3. Collect some process/event data
4. Click "Run AI Threat Analysis"
5. The backend will send the data to your Ollama server and display the results

## Troubleshooting

### Connection Refused
1. Start the Hyper-Bridge backend (already configured with `OLLAMA_URL=http://192.168.50.98:11434`)
2. Use the "AI Analyst" button in the Analysis Arena.

### Diagnostic Checklist
- [ ] Ping the Ollama server: `ping 192.168.50.98`
- [ ] Test the API list endpoint:
  ```bash
  curl http://192.168.50.98:11434/api/tags
  ```
- [ ] If no models appear, pull the required models:
  ```bash
  # For Forensic Triage & Chat (Recommended)
curl http://192.168.50.98:11434/api/pull -d '{"name": "deepseek-r1:14b"}'

# For Vector DB Embeddings (RAG)
curl http://192.168.50.98:11434/api/pull -d '{"name": "nomic-embed-text"}'
  ```

### Slow Response
- Ollama inference can take 5-30 seconds depending on hardware
- The UI shows a loading spinner during analysis
- Consider using a smaller model like `llama3:8b` for faster responses

## AI Performance Benchmarks
Use the following settings for the "Gold Standard" analysis experience with TheVooDooBox:

| Model | Recommended Params | Target Speed |
| :--- | :--- | :--- |
| `qwen2.5-coder:14b` | `temp: 0.05`, `ctx: 16k` | 45-90s |
| `deepseek-r1:14b` | `temp: 0.05`, `ctx: 16k` | 2-5m |
| `llama3.1:8b` | `temp: 0.0` | 15-30s |

### Testing Reasoning Modes
Reasoning models like **DeepSeek-R1** require more time to generate their `<think>` blocks. If you observe the backend timing out:
1.  Increase `AI_TIMEOUT_SECONDS` in your `.env` to `1200`.
2.  Verify `OLLAMA_FLASH_ATTENTION=1` is enabled on the Ollama host.
3.  Ensure the **PID Menu** is appearing at the top of your troubleshooting prompt to confirm factual anchoring is working.

## Alternative Models
You can change the model in `docker-compose.yaml` or `.env`:
```yaml
- OLLAMA_MODEL=deepseek-r1:14b    # Recommended Default (Reasoning)
- OLLAMA_MODEL=qwen2.5-coder:14b  # Stable local alternative
- OLLAMA_MODEL=llama3.1:8b       # General purpose alternative
- OLLAMA_MODEL=mistral           # Fast alternative
```

After changing, restart the backend:
```bash
docker-compose restart hyper-bridge
```
