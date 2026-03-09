---
id: openclaw-workspace-spec
type: spec
title: OpenClaw Gateway Workspace
status: active
spec_state: draft
trust: draft
summary: Gateway agent workspace, governance trigger routing, and subagent delegation — user message handling, dual-workspace layout, skills, memory
read_when: Configuring gateway agent workspace, understanding governance trigger routing, writing skills, or debugging agent system prompt content
owner: derekg1729
created: 2026-02-13
verified: 2026-02-16
tags: [sandbox, openclaw, system-prompt]
---

# OpenClaw Gateway Workspace

> [!CRITICAL]
> The gateway agent uses a **dual-workspace** layout: `/workspace/gateway/` for system prompt context (AGENTS.md, SOUL.md, TOOLS.md, MEMORY.md), `/repo/current/` for the codebase. Skills live at repo root in `.openclaw/skills/`, loaded via `extraDirs`. OpenClaw's auto-populated `memory/` directory is ephemeral working memory (not in git); durable knowledge goes into `MEMORY.md` via human-reviewed commits. General project knowledge belongs in `docs/` and `work/` — not duplicated into MEMORY.md.

## Problem

Three compounding issues cause bad gateway agent behavior:

1. **Wrong AGENTS.md** — workspace is `/repo/current/` (the full Cogni repo). OpenClaw reads `AGENTS.md` from workspace root — this is a coding-agent meta-prompt (`pnpm check`, spec-first, API contracts), not appropriate for a chat agent.
2. **No persona** — no `SOUL.md` or `MEMORY.md` at repo root. Generic agent behavior.
3. **No skills** — OpenClaw has its own skill system (`workspace/skills/`). It does not read `.claude/commands/`. The agent has no structured workflows.
4. **Memory index bloat** — if workspace = repo root, OpenClaw indexes the entire codebase for memory search. Slow, irrelevant results.

## Goal

Define the workspace layout, governance operating model, subagent delegation strategy, and development workflow for the OpenClaw gateway agent. The agent is the lead engineer of CogniDAO — it autonomously handles recurring governance triggers and ad-hoc user messages in the same container.

## Non-Goals

- OpenClaw core changes (heartbeat fix is a separate upstream PR)
- Ephemeral sandbox workspace (different lifecycle, different concerns)
- OpenClaw plugin development (skills are sufficient)
- Full memory system tuning (embedding provider selection, chunking params)

## Invariants

> Numbering continues from [openclaw-sandbox-spec](openclaw-sandbox-spec.md) invariants 1–28.

29. **GATEWAY_WORKSPACE_SEPARATION**: The gateway agent's workspace (`agents.list[0].workspace`) is `/workspace/gateway/`, never the repo root. The repo is available read-only at `/repo/current/` via git-sync (volatile — replaced on every deploy). For development, the agent clones from remote into `/workspace/repo/` (persistent) and creates worktrees from there. This prevents system prompt contamination and keeps memory indexing scoped to docs, not source code.

30. **SKILLS_AT_REPO_ROOT**: OpenClaw skills live at `.openclaw/skills/` in the repo root, loaded via `skills.load.extraDirs`. Consistent with `.claude/commands/` and `.gemini/commands/`. Skills are versioned with the codebase.

31. **SOUL_IN_WORKSPACE**: `SOUL.md` (agent personality/tone) lives in the gateway workspace (`services/sandbox-openclaw/gateway-workspace/SOUL.md`). OpenClaw auto-injects SOUL.md from the workspace root only — there is no config to read it from an alternate path. If a second runtime needs a shared personality, extract to `.cogni/SOUL.md` then.

32. **MEMORY_IS_EPHEMERAL**: OpenClaw's auto-populated `memory/` directory (daily logs, session snapshots) is ephemeral working memory. It lives only in the container's workspace volume, is gitignored, and is expected to be lost on container hard reset. Durable knowledge belongs in `MEMORY.md` (human-reviewed, committed to git). A future cron worker ([task.0040](../../work/items/task.0040.gateway-memory-curation-worker.md)) may harvest valuable snippets from ephemeral memory before reset.

33. **MEMORY_MD_HIGH_BAR**: `MEMORY.md` is reserved for niche, container-specific context that an OpenClaw agent needs and cannot find via `memory_search` over `docs/` and `work/`. General project knowledge belongs in specs and guides — not duplicated into MEMORY.md. The agent should not edit files under `services/` unless the content is specific to the container itself. Examples of valid MEMORY.md content: container filesystem layout, tool availability quirks, worktree setup gotchas. Examples of invalid content: architecture overview (→ `docs/spec/architecture.md`), API contracts (→ `src/contracts/`).

