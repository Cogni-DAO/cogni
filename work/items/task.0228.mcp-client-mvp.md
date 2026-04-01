---
id: task.0228
type: task
status: needs_merge
priority: 1
rank: 1
title: "MCP Client MVP — McpToolSource + Playwright browser agent"
summary: Replace extraTools MCP bypass with McpToolSource implementing ToolSourcePort so MCP tools flow through standard toolRunner pipeline
outcome: Agents use external MCP tools (Playwright, Grafana) via standard policy/billing/redaction pipeline; dev can chat with browser-enabled agent
project: proj.agentic-interop
branch: feat/mcp-client-mvp
pr: https://github.com/Cogni-DAO/node-template/pull/657
created: 2026-03-28
updated: 2026-03-29
assignees:
  - cogni-dev
labels:
  - ai-graphs
  - tooling
  - mcp
estimate: 3
---

# MCP Client MVP — McpToolSource + Playwright browser agent

## Design

### Outcome

Agents can use external MCP tools (Playwright browser, Grafana) through the standard ToolRunner pipeline with policy, billing validation, and redaction — not via a bypass. Locally, a developer can chat with an agent that has browser access.

### Approach

**Solution:** Create `McpToolSource` implementing `ToolSourcePort`. MCP tools become first-class `BoundToolRuntime` entries — same policy, same billing validation, same redaction as native tools. Per-graph MCP server assignment via catalog `mcpServers` field.

**Reuses:**

- `ToolSourcePort` / `BoundToolRuntime` — existing tool abstraction (ai-core)
- `toolRunner.exec()` — existing 10-step pipeline (policy → validate → exec → redact)
- `createToolAllowlistPolicy()` — existing deny-by-default policy
- `parseMcpConfigFromEnv()` / `loadMcpTools()` — from spike (already ported)
- `@langchain/mcp-adapters` — existing dep for MCP → LangChain tool bridge
- `LANGGRAPH_CATALOG` — existing graph registration pattern

**Rejected alternatives:**

1. **extraTools bypass (current spike):** Skips policy, billing, redaction. Violates TOOLS_VIA_TOOLRUNNER. Good for proving connectivity, wrong for production.
2. **ToolHive operator for MVP:** Correct for k8s production, over-engineered for local dev. Phase 1 (post-MVP).
3. **Custom MCP gateway:** ToolHive vMCP exists. Don't build this.

### Architecture

```
config/mcp.servers.json
    ↓ parseMcpConfigFromEnv()
    ↓ loadMcpTools() → StructuredToolInterface[]
    ↓
McpToolSource (implements ToolSourcePort)
    ↓ getBoundTool("mcp__playwright__browser_navigate")
    ↓ returns McpBoundToolRuntime
    ↓
toolRunner.exec()  ← standard 10-step pipeline
    ↓ policy check (allowlist from catalog mcpServerIds)
    ↓ validate input (JSON Schema → Zod)
    ↓ execute (delegates to MCP StructuredToolInterface.invoke())
    ↓ validate + redact output
    ↓
LangGraph agent gets result
```

**Key design decisions:**

1. **MCP tools get `mcp__` prefix:** `mcp__playwright__browser_navigate`. Server name + tool name, matching `@langchain/mcp-adapters` prefixToolNameWithServerName.

2. **McpToolSource wraps StructuredToolInterface → BoundToolRuntime:** Each MCP tool becomes a `BoundToolRuntime` with:
   - `id`: `mcp__{serverName}__{toolName}`
   - `spec`: mapped from MCP tool's JSON Schema
   - `effect`: `external` (all MCP tools are external I/O by default)
   - `exec()`: delegates to the underlying LangChain StructuredToolInterface
   - `validateInput()`: uses JSON Schema from MCP tool
   - `redact()`: passthrough (MCP tools control their own output)

3. **Per-graph MCP server assignment:** Catalog entries declare `mcpServerIds`:

   ```typescript
   // in catalog.ts
   [BROWSER_GRAPH_NAME]: {
     displayName: "Browser Agent",
     toolIds: [],  // no native tools
     mcpServerIds: ["playwright"],  // MCP servers this graph can use
     graphFactory: createBrowserGraph,
   }
   ```

4. **Composite ToolSource in bootstrap:** `AggregatingToolSource` combines native `ToolSourcePort` + `McpToolSource`. Provider passes correct combined source per graph.

