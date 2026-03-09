---
id: proj.agentic-interop-handoff
type: handoff
work_item_id: proj.agentic-interop
status: active
created: 2026-02-22
updated: 2026-02-22
branch: worktree-spike-mcp-client
last_commit: 88c39c96
---

# Handoff: MCP Client Spike (proj.agentic-interop P0)

## Context

- **Goal**: Give Cogni's LangGraph agents the ability to call external MCP (Model Context Protocol) servers — making them consumers of the emerging agentic internet.
- Research doc at `docs/research/agentic-internet-gap-analysis.md` catalogs the Feb 2026 industry landscape (MCP, A2A, x402, NIST standards) and maps gaps against our existing projects.
- New project `work/projects/proj.agentic-interop.md` coordinates MCP server, agent identity, and A2A discovery across existing project boundaries.
- This spike (Path A) wires `@langchain/mcp-adapters` directly into the LangGraph graph runner, bypassing our ToolRunner pipeline. It proves the integration works before the proper Path B implementation (`McpToolSource` implementing `ToolSourcePort`).
- x402 payment protocol is deliberately excluded — it doesn't support streaming token billing (our primary cost center).

## Current State

- **Done**: Research doc committed (`88c39c96`), project file committed, `.gitignore` updated for `.claude/worktrees/`.
- **In progress**: MCP client spike in worktree `.claude/worktrees/spike-mcp-client` — ~70% complete, typechecks clean, not yet tested end-to-end.
- **What exists in worktree** (all uncommitted):
  - `packages/langgraph-graphs/src/runtime/mcp/` — `types.ts` (config shapes), `client.ts` (MCP client wrapper using `@langchain/mcp-adapters`), `index.ts` (barrel)
  - `InProcRunnerOptions.extraTools` — optional extra LangChain tools merged alongside contract-derived tools in `runner.ts`
  - `LangGraphInProcProvider` — accepts optional `mcpTools: readonly unknown[]` (opaque array to preserve `NO_LANGCHAIN_IN_SRC`)
  - `LazyMcpLangGraphProvider` — wraps provider construction behind async MCP tool loading (same pattern as `LazySandboxGraphProvider`)
  - `graph-executor.factory.ts` — `getMcpTools()` singleton loads from `MCP_SERVERS` env (JSON) or `MCP_CONFIG_PATH` (`.mcp.json` format)
  - Test stub at `packages/langgraph-graphs/tests/inproc/mcp-extra-tools.test.ts`
- **Not done**: Test execution, end-to-end validation with a real MCP server, reconnect/error handling, any production guardrails.
- **Not done**: MCP server (exposing our tools outward) — that's separate P0 work in `proj.agentic-interop`.

## Decisions Made

- **Path A (spike) vs Path B (proper)**: Spike bypasses `ToolRunner` — no policy, billing, or redaction for MCP tools. Path B (`McpToolSource implements ToolSourcePort`) is the production path, tracked in `proj.agentic-interop` P1.
- **`@langchain/mcp-adapters` v1.1.3**: Chosen because it wraps MCP servers as `DynamicStructuredTool` — exactly what `createReactAgent` consumes. Supports stdio, SSE, and streamable HTTP transports.
- **Config via env**: `MCP_SERVERS` (raw JSON) or `MCP_CONFIG_PATH` (path to `.mcp.json` file). Supports the same format Claude Code uses (`.mcp.json`).
- **`NO_LANGCHAIN_IN_SRC` preserved**: MCP tools are `unknown[]` in the provider (src/), cast to `StructuredToolInterface[]` in the package runner.
- **Lazy loading pattern**: MCP tools load async on first use; `LazyMcpLangGraphProvider` follows the same pattern as `LazySandboxGraphProvider`.

## Next Actions

- [ ] Run the test file: `pnpm -F @cogni/langgraph-graphs test -- mcp-extra-tools`
- [ ] Fix any test failures (test was written but never executed)
- [ ] Test end-to-end with a real MCP server (e.g., `@modelcontextprotocol/server-fetch` via stdio, or the Grafana MCP server we already configure in `.mcp.json`)
- [ ] Add logging: log every MCP tool call (tool name, args hash, duration) for auditability
- [ ] Validate reconnect behavior: kill MCP server → agent retries → reconnect without process restart
- [ ] Commit the spike to the worktree branch
- [ ] Open a draft PR for review (spike — not for merge to staging without Path B follow-up)
- [ ] Create `task.*` work item under `proj.agentic-interop` for Path B: `McpToolSource implements ToolSourcePort`

## Risks / Gotchas

- **MCP tools bypass ToolRunner**: No policy enforcement, no billing capture, no redaction. This is by design for the spike but must NOT ship to production without Path B.
- **`@langchain/mcp-adapters` lifecycle**: The `MultiServerMCPClient` is never explicitly `close()`d — tools need active connections. For stdio servers this means orphaned child processes on server shutdown. Production needs explicit lifecycle management.
- **Zod version mismatch**: MCP SDK v2 requires Zod v4; our repo uses Zod v3. Stick with `@modelcontextprotocol/sdk` v1.x until Zod v4 migration.
- **`pnpm-lock.yaml` changes**: The dep install added 253 lines to the lockfile — review for unexpected transitive deps.
- **Worktree is gitignored**: `.claude/worktrees/` is in `.gitignore`. The worktree branch `worktree-spike-mcp-client` exists in git but the directory won't be tracked.

## Pointers

| File / Resource                                                  | Why it matters                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `docs/research/agentic-internet-gap-analysis.md`                 | Industry landscape + gap analysis driving this work                                       |
| `work/projects/proj.agentic-interop.md`                          | Project roadmap: P0 MCP server, P1 agent cards + MCP client, P2 cross-agent delegation    |
| `packages/langgraph-graphs/src/runtime/mcp/client.ts`            | MCP client wrapper — `loadMcpTools()` and `parseMcpConfigFromEnv()`                       |
| `packages/langgraph-graphs/src/inproc/runner.ts`                 | Runner merge point — `extraTools` concatenated with contract tools (line ~123)            |
| `src/adapters/server/ai/langgraph/inproc.provider.ts`            | Provider accepts `mcpTools: readonly unknown[]` in constructor                            |
| `src/bootstrap/graph-executor.factory.ts`                        | `LazyMcpLangGraphProvider` + `getMcpTools()` singleton                                    |
| `packages/langgraph-graphs/tests/inproc/mcp-extra-tools.test.ts` | Test stub (not yet executed)                                                              |
| `work/projects/proj.tool-use-evolution.md`                       | Existing project — MCP was scoped as P2, now partially subsumed by `proj.agentic-interop` |
| `src/mcp/server.stub.ts`                                         | MCP server stub (separate from client spike — P0 of `proj.agentic-interop`)               |
