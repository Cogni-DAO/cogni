---
id: bug.0300
type: bug
title: "Codex executor silently drops all core__ tools — BYO-AI agents have no VCS/schedule/work-item capabilities"
status: in_progress
priority: 0
rank: 1
estimate: 5
summary: "CodexLlmAdapter strips all LangGraph tools (line 92-104) because Codex SDK only supports MCP for external tools. Graphs like git-manager ship with 11 core__ tools but Codex users get zero. Fix: expose core__ tools via internal MCP server that delegates to toolRunner.exec()."
outcome: "Any graph running on any executor (Cogni or Codex) has access to the same core__ tools. Codex reaches them via MCP; Cogni reaches them via toolRunner.exec(). One tool plane, multiple transports."
spec_refs: []
assignees: []
credit: []
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
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

## Fix Design

### Principle: One tool plane, many transports

`@cogni/ai-tools` stays as the canonical tool registry. A new `@cogni/mcp-server` package exposes those same tools over MCP protocol. Codex config.toml points to this internal MCP server.

```
Codex Executor (fixed):
  config.toml → mcp-server (internal) → toolRunner.exec() via ALS → tool result
                └─ same auth, same policy, same audit as Cogni executor
```

### Package split

| Package | Role | Changes |
|---------|------|---------|
| `@cogni/ai-tools` | Tool definitions + schemas + execution | None — stays protocol-agnostic |
| `@cogni/mcp-server` (NEW) | Thin MCP facade over ai-tools | Exposes TOOL_CATALOG tools via MCP protocol |
| `codex-mcp-config.ts` | Codex config.toml generation | Add internal MCP server URL |
| `codex-llm.adapter.ts` | Codex subprocess management | Remove tool-stripping warn, rely on MCP bridge |

### MCP server design

- Runs as an in-process HTTP endpoint (not a separate container)
- Reads tools from `TOOL_CATALOG` at startup
- On tool call: resolves execution context (runId, userId, auth) from request headers
- Delegates to `toolRunner.exec(toolName, args, executionScope)`
- Returns tool result as MCP response
- Auto-exposes new tools as they're added to the catalog — zero per-tool work

### What this does NOT change

- Tool definitions (stay in `@cogni/ai-tools`)
- Tool execution logic (stays in toolRunner)
- Cogni executor path (still uses LangGraph tools directly)
- Policy enforcement (still in toolRunner)
- Graph definitions (no changes needed)

## Allowed Changes

- `packages/mcp-server/` (new package)
- `nodes/operator/app/src/adapters/server/ai/codex/codex-mcp-config.ts`
- `nodes/operator/app/src/adapters/server/ai/codex/codex-llm.adapter.ts`
- `nodes/operator/app/src/bootstrap/container.ts` (register MCP server endpoint)

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
