---
id: task.0207
type: task
title: "Run: BYO-AI hosted OSS provider — user connects their Ollama/vLLM endpoint"
status: needs_design
priority: 3
rank: 30
estimate: 5
summary: "Users connect their own hosted LLM endpoint (Ollama, vLLM, or any OpenAI-compatible server) as a BYO-AI provider. New LlmService adapter routes completions to user's endpoint. Same graphs, same tools, different backend."
outcome: "A user with a home server running Ollama can connect it on the profile page, select any Cogni graph, and run AI using their own hosted models at $0 platform cost. No Codex, no ChatGPT subscription — just an OpenAI-compatible endpoint URL."
spec_refs: []
assignees: []
credit:
project: proj.byo-ai
branch:
pr:
reviewer:
created: 2026-03-26
updated: 2026-03-26
labels: [ai, byo-ai, oss, self-hosted]
external_refs: []
revision: 0
blocked_by: []
deploy_verified: false
---

## Design Notes

### Why This Matters

ChatGPT subscription is one BYO path. But some users run their own models — Ollama on a home server, vLLM on a GPU box, or any OpenAI-compatible endpoint. They should be able to use Cogni's graphs with their own compute.

### Architecture Fit

The `LlmService` port is already provider-agnostic. Today:

- `LiteLlmAdapter implements LlmService` — platform LLM via OpenRouter
- `CodexLlmAdapter implements LlmService` — ChatGPT subscription via codex exec

A hosted OSS adapter would be:

- `HostedOssLlmAdapter implements LlmService` — user's endpoint via standard OpenAI-compatible API

This is a straight HTTP adapter — `POST /v1/chat/completions` to the user's URL with their API key. No SDK, no subprocess, no special transport. The simplest `LlmService` implementation possible.

### Connection Model

The `ConnectionBrokerPort` resolves credentials. For hosted OSS:

- `provider: "openai-compatible"` (or `"ollama"`, `"vllm"`)
- `credentialType: "api_endpoint"`
- Credentials: `{ baseUrl: "https://user-server.example.com", apiKey?: "..." }`

The broker resolves the connection, the factory creates `HostedOssLlmAdapter` with the resolved URL/key, the graph runs unchanged.

### Security Considerations

- User's endpoint could be malicious — response validation required
- SSRF risk: user-provided URL must be validated (no localhost, no internal IPs in production)
- Latency: user's home server may be slow — needs timeout handling
- Model capability: user's model may not support tools/function calling — graceful degradation

### Prerequisite

Walk phase (task.0192) should land first — connections table, ConnectionBrokerPort with real DB adapter, profile page OAuth flow. This task adds a new provider type to that infrastructure.

### Open Questions

- Should we validate the endpoint before storing? (health check on connect)
- Model selection: does the user specify which model on their server, or do we auto-detect?
- Should we support non-OpenAI-compatible APIs (Anthropic format, etc.) or require a proxy?

## Validation

- [ ] User connects Ollama endpoint on profile page
- [ ] Any graph executes using user's hosted model
- [ ] Streaming works through user's endpoint
- [ ] Graceful error when endpoint is unreachable
- [ ] SSRF protection prevents internal IP targeting in production