34. **GOVERNANCE_TRIGGER_ROUTING**: The scheduler sends single-word governance tokens (`COMMUNITY`, `ENGINEERING`, `SUSTAINABILITY`, `GOVERN`). The agent routes immediately via SOUL.md trigger router to governance skills (`/gov-community`, `/gov-engineering`, `/gov-sustainability`, `/gov-govern`) with no pre-routing deliberation.

35. **USER_MODE_PRIORITIES**: When handling a user message (anything not in the governance trigger set), the agent follows three objectives in strict priority order: (1) help the user, (2) gather useful signal into work items or spec updates, (3) protect the charter — scope diversions into work items rather than derailing active work.

36. **SUBAGENT_DELEGATION_BY_LEADER**: Only the lead agent (main, with full SOUL.md context) decides when to spawn subagents via `sessions_spawn`. Subagents receive minimal prompt (AGENTS.md + TOOLS.md only per [openclaw-subagents-spec invariant 37](openclaw-subagents.md)). The leader delegates reads, scanning, and synthesis; it keeps all file mutations in its own context.

37. **WRITES_REQUIRE_STRONG_MODEL**: All file mutations (write, edit, commit, EDOs, digests) must use a strong-tier model. Flash/weak models are restricted to read, scan, grep, collect, summarize, and synthesize — never file writes. This applies to both the main agent and any subagent spawns.

38. **GOVERN_EDO**: When the agent makes a real decision during GOVERN (chose between alternatives, not routine work), it records an EDO (Event → Decision → Expected Outcome) in `memory/`. EDOs include a `byDate` for outcome checking. The weekly prune closes overdue EDOs. Policy/architecture/security/cost EDOs are committed to `docs/governance/decisions.md`; micro-choices stay ephemeral.

39. **CAPABILITY_GROWTH_GATE**: No new capability without six elements: a user it serves, a way to measure it, an owner, docs, a maintenance plan, and break detection. The agent must refuse to add capabilities that lack this checklist.

## Design

### Workspace Layout

All system prompt files live in a single directory, bind-mounted into the container:

**`services/sandbox-openclaw/gateway-workspace/` → `/workspace/gateway/`:**

```
/workspace/gateway/                    ← OpenClaw workspace root
├── AGENTS.md                          # Runtime-specific operating instructions
├── SOUL.md                            # Agent identity, principles, governance (auto-injected)
├── GOVERN.md                          # GOVERN loop checklist (read on-demand, NOT auto-injected)
├── TOOLS.md                           # Container environment notes
├── MEMORY.md                          # Niche container-specific context (high bar, see invariant 33)
├── .gitignore                         # Ignores memory/ directory
└── memory/                            # Ephemeral working memory (not in git, lost on reset)
    ├── YYYY-MM-DD.md                  # Auto-populated session logs (on /new)
    ├── YYYY-MM-DD-digest.md           # Daily digest (written by agent)
    ├── _budget_header.md              # GOVERN-owned live gate
    ├── edo_index.md                   # Open/recent EDO index
    ├── EDO/                           # EDO files (`<id>.md`) from template
    ├── COMMUNITY/heartbeat.md         # Latest charter heartbeat (overwrite)
    ├── ENGINEERING/heartbeat.md       # Latest charter heartbeat (overwrite)
    ├── SUSTAINABILITY/heartbeat.md    # Latest charter heartbeat (overwrite)
    └── GOVERN/heartbeat.md            # Latest charter heartbeat (overwrite)
```

OpenClaw reads AGENTS.md, SOUL.md, TOOLS.md, MEMORY.md from the workspace root at session start (truncated to `bootstrapMaxChars`, default 20,000 chars). SOUL.md must be at the workspace root — OpenClaw has no config to read it from an alternate path. Subagents receive only `AGENTS.md` + `TOOLS.md`.

**Files not used:**

| File           | Reason                              |
| -------------- | ----------------------------------- |
| `IDENTITY.md`  | Identity set via config             |
| `USER.md`      | Multi-user gateway — no single user |
| `HEARTBEAT.md` | Heartbeats disabled (invariant 25)  |
| `BOOTSTRAP.md` | `skipBootstrap: true`               |

### Container Mounts