5. **Remove extraTools bypass:** Once McpToolSource works, delete the `extraTools` parameter from runner/types. MCP tools flow through the same path as native tools.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] TOOLS_VIA_TOOLRUNNER: MCP tools execute through toolRunner.exec(), not direct invocation
- [ ] DENY_BY_DEFAULT: MCP tools require explicit allowlist via catalog mcpServerIds
- [ ] MCP_UNTRUSTED_BY_DEFAULT: MCP tools not auto-enabled; graph must declare mcpServerIds
- [ ] NO_LANGCHAIN_IN_SRC: McpToolSource lives in packages/langgraph-graphs, not apps/operator/src
- [ ] SINGLE_AUTH_PATH: MCP server credentials via env/config (Phase 0); same ConnectionBrokerPort pattern later
- [ ] TOOL_ID_NAMESPACED: MCP tools prefixed mcp**{server}**{tool} to prevent collisions

### Files

**Create:**

- `packages/langgraph-graphs/src/runtime/mcp/tool-source.ts` — McpToolSource implementing ToolSourcePort
- `packages/langgraph-graphs/src/runtime/mcp/bound-tool.ts` — McpBoundToolRuntime adapter
- `packages/langgraph-graphs/src/graphs/browser/graph.ts` — Browser agent graph factory
- `packages/langgraph-graphs/src/graphs/browser/tools.ts` — Browser graph MCP server IDs
- `packages/langgraph-graphs/tests/inproc/mcp-tool-source.test.ts` — McpToolSource unit tests

**Modify:**

- `packages/langgraph-graphs/src/catalog.ts` — Add mcpServerIds field, browser graph entry
- `packages/langgraph-graphs/src/inproc/types.ts` — Remove extraTools (replaced by McpToolSource)
- `packages/langgraph-graphs/src/inproc/runner.ts` — Remove extraTools merge logic
- `apps/operator/src/adapters/server/ai/langgraph/inproc.provider.ts` — Use composite ToolSource (native + MCP)
- `apps/operator/src/bootstrap/graph-executor.factory.ts` — Wire McpToolSource into composite source, remove LazyMcpLangGraphProvider
- `config/mcp.servers.json` — Playwright already added

**Test:**

- Unit: McpToolSource.getBoundTool() returns valid BoundToolRuntime
- Unit: McpBoundToolRuntime.exec() delegates to StructuredToolInterface
- Unit: Policy denies MCP tools not in graph's mcpServerIds
- Integration: Playwright MCP loads tools, browser_navigate works end-to-end

### Production Roadmap (post-MVP)

| Phase                   | What                                      | Auth Model                                 |
| ----------------------- | ----------------------------------------- | ------------------------------------------ |
| **Phase 0 (this task)** | Shared MCP servers via config file        | Static tokens in env vars                  |
| **Phase 1**             | ToolHive operator + MCPServer CRDs on k3s | Service tokens via k8s secretKeyRef        |
| **Phase 2**             | vMCP gateway + OIDC                       | Per-tenant namespaces, OIDC incoming auth  |
| **Phase 3**             | BYO-credential flow                       | User OAuth via ConnectionBrokerPort + vMCP |

Phase 0 is the MVP. Phases 1-3 are tracked in proj.agentic-interop.

### Research References

- [MCP Production Deployment Patterns](../../docs/research/mcp-production-deployment-patterns.md) — Auth spec, ToolHive, k8s patterns
- [ToolHive vMCP](https://docs.stacklok.com/toolhive/) — Production gateway for Phase 1+
- [MCP Auth Spec (Nov 2025)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) — OAuth 2.1 resource server model

## Validation

- [x] McpToolSource.getBoundTool() returns BoundToolRuntime for loaded MCP tools
- [x] toolRunner.exec() successfully executes an MCP tool through the full pipeline
- [ ] Policy denies MCP tools not declared in graph's mcpServerIds
- [x] Playwright MCP loads and browser_navigate tool works end-to-end
- [x] extraTools bypass removed from runner/types
- [x] `pnpm check:fast` passes

### Experiment: 2026-03-29 — MCP as Docker network service (Streamable HTTP)

**Result: SUCCESS.** Browser agent navigated to cognidao.org and reported page contents via
Playwright MCP tools (22 tools loaded). Full pipeline verified: Docker Compose service
(`mcr.microsoft.com/playwright/mcp` on port 3003) → Streamable HTTP `/mcp` endpoint →
`@langchain/mcp-adapters` MultiServerMCPClient → McpToolSource → toolRunner.exec() → LangGraph agent.

Screenshot tool failed (expected — no storage mechanism configured), but navigation + snapshot +
form interaction tools all work through the standard tool pipeline with policy enforcement.

Key changes in this commit:

- Playwright MCP: stdio subprocess → Docker Compose service (Streamable HTTP)
- MCP connection: forever singleton → McpConnectionCache (reconnect-on-error + TTL backstop)
- InProcProvider: static mcpToolSource → async getMcpToolSource() function
- Architecture spec: docs/spec/mcp-control-plane.md (Phase 1 DB registry + Temporal preflight)
