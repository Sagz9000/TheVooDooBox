# TheVooDooBox: Testing Ollama AI Integration

## Quick Test
To verify the Ollama server is accessible and working:

```bash
# Test Ollama connectivity
curl http://192.168.1.101:11434/api/generate -d '{
  "model": "llama3",
  "prompt": "Analyze this malware behavior: A process named svchost.exe spawned cmd.exe which then created powershell.exe. Is this suspicious?",
  "stream": false
}'
```

## Expected Response
```json
{
  "model": "llama3",
  "created_at": "2024-01-19T12:45:00Z",
  "response": "Yes, this is highly suspicious. The behavior chain svchost.exe -> cmd.exe -> powershell.exe is a common indicator of malware activity...",
  "done": true
}
```

## Integration Test via Mallab UI
1. Start the Hyper-Bridge backend (already configured with `OLLAMA_URL=http://192.168.1.101:11434`)
2. Navigate to the Analysis Arena
3. Collect some process/event data
4. Click "Run AI Threat Analysis"
5. The backend will send the data to your Ollama server and display the results

## Troubleshooting

### Connection Refused
1. Start the Hyper-Bridge backend (already configured with `OLLAMA_URL=http://192.168.1.101:11434`)
2. Use the "AI Analyst" button in the Analysis Arena.

### Diagnostic Checklist
- [ ] Ping the Ollama server: `ping 192.168.1.101`
- [ ] Test the API list endpoint:
  ```bash
  curl http://192.168.1.101:11434/api/tags
  ```
- [ ] If no models appear, pull the required models:
  ```bash
  # For Forensic Triage & Chat
  curl http://192.168.1.101:11434/api/pull -d '{"name": "qwen2.5-coder:14b"}'
  
  # For Vector DB Embeddings (RAG)
  curl http://192.168.1.101:11434/api/pull -d '{"name": "nomic-embed-text:v1.5"}'
  ```

### Slow Response
- Ollama inference can take 5-30 seconds depending on hardware
- The UI shows a loading spinner during analysis
- Consider using a smaller model like `llama3:8b` for faster responses

## Alternative Models
You can change the model in `docker-compose.yaml`:
```yaml
- OLLAMA_MODEL=llama3        # Default (7B parameters)
- OLLAMA_MODEL=llama3:13b    # Larger, more accurate
- OLLAMA_MODEL=mistral       # Faster alternative
- OLLAMA_MODEL=codellama     # Code-focused
```

After changing, restart the backend:
```bash
docker-compose restart hyper-bridge
```
