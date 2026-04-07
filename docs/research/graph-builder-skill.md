---
id: graph-builder-skill
type: research
title: "1st-Time Graph Builder: Guided Agent Scaffolding Skill"
status: active
trust: draft
summary: Research spike for a guided skill + CLI that scaffolds LangGraph agents from intent → I/O contract → compiled graph → callable agent. Covers template taxonomy, auth blockers, and fastest green path to WOW.
read_when: Building agent scaffolding tools, extending contributor-cli, or designing graph template systems.
owner: derekg1729
created: 2026-04-06
verified: 2026-04-06
tags: [agents, developer-experience, scaffolding, research]
---

# Research: 1st-Time Graph Builder Skill

> spike: ad-hoc | date: 2026-04-06

## Question

What is the fastest green path to a "graph builder" experience where a new contributor goes from intent → clarifying questions → personalized LangGraph agent → callable artifact? What are the core I/O contracts, auth blockers, and minimal template set?

## Context

### What Exists Today

**10 production graphs** in `packages/langgraph-graphs/src/graphs/`:

| Graph           | Pattern                     | Tools                               | Complexity                 |
| --------------- | --------------------------- | ----------------------------------- | -------------------------- |
| poet            | ReAct, single tool          | `get_current_time`                  | Minimal — ideal starter    |
| ponderer        | ReAct, single tool          | `get_current_time`                  | Minimal (different prompt) |
| brain           | ReAct, multi-tool           | repo, knowledge, schedule (8 tools) | Medium                     |
| research        | ReAct, multi-tool           | web search + repo                   | Medium                     |
| browser         | ReAct, MCP tools            | playwright MCP                      | Medium (external tools)    |
| frontend-tester | ReAct, multi-MCP            | playwright + grafana MCPs           | Medium-high                |
| pr-review       | Structured output, no tools | —                                   | Unique (no ReAct loop)     |
| operator (×3)   | ReAct, configurable prompt  | repo + work-item tools              | Medium (shared factory)    |

**Graph anatomy** (5-file convention, well-established):

```
graphs/<name>/
  graph.ts      — pure factory: createXGraph(opts: CreateReactAgentGraphOptions) → compiled
  tools.ts      — TOOL_IDS constant (string[] from @cogni/ai-tools)
  prompts.ts    — system prompt string constant
  cogni-exec.ts — makeCogniGraph() entrypoint for Cogni runtime
  server.ts     — (optional) LangGraph server entrypoint
```

**Catalog registration** (`packages/langgraph-graphs/src/catalog.ts`):

- Add entry to `LANGGRAPH_CATALOG` with `displayName`, `description`, `toolIds`, `graphFactory`
- Bootstrap auto-discovers — no wiring changes needed

**Node-level graphs** (`nodes/<slug>/graphs/`):

- Same pattern, node-specific catalog (e.g., `POLY_LANGGRAPH_CATALOG`)
- Package at `nodes/<slug>/graphs/package.json` with `@cogni/langgraph-graphs` as dep

**Contributor CLI** (`packages/contributor-cli/` — on `feat/agent-contributor-protocol` branch):

- Commands: `tasks`, `claim`, `unclaim`, `status`
- Git/GitHub focused — find work, claim tasks, track PR/CI status
- No graph scaffolding capability yet
- 3 source files: `index.ts`, `git.ts`, `work-items.ts`

**Auth for external access** (current state):

- `/api/v1/chat/completions` — requires NextAuth session (SIWE wallet login)
- `/api/internal/graphs/[graphId]/runs` — requires `SCHEDULER_API_TOKEN` (bearer, internal only)
- No external API key issuance system for contributors
- `LITELLM_MVP_API_KEY` exists but is a single shared key for the DAO wallet link (not user-scoped)

### What's Missing

1. **No scaffolding tool** — creating a graph requires knowing the 5-file convention, tool catalog IDs, catalog registration, and cogni-exec wiring
2. **No external auth** — contributors can't call their graph on canary without SIWE wallet or internal token
3. **No "artifact" output** — no way to return a compiled graph pointer that a UI could visualize

## Findings

### Option A: Claude Code Skill (v0 — Fastest Path)

**What**: A `.claude/skills/` skill that guides the user through graph creation interactively in Claude Code, generating the 5-file graph scaffold + catalog entry.

**Flow**:

```
User: /graph-builder

Skill: What kind of agent are you building?
  1. Chat assistant (custom persona, minimal tools)
  2. Tool-calling agent (specific tools from our catalog)
  3. Research agent (web search + knowledge store)
  4. Structured output (no tools, schema-driven response)

User: picks 1

Skill: What should your agent's persona be? (1-2 sentences)
User: "A sarcastic code reviewer that only speaks in haiku"

Skill: Name for your graph? (lowercase-kebab, e.g., "haiku-reviewer")
User: haiku-reviewer

→ Generates:
  packages/langgraph-graphs/src/graphs/haiku-reviewer/
    graph.ts, tools.ts, prompts.ts, cogni-exec.ts
  Updates catalog.ts with new entry
  Commits to branch
```

