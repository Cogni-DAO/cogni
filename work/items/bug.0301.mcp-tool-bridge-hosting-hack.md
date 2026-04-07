---
id: bug.0301
type: bug
title: "MCP tool bridge hosting hack — extract from instrumentation.ts to proper runtime"
status: needs_triage
priority: 2
rank: 5
estimate: 3
summary: "bug.0300 starts a raw http.createServer in instrumentation.ts to host the MCP tool bridge for Codex. This works but is a hosting hack — instrumentation.ts should not be a service manager. Extract to a proper local bridge runtime owned by the app lifecycle."
outcome: "MCP tool bridge runs in a well-defined lifecycle (start/stop with the app, not piggybacked on instrumentation hook). instrumentation.ts returns to its original scope: OTel init + preflight checks."
spec_refs: [spec.tool-use]
assignees: []
credit: []
project: proj.agentic-interop
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-07
updated: 2026-04-07
labels: [ai, infra, architecture, tech-debt]
external_refs:
---

# MCP tool bridge hosting hack — extract from instrumentation.ts

## Context

bug.0300 solved the Codex tool access problem by hosting a real MCP Streamable HTTP server on a separate port (`127.0.0.1:3001`). The protocol boundary is correct — Codex calls tools via MCP, the bridge routes to `toolRunner.exec()`.

The **hosting model is a hack**: `instrumentation.ts` (a Next.js once-per-process hook meant for OTel init) starts a raw `http.createServer` and becomes a de facto service manager. Container deps are wired lazily via `setMcpDeps()` from `bootstrap/container.ts` to bridge the dep-cruiser gap.

This works for the single Codex use case but:

- `instrumentation.ts` was never meant to own process lifecycle
- If other executors need the bridge, the pattern doesn't scale
- Lazy dep wiring has a race window (requests before container init return "deps not wired")

## Requirements

### Expected

The MCP tool bridge should:

1. Start and stop with the app lifecycle (not piggybacked on instrumentation)
2. Have deps available at startup (not lazily wired after)
3. Be extractable if the bridge needs to serve more than just Codex

### Possible approaches

- **Custom server wrapper**: A `server.ts` entrypoint that creates both the Next.js app and the MCP bridge, then `CMD ["node", "server.js"]` in Docker
- **Next.js middleware + adapter**: If Next.js gains raw HTTP access in future versions
- **Standalone sidecar**: If the bridge needs to serve multiple app instances

## Validation

- `instrumentation.ts` has no `http.createServer` or `startMcpHttpServer` calls
- MCP bridge starts and stops with the main app process
- No `setMcpDeps()` lazy wiring — deps available at construction time
- All existing bug.0300 tests still pass
