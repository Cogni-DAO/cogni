# Handoff: MCP Tool Bridge for Codex Executor

**Branch:** `bug/0300-codex-core-tool-bridge`
**PR:** https://github.com/Cogni-DAO/node-template/pull/805
**Date:** 2026-04-07
**Status:** Infrastructure working, auth propagation needs debugging
**Last commit:** `05c116ac1` — wire runContext through createLlmService + port 1729

---

## Goal

Give Codex executor (ChatGPT backend) access to the same 11 core\_\_ tools as the Cogni executor (VCS, schedule, work-item, repo). Currently all tools are silently dropped — agent is lobotomized.

## What Was Built

Internal MCP Streamable HTTP server that bridges core\_\_ tools to Codex:

| Component        | File                                     | Purpose                                                                                                    |
| ---------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| MCP bridge       | `adapters/server/mcp/tool-bridge.ts`     | `http.createServer` on `127.0.0.1:1729/mcp`, real `StreamableHTTPServerTransport`, per-session `McpServer` |
| Token store      | `adapters/server/mcp/run-scope-store.ts` | Ephemeral per-run bearer token (UUID, TTL 30min, in-memory Map)                                            |
| Config injection | `codex-mcp-config.ts`                    | `withInternalToolBridge()` adds `cogni_tools` to Codex `config.toml`                                       |
| Adapter changes  | `codex-llm.adapter.ts`                   | Token gen pre-spawn, cleanup in finally, fail-closed check                                                 |
| Port extension   | `model-provider.port.ts`                 | Optional `runContext` param on `createLlmService()`                                                        |
| Bootstrap wiring | `container.ts`                           | Starts bridge at container init, extracts Zod schemas from `TOOL_CATALOG`                                  |
| Factory wiring   | `graph-executor.factory.ts`              | Threads `runId/userId/graphId/toolIds` to `createLlmService()`                                             |
| Spec update      | `docs/spec/tool-use.md`                  | Invariant #1 rewritten — generic boundary adapter language                                                 |

## What Works (verified locally)

- Bridge starts: `[mcp-tool-bridge] listening on 127.0.0.1:1729/mcp (18 tools)` ✅
- Config.toml written correctly: `url = "http://localhost:1729/mcp"`, `bearer_token_env_var = "COGNI_MCP_TOKEN"` ✅
- Codex connects: 152K prompt tokens, 55s execution, many `item.started`/`item.completed` events ✅
- CI: all 5 jobs green (static, unit, component, stack-test, sonar) on commit `5f9f62a` ✅
- Arch check: 0 new violations ✅
- Fail-closed: throws when bridge absent + tools needed ✅

## What's Left — ONE ISSUE

### Auth/scope resolution in tool callbacks

Codex connects to the MCP bridge but **tools are not being called**. Zero `[mcp-tool-bridge]` request logs during execution. The agent responds with text saying "core\_\_vcs tools are not available" instead of calling them.

**Hypothesis:** `tools/list` returns empty or the tool calls fail auth, because `extra.authInfo.extra.runScope` is not propagating through the `StreamableHTTPServerTransport`.

**Where to look:**

1. `tool-bridge.ts:89` — Add request logging at top of HTTP handler:

   ```typescript
   logInfo(
     JSON.stringify({
       method: req.method,
       url: req.url,
       hasAuth: !!req.headers.authorization,
     })
   );
   ```

   This tells you if Codex sends ANY requests to port 1729.

2. `tool-bridge.ts:119` — `req.auth` is set here. Verify the SDK actually reads it and propagates to `extra.authInfo`.

3. `tool-bridge.ts:199-200` — `extra.authInfo?.extra?.runScope as RunScope`. If this is undefined, tools can't resolve scope.

4. `tool-bridge.ts:176` — `createMcpServerForScope(scope)` registers tools at session creation. `tools/list` should work regardless of authInfo since tools are already registered. If `tools/list` works but `tools/call` fails, it's the authInfo path. If `tools/list` returns empty, it's the scope filtering.

**Most likely root cause:** Codex might be making `tools/list` calls that succeed (it sees tools in its session) but when it tries `tools/call`, the `extra.authInfo` is empty because the transport doesn't propagate `req.auth` the way we expect. Or Codex sees the tools but decides not to call them (prompt/model behavior — less likely given 152K tokens of execution).

## Debug Aids In Code (remove before merge)

- `codex-llm.adapter.ts` — `callLog.info({ eventType, eventKeys }, ...)` on every Codex event
- `codex-llm.adapter.ts` — `callLog.info({ configToml }, ...)` logging full config.toml content

## Follow-up Bugs

- **bug.0301** — Extract MCP bridge from `bootstrap/container.ts` to proper runtime (hosting hack)

## Local Testing

```bash
git checkout bug/0300-codex-core-tool-bridge
pnpm install --frozen-lockfile
pnpm dev:stack  # or pnpm dev if infra already running
# Watch for: [mcp-tool-bridge] listening on 127.0.0.1:1729/mcp (18 tools)
# Open localhost:3000, connect Codex, select git-manager graph
# Ask "list open PRs" — check if bridge logs show requests
```

## Key Design Decisions

1. **`adapters/server/mcp/` not `src/mcp/`** — bridge is a transport adapter, not a delivery layer
2. **Bearer token for auth, MCP session ID for protocol** — separate concerns
3. **`ToolSourcePort` for execution, `TOOL_CATALOG` for Zod schemas** — no executable catalog in adapter
4. **Per-session McpServer** — avoids reconnect-on-singleton problem
5. **Port 1729** — avoids Temporal UI conflict on 3001
6. **Fail-closed** — throws when bridge absent + tools needed (never silently drop)
