---
id: guide-connect-local-llm
type: guide
title: Connect a Local LLM Server
status: active
trust: reviewed
summary: "Set up llama-server or vLLM with API key auth, expose via Cloudflare Tunnel, and connect to Cogni."
read_when: "A user wants to connect their own LLM server to Cogni."
owner: derekg1729
created: 2026-03-27
verified: 2026-03-27
---

# Connect a Local LLM Server

Run your own AI models on your hardware and connect them to Cogni.

## Requirements

- A machine with a GPU (or fast CPU)
- [llama.cpp](https://github.com/ggml-org/llama.cpp) installed (`brew install llama.cpp` on macOS)
- A GGUF model file (download from [HuggingFace](https://huggingface.co/models?sort=trending&search=gguf))
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for remote access (`brew install cloudflared`)

## Recommended Models

Cogni graphs use system prompts and may invoke tools (function calling). Smaller models struggle with instruction following and tool use. Recommended minimums:

| Use case                  | Minimum size | Recommended models                                     |
| ------------------------- | ------------ | ------------------------------------------------------ |
| Basic chat (no tools)     | 3B+          | `llama3.2:3b`, `mistral:7b`                            |
| Chat with tools           | 8B+          | `llama3.1:8b`, `mistral-nemo:12b`, `qwen2.5:7b`        |
| Complex reasoning + tools | 14B+         | `llama3.1:70b`, `qwen2.5:32b`, `deepseek-coder-v2:16b` |

**Models under 3B (e.g. tinyllama) are not recommended.** They ignore system prompts and produce incoherent output.

**Models under 8B may loop on tool calls.** They technically support function calling but call tools repeatedly instead of responding. If you see tool call loops, use a larger model or switch to a graph without tools.

## Step 1: Start llama-server with API key

```bash
llama-server \
  --model /path/to/your-model.gguf \
  --api-key "sk-your-secret-key" \
  --host 0.0.0.0 \
  --port 8080 \
  --ctx-size 4096
```

This starts an OpenAI-compatible server at `http://localhost:8080` with bearer token auth.

**Verify it works:**

```bash
# Should return 401 (no key)
curl http://localhost:8080/v1/chat/completions

# Should return models list
curl -H "Authorization: Bearer sk-your-secret-key" http://localhost:8080/v1/models
```

## Step 2: Expose with Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:8080 --http-host-header="localhost:8080"
```

This prints a public URL like `https://random-words.trycloudflare.com`. Your server is now accessible from anywhere with TLS encryption.

## Step 3: Connect in Cogni

1. Go to **Profile → AI Providers → Local LLM → Connect**
2. Enter your Cloudflare Tunnel URL
3. Enter the API key you set in Step 1
4. Click **Test & Connect**

Your models appear in the model picker under the **Local** tab.

## Supported Servers

Any server that exposes `/v1/chat/completions` works:

| Server                       | Install                            | API Key Flag                           |
| ---------------------------- | ---------------------------------- | -------------------------------------- |
| **llama-server** (llama.cpp) | `brew install llama.cpp`           | `--api-key <key>`                      |
| **vLLM**                     | `pip install vllm`                 | `--api-key <key>`                      |
| **Ollama**                   | [ollama.com](https://ollama.com)   | No built-in auth (needs reverse proxy) |
| **LM Studio**                | [lmstudio.ai](https://lmstudio.ai) | Settings → API Key                     |

## Troubleshooting

- **"No models found"** — Check that your server is running and the URL is correct
- **"Endpoint returned 401"** — API key mismatch between server and Cogni profile
- **"Cannot reach endpoint"** — Cloudflare Tunnel may have disconnected; restart `cloudflared`
- **Tool call loops** — Model is too small for function calling. Use 8B+ or switch to a simpler graph
- **Incoherent output** — Model is too small for instruction following. Use 3B+ minimum
- **Slow responses** — Local inference depends on your hardware; GPU recommended
