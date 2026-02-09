# Testing Your Local AI (Llama.cpp)

This guide helps you verify that your local Llama Server is correctly configured and reachable by the VoodooBox backend.

## 1. Prerequisites

- You have downloaded a GGUF model (e.g., `DeepSeek-R1-Distill-Llama-8B.Q4_K_M.gguf`).
- You have the `llama-server` binary (from `llama.cpp` release).

## 2. Launching the Server

Start the server with a context window of at least 8192 tokens:

```bash
./llama-server -m models/deepseek-r1.gguf -c 8192 --host 0.0.0.0 --port 8080 --n-gpu-layers 35
```

- `--host 0.0.0.0`: Essential for Docker connectivity.
- `--n-gpu-layers 35`: Offloads layers to GPU (adjust based on VRAM).

## 3. Verifying Connectivity (Curl)

Run this command from your host machine to test basic completion:

```bash
curl http://localhost:8080/completion \
-H "Content-Type: application/json" \
-d '{"prompt": "Building a website can be done in 10 simple steps:", "n_predict": 128}'
```

**Expected Output**: A JSON response containing `"content": "Step 1: ..."`

## 4. Troubleshooting

### "Connection Refused"
- Ensure `llama-server` is running on `0.0.0.0`, not `127.0.0.1`.
- Check if port 8080 is blocked by firewall or another service.

### "Out of Memory" (OOM)
- Reduce `--n-gpu-layers`.
- Reduce context window (`-c 4096`).
- Use a smaller quant (e.g., `Q4_K_M` instead of `Q8`).

### Backend Can't Connect
- If running Backend in Docker, ensure `.env` uses `http://host.docker.internal:8080`.
