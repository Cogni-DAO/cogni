---
id: task.0233
type: task
title: "Graph-as-tool: cross-agent delegation via ToolContract"
status: needs_design
priority: 2
rank: 3
estimate: 5
summary: Enable any graph to invoke another graph as a tool, with call_depth tracking to prevent infinite recursion
outcome: Compositional agents — Browser can delegate to Research, Brain can invoke PR Review
spec_refs:
assignees:
credit:
project:
branch:
pr:
reviewer:
created: 2026-03-29
updated: 2026-03-29
labels: [agents, tools, composition, architecture]
external_refs: [spike.0231]
revision: 0
blocked_by:
deploy_verified: false
---

# Graph-as-Tool: Cross-Agent Delegation

## Problem

Graphs are isolated. The research graph does supervisor→researcher internally, but no graph can call another graph. Browser can't delegate a search to Research. Brain can't invoke PR Review for structured analysis.

Dify solves this with `WorkflowTool` (`api/core/tools/workflow_as_tool/tool.py`) — any workflow exposed as a callable tool with `call_depth` tracking to prevent infinite recursion.

## Design

### Invariants

- **TOOLS_VIA_TOOLRUNNER**: Graph-tools flow through the same policy → validation → exec → redaction pipeline as all tools
- **CALL_DEPTH_LIMIT**: Maximum nesting depth (default: 3) prevents infinite recursion
- **CATALOG_SINGLE_SOURCE_OF_TRUTH**: Graph-tools registered in TOOL_CATALOG like any other tool
- **NO_SELF_INVOCATION**: A graph cannot list itself as a delegatable tool (detected at registration)

### Approach

1. **GraphToolContract**: A `ToolContract` that accepts `{ graphId, input, maxTokens? }` and returns `{ output }`.

2. **GraphToolImplementation**: `execute()` calls `GraphExecutorPort.runGraph()` with:
   - The target graph's ID from catalog
   - `call_depth + 1` passed in configurable
   - Collects streaming output into a single text result
   - Timeout = parent timeout or configurable cap

3. **Call depth tracking**:
   - Add `call_depth: number` to `InProcGraphRequest.configurable`
   - `createInProcGraphRunner()` checks `call_depth >= MAX_CALL_DEPTH` → throw
   - Default `MAX_CALL_DEPTH = 3` (matches Dify's pattern)

4. **Registration in catalog**:
   - `createGraphTool(catalogEntry, graphExecutor): BoundTool`
   - Registered as `graph__<graphId>` (e.g., `graph__research`, `graph__pr_review`)
   - Parent graphs declare delegatable graphs in `toolIds` as they do native tools

### Files to Modify

| File | Change |
|---|---|
| `packages/ai-tools/src/tools/graph-tool.ts` (new) | GraphTool contract + implementation |
| `packages/ai-tools/src/catalog.ts` | Register graph tools |
| `packages/langgraph-graphs/src/inproc/runner.ts` | call_depth check |
| `packages/langgraph-graphs/src/inproc/types.ts` | call_depth in configurable |

### Dify Reference

`api/core/tools/workflow_as_tool/tool.py` lines 34-150:
- `WorkflowTool._invoke()` calls `WorkflowAppGenerator.generate()` with `call_depth`
- `api/core/workflow/workflow_entry.py` line 144: depth limit enforcement

### Validation

- Unit test: Graph A invokes Graph B → gets result
- Unit test: call_depth >= 3 → throws error (not infinite loop)
- Unit test: Graph A cannot invoke itself
- Contract test: Graph-tool flows through toolRunner pipeline (policy, redaction)
