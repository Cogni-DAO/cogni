---
id: bug.0300
type: bug
title: "Codex executor silently drops all core__ tools — BYO-AI agents have no VCS/schedule/work-item capabilities"
status: needs_implement
priority: 0
rank: 1
estimate: 5
summary: "CodexLlmAdapter strips all LangGraph tools (line 92-104) because Codex SDK only supports MCP for external tools. Graphs like git-manager ship with 11 core__ tools but Codex users get zero. Fix: implement existing mcp/server.stub.ts as internal MCP endpoint delegating to toolRunner.exec()."
outcome: "Any graph running on any executor (Cogni or Codex) has access to the same core__ tools. Codex reaches them via MCP; Cogni reaches them via toolRunner.exec(). One tool plane, multiple transports."
spec_refs: [architecture-spec, packages-architecture-spec]
assignees: []
credit: []
project: proj.cicd-services-gitops
branch: bug/0300-codex-core-tool-bridge
pr: 805
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-06
updated: 2026-04-06
labels: [ai, infra, p0, architecture]
external_refs:
---

# Codex executor silently drops all core__ tools

## Observed

When a user selects ChatGPT/Codex as their AI backend and runs the `git-manager` graph:

1. Graph defines 11 tools via `GIT_MANAGER_TOOL_IDS` (VCS, schedule, work-item, repo)
2. `makeCogniGraph` resolves all 11 from `TOOL_CATALOG` — no errors
3. `CodexLlmAdapter.completionStream()` receives `params.tools` with all 11
4. **Line 92-104: adapter logs `INVARIANT_DEVIATION` warning and STRIPS ALL TOOLS**
5. Codex subprocess runs with only external MCP servers (grafana, playwright)
6. Agent responds "I only have local terminal tooling" — no VCS, no scheduling, no work items

**This is not a bug in the adapter** — Codex SDK genuinely cannot consume OpenAI function-calling format tools. Its external tool path is MCP via `config.toml`. The bug is architectural: we have no bridge between our internal tool plane and the MCP transport Codex requires.

### Evidence

- Canary logs 2026-04-06 ~21:07 UTC: `langgraph:git-manager` graph executed (12.2s), zero `core__vcs` tool calls
- Agent chat response: "For this session, I only have local terminal tooling, not the GitHub App core__* APIs"
- Same graph on 4o-mini (Cogni executor) has full tool access

### Impact

- **All BYO-AI (Codex) users** lose access to core__ tools on every graph
- git-manager, pr-review, brain — any graph with tools is degraded on Codex
- Users see a working chat interface but the agent is lobotomized

## Root Cause

`CodexLlmAdapter` (`nodes/operator/app/src/adapters/server/ai/codex/codex-llm.adapter.ts`) implements `LlmService` by spawning a Codex subprocess. Codex SDK's only external tool integration is MCP servers declared in `config.toml`. The adapter correctly identifies this mismatch (line 92-104) but has no bridge to expose core__ tools over MCP.

### Architecture Gap

```
Cogni Executor (works):
  graph.ts → TOOL_CATALOG → toolRunner.exec() via ALS → tool result

Codex Executor (broken):
  graph.ts → TOOL_CATALOG → params.tools → CodexLlmAdapter → STRIPPED
  config.toml → external MCP only (grafana, playwright) → no core__ tools
```

## Design

### Outcome

Codex-backed graph executions have access to the same core__ tools as Cogni executor. Users on ChatGPT backend can use git-manager, pr-review, brain, and any graph with tools — no degradation vs 4o-mini.

### Approach

**Solution**: Implement the existing `mcp/server.stub.ts` as a Streamable HTTP MCP endpoint using `@modelcontextprotocol/sdk` (already a dependency). The MCP server reads tools from `TOOL_CATALOG`, delegates execution to `toolRunner.exec()`, and runs as an in-process Next.js API route. Codex `config.toml` points to this localhost endpoint.

**Reuses**:
- `TOOL_CATALOG` from `@cogni/ai-tools` — canonical tool registry, zero duplication
- `ToolSourcePort` / `BoundToolRuntime` — existing tool execution abstractions
- `createToolRunner()` from `@cogni/ai-core` — existing execution pipeline with policy, validation, redaction, spans
- `@modelcontextprotocol/sdk` — already in lockfile (v1.28.0)
- `mcp/server.stub.ts` — existing placeholder in every node app, ready to implement
- `codex-mcp-config.ts` — existing config.toml generator, just needs one more entry

**Rejected**:
- **New `packages/mcp-server` package**: Violates PURE_LIBRARY invariant — MCP server needs process lifecycle (HTTP listener), env vars (port, auth tokens), and DI container access (ToolRunner, policy, capabilities). Per packages-architecture spec, this is runtime wiring, not a pure library. Belongs in `nodes/*/app/src/mcp/`.
- **Sidecar process**: Adds IPC complexity for zero benefit. Same-deployment HTTP is simpler and has full access to ALS context.
- **Standalone k8s service**: Premature. Auth/context forwarding becomes the hard problem. Keep it local.
- **"MCP everything" internally**: MCP is an edge transport, not an internal abstraction. `ai-tools` stays protocol-agnostic.

### Architecture