```yaml
# openclaw-gateway service
entrypoint:
  [
    "sh",
    "-c",
    "mkdir -p /workspace/.openclaw-config && cp /opt/openclaw-config-source.json /workspace/.openclaw-config/openclaw.json && exec node /app/dist/index.js gateway",
  ]
environment:
  - OPENCLAW_CONFIG_PATH=/workspace/.openclaw-config/openclaw.json
volumes:
  - ./openclaw/openclaw-gateway.json:/opt/openclaw-config-source.json:ro # seed config
  - ./openclaw/gateway-workspace:/workspace/gateway # system prompt files
  - repo_data:/repo:ro # codebase mirror (volatile — git-sync replaces on deploy)
  - cogni_workspace:/workspace # persistent workspace volume (RW)
```

**Config seeding pattern**: The container runs with `read_only: true` (read-only rootfs). OpenClaw uses atomic writes to persist config changes (temp file → rename), which requires a **writable directory** — not just a writable file. Mounting the config file directly to `/etc/openclaw/` fails because the directory is on the read-only rootfs and temp file creation gets EROFS. The entrypoint copies the git-managed source config (mounted `:ro` at a staging path) into `/workspace/.openclaw-config/` on the writable `cogni_workspace` volume. OpenClaw can then freely create temp files and rename within that directory. Fresh config is seeded on every container restart; runtime mutations (plugin auto-enable, channel state) do not persist across restarts, which is fine — channel auth tokens come from env vars, not persisted config state.

The bind mount overlays `/workspace/gateway/` inside the existing `cogni_workspace` named volume. The `memory/` directory is created at runtime by OpenClaw inside the bind-mounted workspace (ephemeral, gitignored). The repo at `/repo/current/` already contains `.cogni/` and `.openclaw/skills/` — no additional mounts needed for those.

### Skills Integration

#### How OpenClaw Skills Work

OpenClaw discovers skills from multiple sources (in precedence order):

1. `<workspace>/skills/` — workspace skills (highest priority)
2. `~/.openclaw/skills/` — managed/installed skills
3. Bundled skills (built-in to OpenClaw)
4. `skills.load.extraDirs` — extra skill directories (config)
5. Plugin skills (extensions)

Each skill is a **markdown file with YAML frontmatter**:

```markdown
---
description: "Implement a work item following repo workflows"
user-invocable: true
---

# Instructions here (natural language, portable from .claude/commands/)
```

Key frontmatter fields:

| Field                      | Purpose                                   |
| -------------------------- | ----------------------------------------- |
| `description`              | Shown in system prompt + /help            |
| `user-invocable`           | Registers as `/skillname` slash command   |
| `disable-model-invocation` | Hide from agent (user-only)               |
| `command-dispatch: tool`   | Forward directly to a tool (bypass agent) |

Skills auto-register as `/skillname` commands in connected channels (Telegram, Discord, Slack).

#### Repo Layout

```
.openclaw/skills/                      ← repo root, alongside .claude/ and .gemini/
├── implement/
│   └── SKILL.md                       # /implement — code a work item
├── commit/
│   └── SKILL.md                       # /commit — conventional commit
├── spec/
│   └── SKILL.md                       # /spec — write/update a spec
├── test/
│   └── SKILL.md                       # /test — write tests
├── document/
│   └── SKILL.md                       # /document — update docs + headers
├── review-implementation/
│   └── SKILL.md                       # /review_implementation
├── bug/
│   └── SKILL.md                       # /bug — file a bug report
├── task/
│   └── SKILL.md                       # /task — decompose into PR-sized task
├── handoff/
│   └── SKILL.md                       # /handoff — context handoff doc
├── pull-request/
│   └── SKILL.md                       # /pull_request — create PR
├── gov-core/
│   └── SKILL.md                       # shared heartbeat contract for governance runs
├── gov-community/
│   └── SKILL.md                       # /gov-community
├── gov-engineering/
│   └── SKILL.md                       # /gov-engineering
├── gov-sustainability/
│   └── SKILL.md                       # /gov-sustainability
├── gov-govern/
│   └── SKILL.md                       # /gov-govern
└── ...
```

#### Config

```json5
{
  skills: {
    load: {
      extraDirs: ["/repo/current/.openclaw/skills"],
    },
  },
}
```

#### Conversion from Claude Code Commands

Each `.claude/commands/<name>.md` becomes `.openclaw/skills/<name>/SKILL.md`. The prompt content is portable — both systems use natural language instructions. Differences:

| Aspect       | `.claude/commands/`        | `.openclaw/skills/`                      |
| ------------ | -------------------------- | ---------------------------------------- |
| Format       | Plain markdown             | Markdown + YAML frontmatter              |
| Invocation   | `/name` in Claude Code CLI | `/name` in any connected channel         |
| Args         | `$ARGUMENTS` placeholder   | User args passed via channel             |
| Agent access | Always visible             | Controlled by `disable-model-invocation` |
| Dispatch     | Always through agent       | Optional direct tool dispatch            |

### Memory

Two layers:

**1. `MEMORY.md` (static)** — niche, container-specific context injected into system prompt per Invariant 33. Only content the agent cannot find via `memory_search`: container filesystem layout, tool availability quirks, OpenClaw integration gotchas. Manually maintained, version-controlled.

**2. Semantic search (dynamic)** — `memory_search` tool provides vector + BM25 hybrid search. The agent calls this tool before answering about prior work, decisions, or project context.

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        enabled: true,
        extraPaths: [
          "/repo/current/docs", // specs, guides, architecture
          "/repo/current/work", // projects, tasks, issues
        ],
      },
    },
  },
}
```

This indexes docs and work items **without indexing source code**. The `memory/` directory in the gateway workspace stores OpenClaw's auto-generated daily logs (gitignored).

### Development Workflow

The gateway agent is both a **chat responder** and a **developer**. The workspace separation means it starts in a clean chat context, then transitions to dev work when needed.

**Chat mode** (default): Agent responds from `/workspace/gateway/`, has access to curated context via MEMORY.md and semantic search over docs/work items.

**Dev mode** (on demand): When the task requires code changes:

1. Agent ensures a persistent clone exists: `git clone --single-branch -b main "$COGNI_REPO_URL" /workspace/repo` (one-time, idempotent)
2. Agent fetches latest: `git -C /workspace/repo fetch origin`
3. Agent creates a worktree: `git -C /workspace/repo worktree add /workspace/dev-<branch> -b <branch> origin/main`
4. Agent cds into `/workspace/dev-<branch>/`, reads its `AGENTS.md`
5. Agent follows repo workflows — `/implement`, `/commit`, `/test` skills guide the process
6. `GITHUB_TOKEN` and `COGNI_REPO_URL` are in env for GitHub API access

The gateway `AGENTS.md` documents this workflow explicitly.

### Operating Modes

The gateway agent handles two message classes in the same long-running container:

#### Governance Triggers (Autonomous)

Scheduler tokens map directly to governance skills:

- `COMMUNITY` → `/gov-community`
- `ENGINEERING` → `/gov-engineering`
- `SUSTAINABILITY` → `/gov-sustainability`
- `GOVERN` → `/gov-govern`

All governance skills share one shape: one focus, one decision (`action` or `no-op`), expected measurable delta, cost guard, evidence refs, then exit. Runtime writes use `memory/{CHARTER}/heartbeat.md` (overwrite latest) and GOVERN owns `memory/_budget_header.md`.

`/gov-govern` records an EDO only when a real choice between alternatives is made.

#### User Messages

Any message outside the governance trigger set is a user interaction. Multiple users can connect to the same container. The agent follows three priorities in order:

1. **Help** — answer the question, do what they ask
2. **Gather** — if the user shares useful context (bug reports, ideas, architecture feedback), capture it as a work item, spec update, or memory note
3. **Protect** — stay aligned with the charter. If a request conflicts with or would derail active chartered work, explain the conflict and offer to scope it as a work item

#### Subagent Delegation

The lead agent can spawn flash-tier subagents via `sessions_spawn` for parallel work. See [openclaw-subagents-spec](openclaw-subagents.md) for the full technical design (invariants 34–39, billing linkage, model tiers).

**Config** (`openclaw-gateway.json`):

```json5
{
  agents: {
    defaults: {
      subagents: {
        model: "cogni/gemini-2.5-flash", // default, overridable per-spawn
        maxConcurrent: 3,
        archiveAfterMinutes: 30,
      },
    },
  },
  tools: {
    deny: [
      /* sessions_spawn NOT in deny list */
    ],
  },
}
```

**Delegation heuristic** (from SOUL.md):

- **Delegate**: bulk reads, grep-and-summarize, data extraction, status checks
- **Keep in main**: file writes, code generation, architecture decisions, judgment calls

Model selection for write delegation is constrained by SOUL.md (brain brief -> `cogni/deepseek-v3.2`).

**Upstream blocker**: Subagent billing attribution requires an OpenClaw PR to propagate `outboundHeaders` from parent to child sessions ([task.0045](../../work/items/task.0045.openclaw-subagent-spawning.md)). Until that lands, subagent LLM calls won't carry billing headers. Not a practical issue while all models route through the proxy at zero cost.

### OpenClaw System Prompt Anatomy

For reference, `buildAgentSystemPrompt()` in OpenClaw injects these sections (full mode):

| Section         | Source                          | Our concern                           |
| --------------- | ------------------------------- | ------------------------------------- |
| Identity        | Hardcoded                       | Fine                                  |
| Safety          | Hardcoded                       | Fine                                  |
| Tooling         | `tools` config + deny list      | Controlled by our config              |
| Skills          | `skills/` directories           | Populated via `extraDirs`             |
| Memory Recall   | `memorySearch` config           | Configured with `extraPaths`          |
| Workspace Files | `AGENTS.md`, `SOUL.md`, etc.    | Delivered in gateway-workspace        |
| Heartbeat       | `heartbeat` config              | **Bug — injected even when disabled** |
| Runtime         | Auto-populated                  | Fine                                  |
| Documentation   | Hardcoded (OpenClaw docs links) | Noise but harmless                    |
| Silent Replies  | `NO_REPLY` token                | `message` tool denied — inert         |

**Heartbeat bug**: OpenClaw `src/agents/system-prompt.ts:590-600` injects heartbeat instructions when `promptMode != "minimal"`, regardless of `heartbeat.every`. With `heartbeat.every: "0"`, the runner is disabled but the instruction stays in the prompt. The LLM hallucinates `HEARTBEAT_OK` as a chat response. Fix: upstream PR to make the section conditional on heartbeat being enabled.

## Anti-Patterns

| Pattern                                         | Problem                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Workspace = repo root                           | Wrong AGENTS.md, memory indexes all source code                                                                                   |
| Skills in `gateway-workspace/skills/`           | Not versioned with codebase, diverges from `.claude/` and `.gemini/` conventions                                                  |
| Copy `.claude/commands/` verbatim               | Missing YAML frontmatter, `$ARGUMENTS` won't resolve                                                                              |
| `memorySearch.extraPaths` = `["/repo/current"]` | Indexes entire codebase including node_modules artifacts                                                                          |
| Omit `MEMORY.md`                                | Agent has no curated project context, relies entirely on search                                                                   |
| Dump project knowledge into `MEMORY.md`         | General knowledge belongs in `docs/` and `work/` — MEMORY.md is for niche container-specific context only                         |
| Agent edits files under `services/`             | Service config is infra, not agent workspace — only edit if specific to the container itself                                      |
| Mount config file directly to read-only rootfs  | OpenClaw atomic writes need a writable directory for temp files — mount `:ro` at staging path, copy to writable volume on startup |

## Acceptance Checks

- `docker exec openclaw-gateway cat /workspace/gateway/AGENTS.md` returns gateway-specific instructions (not repo-root meta-prompt)
- `docker exec openclaw-gateway cat /workspace/gateway/SOUL.md` returns agent personality
- `docker exec openclaw-gateway ls /repo/current/.openclaw/skills/` lists skill directories
- Send 5 messages via UI — zero `HEARTBEAT_OK` responses, coherent answers
- Agent can describe its own skills when asked ("what can you do?")

## Open Questions

### OQ-1: Gateway Workspace Markdown Validation

The `gateway-workspace/` AGENTS.md is excluded from the repo's `validate-agents-md.mjs` because it serves a different purpose (OpenClaw system prompt, not repo directory structure). The other workspace files (SOUL.md, TOOLS.md, MEMORY.md) have no validation at all. Consider adding a lightweight validator that checks these files for basic structure (non-empty, reasonable length, no stale info).

## Related

- [openclaw-sandbox-spec](openclaw-sandbox-spec.md) — Core integration invariants 13–28, container images, billing
- [openclaw-subagents](openclaw-subagents.md) — Subagent spawning, billing linkage, model tiers (invariants 34–39 in that spec)
- [openclaw-sandbox-controls](openclaw-sandbox-controls.md) — Git relay, agent catalog, credential strategy
- `work/charters/CHARTER.md` — DAO charter (strategic north star for GOVERN loop)
- [task.0023](../../work/items/task.0023.gateway-agent-system-prompt.md) — Implementation task
- [task.0040](../../work/items/task.0040.gateway-memory-curation-worker.md) — Memory curation cron worker (harvest ephemeral → durable)
- OpenClaw system prompt: `src/agents/system-prompt.ts` (in openclaw repo)
- OpenClaw skills: `src/agents/skills/workspace.ts` (in openclaw repo)
- OpenClaw memory: `src/memory/` (in openclaw repo)