- **Pros**: Zero auth needed (runs locally in Claude Code), leverages existing file conventions, can ship in 1 PR, user sees code immediately
- **Cons**: No deployed artifact, no API-callable agent, requires Claude Code
- **OSS tools**: None needed — it's a Claude Code skill (markdown + file generation)
- **Fit**: Perfect v0. Teaches the pattern. Produces real, compilable code.

### Option B: CLI Command (`cogni-contribute scaffold`)

**What**: Add `scaffold` command to `packages/contributor-cli/` that generates the graph scaffold from CLI args or interactive prompts.

**Flow**:

```bash
cogni-contribute scaffold \
  --name haiku-reviewer \
  --template chat-assistant \
  --prompt "A sarcastic code reviewer that only speaks in haiku" \
  --tools get_current_time
```

- **Pros**: Scriptable, works without Claude Code, integrates with existing contributor workflow
- **Cons**: More build work (template engine, interactive prompts in Node), contributor-cli not yet on main
- **OSS tools**: `inquirer` or `prompts` for interactive mode, `handlebars` for templates
- **Fit**: Good v1 after skill proves the template set. Contributor-cli needs to land on main first.

### Option C: Server-Side Graph Builder API

**What**: An API endpoint that accepts intent + params and returns a compiled graph artifact (or pointer).

- **Pros**: Enables UI-driven graph creation, vNext vision of "artifact" output
- **Cons**: Major auth blocker (who can register agents?), needs deployment pipeline, significantly more scope
- **Fit**: v2+. Requires agent-registry spec implementation + auth for external contributors.

### Template Taxonomy (Minimal v0 Set)

Based on the 10 existing graphs, 4 templates cover all patterns:

| Template            | Based On  | Key Difference                 | Tools Default               |
| ------------------- | --------- | ------------------------------ | --------------------------- |
| `chat-assistant`    | poet      | Custom persona, minimal tools  | `get_current_time`          |
| `tool-agent`        | brain     | Multi-tool ReAct agent         | User-selected from catalog  |
| `researcher`        | research  | Web search + knowledge write   | `web_search`, `knowledge_*` |
| `structured-output` | pr-review | No ReAct loop, schema response | None                        |

Each template maps to a `CreateReactAgentGraphOptions` factory call with different defaults.

### Auth Blocker Assessment

**Current state**: There is no way for an external contributor to call their graph on a running node.

**Paths to unblock**:

| Approach                   | Effort | Security       | Timeline                                |
| -------------------------- | ------ | -------------- | --------------------------------------- |
| Skip — v0 is local-only    | None   | N/A            | Now                                     |
| Dev-mode API key (env var) | Small  | Low (dev only) | 1 PR                                    |
| SIWE wallet auth (exists)  | None   | Good           | Already works for wallet holders        |
| Scoped API key issuance    | Medium | Good           | Needs agent-registry + RBAC integration |

**Recommendation**: v0 ships local-only (skill generates code, user runs `pnpm dev` and tests via chat UI). Auth for external deployment is a separate concern tracked by the agent-registry spec.

### Core I/O Contract for the Skill

**Input** (user provides):

```typescript
interface GraphBuilderInput {
  /** Template selection */
  template:
    | "chat-assistant"
    | "tool-agent"
    | "researcher"
    | "structured-output";
  /** Graph name (kebab-case) */
  name: string;
  /** System prompt / persona description */
  prompt: string;
  /** Tool IDs from @cogni/ai-tools catalog (optional, template has defaults) */
  toolIds?: string[];
  /** Target: operator catalog or node-specific catalog */
  target?: "operator" | `node:${string}`;
}
```

**Output** (skill produces):

```typescript
interface GraphBuilderOutput {
  /** Generated file paths */
  files: string[];
  /** Catalog entry added to */
  catalogFile: string;
  /** Graph ID (for runtime routing) */
  graphId: string; // e.g., "langgraph:haiku-reviewer"
  /** Git branch (if committed) */
  branch?: string;
}
```

### What a "Compiled Graph Package" Artifact Looks Like

In this codebase, a "compiled graph" is:

1. A `createXGraph` factory function (pure, no side effects)
2. Registered in `LANGGRAPH_CATALOG` with metadata
3. Wired via `makeCogniGraph()` in `cogni-exec.ts`
4. Automatically available at `/api/internal/graphs/{graphId}/runs` and `/api/v1/chat/completions` (via `model` field routing)

The **artifact** in v0 is the generated source code itself. In vNext, it could be:

- A graph ID pointer returned after successful build + deploy
- A Langfuse trace URL showing test execution
- An agent-registry `AgentRegistrationDocument` with the graph's services

### Integration with Agent Registry (vNext)

Per `docs/spec/agent-registry.md`:

1. Scaffold generates the graph code
2. On merge to canary → CI builds → graph is available in catalog
3. Bootstrap reads catalog → graph is API-callable
4. (Optional) `AgentIdentityPort.register()` creates an `AgentRegistrationDocument`
5. (Optional) `AgentIdentityPort.publish()` publishes to ERC-8004

This is already the designed flow. The graph builder skill just automates step 1.

## Recommendation

### Versioned Roadmap

**v0: Claude Code skill** (this PR)

- `/graph-builder` skill in `.claude/skills/graph-builder/`
- Guides user through intent → template → name → prompt → tools
- Generates 5-file graph scaffold + catalog entry
- Zero auth, zero infra. User tests locally via `pnpm dev`

**v0.1: Port to LangGraph agent on operator canary**

- The graph builder _itself_ becomes a graph in `LANGGRAPH_CATALOG`
- Agent I/O: user message → clarifying questions → generated graph package
- Output: git commit on a branch + PR to canary (via `core__vcs_create_branch` + file write tools)
- Tests on dev/canary: talk to the builder agent, it outputs new agent packages
- Key question: storage = git commit. Agent writes files, commits, opens PR. If approved, merge → canary auto-deploys → new agent is live.

**v1: CLI with local execution**

- Port to `cogni-contribute scaffold` CLI command
- Add `cogni-contribute execute <graphId>` for local graph testing without full dev server
- Challenge: needs LiteLLM running for LLM calls — may be too complex for v1. Consider a "dry-run" mode that validates the scaffold compiles without executing.

**vN: Registry + deployment pipeline**

- Agent-registry auto-registration on merge
- `AgentRegistrationDocument` created automatically from catalog entry
- Callable agent pointer returned to UI (graph ID + Langfuse trace link)
- Promotion flow: canary → preview → production (per existing CD pipeline)

**vLater: Evals + optimization**

- Prompt A/B testing workflows
- Eval harness for comparing graph output quality
- Template marketplace (community-contributed graph patterns)

### Template Evolution Note

The 4 v0 templates (chat-assistant, tool-agent, researcher, structured-output) cover single-agent ReAct patterns only. This leaves major gaps:

| Pattern                       | Status       | vNext Research                            |
| ----------------------------- | ------------ | ----------------------------------------- |
| Single ReAct agent            | v0 templates | Done                                      |
| Sequential chains (A → B → C) | Not covered  | Research n8n/flowise node-based graph UIs |
| Parallel fan-out/fan-in       | Not covered  | LangGraph native support exists           |
| Multi-agent supervisor        | Not covered  | LangGraph `createSupervisor` pattern      |
| Human-in-the-loop             | Not covered  | LangGraph interrupt/resume                |
| Stateful workflows            | Not covered  | Research Temporal integration             |

**vNext research target**: Study n8n and flowise OSS node-based graph builders for visual chain/multi-agent composition UX. These tools have mature visual editors for DAG construction that could inform a future web UI for graph building.

## Open Questions

- [ ] Should node-specific graphs (e.g., `nodes/poly/graphs/`) be scaffoldable too, or only operator-level graphs?
- [ ] What subset of `@cogni/ai-tools` should be presented as selectable tools in the builder? (Full catalog is 18 tools — all presented in v0 skill.)
- [ ] Should the skill auto-run `pnpm packages:build` after generation to validate the scaffold compiles?
- [ ] How should structured-output graphs (no ReAct loop) define their output schema in the builder flow?
- [ ] Should we generate a basic test file alongside the graph scaffold?
- [ ] v0.1: What tools does the builder-agent need to write files and commit? Likely needs a `file_write` tool (doesn't exist yet) plus `core__vcs_create_branch`.
- [ ] v0.1: How does the builder-agent output get reviewed? Standard PR review? Or a specialized "agent audit" review?
- [ ] vNext: What's the right visual graph builder UX? n8n-style node editor? Or code-first with visualization?

## Proposed Layout

### Project

Not yet — v0 is a single skill PR. If v1/v2 expand scope, create `proj.graph-builder` to track:

- P0: Skill + 4 templates (1 PR)
- P1: CLI command in contributor-cli (1 PR)
- P2: Server-side API + agent-registry integration (multi-PR)

### Specs

- **No new spec for v0** — skill follows existing graph conventions documented in catalog.ts and architecture.md
- **v2 would need**: extension to agent-registry spec for auto-registration flow

### Tasks

**v0 (this PR):**

1. **Create `/graph-builder` skill** — `.claude/skills/graph-builder/SKILL.md` with guided flow + 4 templates. DONE.
2. **Document in contributor guide** — Add "Creating Your First Agent" section to contributor quickstart.

**v0.1 (next PR):** 3. **Port builder to LangGraph agent** — Create `graph-builder` graph in `LANGGRAPH_CATALOG` that generates agent packages via tool calls + git commit. 4. **Add `file_write` tool to ai-tools** — Builder agent needs to create files in the repo.

**v1:** 5. **CLI scaffold command** — `cogni-contribute scaffold` with template selection + interactive prompts. 6. **CLI execute command** — Local graph execution for testing (may require LiteLLM).
