# TheVooDooBox: Testing Ollama AI Integration

## Quick Test
To verify the Ollama server is accessible and working:

```bash
# Test Ollama connectivity
curl http://192.168.50.98:11434/api/generate -d '{
  "model": "qwen2.5-coder:14b",
  "prompt": "Analyze this malware behavior: A process named svchost.exe spawned cmd.exe which then created powershell.exe. Is this suspicious?",
  "stream": false
}'
```

## Expected Response
```json
{
  "model": "qwen2.5-coder:14b",
  "created_at": "2024-01-19T12:45:00Z",
  "response": "Yes, this is highly suspicious. The behavior chain svchost.exe -> cmd.exe -> powershell.exe is a common indicator of malware activity...",
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
  # For Forensic Triage & Chat
  curl http://192.168.50.98:11434/api/pull -d '{"name": "qwen2.5-coder:14b"}'
  
  # For Vector DB Embeddings (RAG)
  curl http://192.168.50.98:11434/api/pull -d '{"name": "nomic-embed-text"}'
  ```

### Slow Response
- Ollama inference can take 5-30 seconds depending on hardware
- The UI shows a loading spinner during analysis
- Consider using a smaller model like `llama3:8b` for faster responses

## Alternative Models
You can change the model in `docker-compose.yaml` or `.env`:
```yaml
- OLLAMA_MODEL=qwen2.5-coder:14b  # Recommended Default
- OLLAMA_MODEL=qwen2.5-coder:7b   # Faster, less capable
- OLLAMA_MODEL=llama3.1:8b       # General purpose alternative
- OLLAMA_MODEL=mistral           # Fast alternative
```

After changing, restart the backend:
```bash
docker-compose restart hyper-bridge
```
