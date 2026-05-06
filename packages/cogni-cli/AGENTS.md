# cogni-cli · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @cogni-dao
- **Status:** prototype

## Purpose

The `cogni` developer CLI. v0 ships exactly one subcommand: `cogni dev`, which detects whether `claude` (Claude Code) and `codex` (OpenAI Codex CLI) are installed on the user's device, opens a small local HTTP server that can shell out to either, exposes that server publicly via a Cloudflare quick tunnel, and opens the user's default browser to the operator's `/runtimes/dev` page with the tunnel URL passed as a query string. Pattern lifted from `langgraph dev --tunnel` ↔ `smith.langchain.com/studio`.

The CLI never holds Anthropic / OpenAI credentials; it just shells out to whatever the user is already authenticated against locally.

## Pointers

- [BYO Agent Runtime Bridge research](../../docs/research/byo-agent-runtime-bridge.md): the design this implements
- [Packages Architecture](../../docs/spec/packages-architecture.md): package conventions

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["node:*"]
}
```

The CLI is dependency-free at runtime — only Node builtins + spawned subprocesses (`claude`, `codex`, `cloudflared`).

## Non-goals (v0)

- No DB persistence (the operator never sees the tunnel; only the browser does).
- No always-on bridge / no operator-side socket gateway.
- No live token streaming (uses `claude --print` / `codex exec` batch mode; chunked stdout, not token-by-token).
- No Codex Channels equivalent — Codex degrades gracefully to "completed-artifact" UX.