```
Codex Executor (fixed):
  Codex subprocess
    → config.toml: [mcp_servers.cogni_tools] url = "http://localhost:3000/api/internal/mcp"
    → MCP tool_call("core__vcs_list_prs", {state: "open"})
    → Next.js API route /api/internal/mcp
    → reconstruct ExecutionScope from signed request context (runId, userId, graphId)
    → createToolRunner(toolSource, emit, {policy, ctx})
    → toolRunner.exec("core__vcs_list_prs", args)
    → same validation → policy → execution → redaction pipeline
    → MCP tool_result back to Codex
```

**Context boundary**: Codex subprocess cannot share ALS with the host process. The MCP endpoint reconstructs ExecutionScope from request headers:
- `X-Cogni-Run-Id` — graph run correlation
- `X-Cogni-User-Id` — for policy/capability resolution
- `X-Cogni-Graph-Id` — for tool allowlist scoping
- Auth: internal-only endpoint, same trust boundary (localhost)

**Tool auto-discovery**: MCP `tools/list` reads `TOOL_CATALOG` at request time. New tools added to the catalog are automatically exposed. Zero per-tool MCP wiring.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] TOOL_CATALOG_IS_CANONICAL: MCP server reads from TOOL_CATALOG, never defines its own tools
- [ ] GRAPHS_USE_TOOLRUNNER_ONLY: MCP handler delegates to toolRunner.exec(), never calls tool implementations directly
- [ ] DENY_BY_DEFAULT: MCP handler creates toolRunner with graph-scoped policy from request context
- [ ] NO_SRC_IMPORTS: No new packages — implementation lives in nodes/*/app/src/mcp/ (runtime wiring)
- [ ] PURE_LIBRARY: @cogni/ai-tools stays protocol-agnostic, no MCP dependency
- [ ] CODEX_ENV_SCOPED: MCP server URL added to config.toml env whitelist, not leaked to Codex subprocess
- [ ] SIMPLE_SOLUTION: Implements existing server.stub.ts, reuses existing SDK/toolRunner/catalog
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal layers — MCP route is delivery, delegates to features via ports

### Files

**Implement** (replaces stub):
- `nodes/*/app/src/mcp/server.ts` — MCP server using `@modelcontextprotocol/sdk` StreamableHTTPServerTransport
  - `tools/list` → reads TOOL_CATALOG, returns MCP tool schemas
  - `tools/call` → reconstructs scope, creates toolRunner, executes, returns result

**Create**:
- `nodes/*/app/src/app/api/internal/mcp/route.ts` — Next.js API route, delegates to mcp/server.ts

**Modify**:
- `nodes/*/app/src/adapters/server/ai/codex/codex-mcp-config.ts` — add `cogni_tools` server entry pointing to `http://localhost:${PORT}/api/internal/mcp`
- `nodes/*/app/src/adapters/server/ai/codex/codex-llm.adapter.ts` — remove INVARIANT_DEVIATION warning (tools now available via MCP), add info log

**Test**:
- `nodes/*/app/tests/unit/mcp/server.test.ts` — tool listing, tool execution, policy enforcement, error handling
- `nodes/*/app/tests/unit/adapters/server/ai/codex/codex-mcp-config.test.ts` — update for new cogni_tools entry

### What this does NOT change

- `@cogni/ai-tools` — stays protocol-agnostic, no MCP imports
- `@cogni/ai-core` — toolRunner unchanged
- `@cogni/langgraph-graphs` — graph definitions unchanged, Cogni executor path unchanged
- Graph catalog — no graph changes needed
- Policy enforcement — still in toolRunner via existing pipeline
- Billing — Codex is user-funded ($0 platform cost), no billing changes

## Allowed Changes

- `nodes/*/app/src/mcp/server.ts` (implement stub)
- `nodes/*/app/src/app/api/internal/mcp/route.ts` (new route)
- `nodes/*/app/src/adapters/server/ai/codex/codex-mcp-config.ts` (add cogni_tools entry)
- `nodes/*/app/src/adapters/server/ai/codex/codex-llm.adapter.ts` (remove tool-strip warning)
- `nodes/*/app/tests/unit/mcp/` (new tests)
- `nodes/*/app/tests/unit/adapters/server/ai/codex/` (update tests)

## Validation

```bash
# After fix: run git-manager graph via Codex backend
# 1. Select ChatGPT in model picker
# 2. Ask: "list open PRs on canary"
# 3. Agent should call core__vcs_list_prs and return real PR data
# 4. Check logs: tool call routed via MCP → toolRunner.exec()
```

## Review Checklist

- [ ] **Work Item:** `bug.0300` linked in PR body
- [ ] **Spec:** Architecture preserves single tool plane
- [ ] **Tests:** MCP server unit tests + integration test with Codex mock
- [ ] **Reviewer:** assigned and approved

## PR / Links

- PR #805: https://github.com/Cogni-DAO/node-template/pull/805
- Production manually tested 2026-04-06: Codex OAuth works, but agent has no tools
- Canary logs 2026-04-06 ~21:07 UTC: git-manager graph executed with zero tool calls via Codex

## Attribution

- Discovered during deployment monitoring session 2026-04-06
- Root cause traced through CodexLlmAdapter → config.toml → MCP-only tool path
