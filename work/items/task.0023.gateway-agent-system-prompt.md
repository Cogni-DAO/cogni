---
id: task.0023
type: task
title: "Gateway agent workspace — dedicated context, skills integration, memory, and heartbeat fix"
status: needs_design
priority: 0
estimate: 3
summary: The OpenClaw gateway agent reads the wrong AGENTS.md, has no persona or skills, no memory config, and HEARTBEAT_OK contaminates responses. Needs dual-workspace architecture with dedicated system prompt context, skills at repo root, and memory search over docs.
outcome: Gateway agent has a dedicated workspace with purpose-built AGENTS.md + SOUL.md + MEMORY.md; skills from .openclaw/skills/ are available as /slash commands; memory search covers docs/work items; heartbeat instructions absent from system prompt; the LLM never hallucinates HEARTBEAT_OK.
spec_refs: openclaw-workspace-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch: feat/task-0023-gateway-workspace
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-13
labels: [openclaw, correctness, system-prompt]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 9
---

# Gateway agent system prompt — dedicated workspace, SOUL.md, and upstream heartbeat prompt fix

## Requirements

### Problem

Three compounding issues cause the gateway agent to produce bad responses:

1. **Wrong AGENTS.md**: The gateway agent workspace is `/repo/current` (the full Cogni repo). OpenClaw reads `AGENTS.md` from workspace root — this is our repo-wide coding-agent meta-prompt (`pnpm check`, "spec first", API contracts, etc.), not appropriate for a chat agent.

2. **No SOUL.md**: No personality file exists. OpenClaw's default persona is generic.

3. **HEARTBEAT_OK in system prompt**: OpenClaw `src/agents/system-prompt.ts:590-600` unconditionally injects heartbeat instructions into every non-minimal session:
   ```
   ## Heartbeats
   <heartbeat prompt>
   If you receive a heartbeat poll... reply exactly:
   HEARTBEAT_OK
   ```
   This is guarded by `promptMode` (not `heartbeat.every`), so `heartbeat.every: "0"` disables the runner but leaves the instruction in the prompt. The LLM (confirmed: gemini-2.5-flash) hallucinates HEARTBEAT_OK as a chat response.

### Acceptance Criteria

- [ ] Gateway agent workspace at `/workspace/gateway/` with `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md`
- [ ] `AGENTS.md` covers both chat mode and dev workflow (git worktree from `/repo/current/`)
- [ ] `SOUL.md` defines agent personality
- [ ] Skills at `.openclaw/skills/` in repo root — at minimum: implement, commit, spec, test, document
- [ ] `openclaw-gateway.json` updated: workspace path, `skills.load.extraDirs`, `memorySearch.extraPaths`
- [ ] Compose volume mounts bind gateway-workspace into container
- [ ] System prompt does NOT contain `HEARTBEAT_OK` or heartbeat instructions
- [ ] Upstream OpenClaw PR filed to make heartbeat prompt conditional
- [ ] Manual test: 5 messages via UI, zero HEARTBEAT_OK, coherent responses
- [ ] Agent can list its skills when asked

## Allowed Changes

### Cogni repo (this PR)

- `services/sandbox-openclaw/gateway-workspace/` — new directory: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md`, `.gitignore`
- `.openclaw/skills/` — new directory at repo root with converted skills
- `services/sandbox-openclaw/openclaw-gateway.json` — workspace path, skills, memory config
- `services/sandbox-openclaw/openclaw-gateway.test.json` — same
- `platform/infra/services/runtime/docker-compose.yml` — volume mount for gateway workspace
- `docs/spec/openclaw-workspace.md` — new spec (already created)

### OpenClaw repo (upstream PR, separate)

- `src/agents/system-prompt.ts` — make heartbeat section conditional on heartbeat being enabled
- `src/agents/pi-embedded-runner/run/attempt.ts` — pass heartbeat-enabled flag to prompt builder

## Plan

### Part 1: Gateway workspace files

- [ ] Create `services/sandbox-openclaw/gateway-workspace/AGENTS.md` — operating instructions for chat mode + dev workflow (git worktree setup, when to transition, available tools)
- [ ] Create `services/sandbox-openclaw/gateway-workspace/SOUL.md` — Cogni agent personality (concise, technical, direct)
- [ ] Create `services/sandbox-openclaw/gateway-workspace/TOOLS.md` — environment notes (no gh CLI, use curl + GITHUB_TOKEN, git remote setup via COGNI_REPO_URL)
- [ ] Create `services/sandbox-openclaw/gateway-workspace/MEMORY.md` — curated project context (architecture overview, key conventions, file layout, known gotchas)
- [ ] Create `services/sandbox-openclaw/gateway-workspace/.gitignore` — ignore `memory/` directory (OpenClaw auto-populated daily logs)

### Part 2: Skills at repo root

- [ ] Create `.openclaw/skills/implement/SKILL.md` — convert from `.claude/commands/implement.md`, add frontmatter
- [ ] Create `.openclaw/skills/commit/SKILL.md` — convert from `.claude/commands/commit.md`
- [ ] Create `.openclaw/skills/spec/SKILL.md` — convert from `.claude/commands/spec.md`
- [ ] Create `.openclaw/skills/test/SKILL.md` — convert from `.claude/commands/test.md`
- [ ] Create `.openclaw/skills/document/SKILL.md` — convert from `.claude/commands/document.md`
- [ ] Convert remaining high-value commands: bug, task, handoff, pull-request, review-implementation

### Part 3: Config + compose

- [x] Update `openclaw-gateway.json`: `agents.list[0].workspace` → `/workspace/gateway`
- [x] Update `openclaw-gateway.json`: add `skills.load.extraDirs: ["/repo/current/.openclaw/skills"]`
- [x] Update `openclaw-gateway.json`: add `agents.defaults.memorySearch` with `extraPaths` for `/repo/current/docs` and `/repo/current/work`
- [x] Update `openclaw-gateway.test.json`: same workspace + skills + memory changes
- [x] Update `docker-compose.yml`: add bind mount `./openclaw/gateway-workspace:/workspace/gateway` to openclaw-gateway service (both prod + dev compose)

### Part 4: Upstream heartbeat fix (separate PR in openclaw repo)

- [ ] In `src/agents/system-prompt.ts:589-600`: wrap heartbeat section in check for `heartbeatEnabled` flag
- [ ] In `src/agents/pi-embedded-runner/run/attempt.ts`: resolve heartbeat config, pass `heartbeatEnabled: resolvedInterval > 0`
- [ ] Test: `heartbeat.every: "0"` → system prompt must NOT contain `HEARTBEAT_OK`
- [ ] File PR in openclaw repo

## Validation

```bash
docker compose restart openclaw-gateway && sleep 5
docker exec openclaw-gateway cat /workspace/gateway/AGENTS.md
docker exec openclaw-gateway cat /workspace/gateway/SOUL.md
docker exec openclaw-gateway ls /repo/current/.openclaw/skills/
```

- [ ] Gateway-specific AGENTS.md present (not repo-root meta-prompt)
- [ ] SOUL.md personality present
- [ ] Skills directories visible
- [ ] Send 5 messages via UI — coherent responses, zero HEARTBEAT_OK
- [ ] Ask agent "what skills do you have?" — lists available skills

## Human Review — System Prompt Files

These files define what the LLM sees. Review tone, accuracy, and completeness after the architectural refactor is done.

- [ ] `services/sandbox-openclaw/gateway-workspace/AGENTS.md` — operating instructions (chat + dev workflow, tool list, worktree setup)
- [ ] `services/sandbox-openclaw/gateway-workspace/SOUL.md` — personality and tone
- [ ] `services/sandbox-openclaw/gateway-workspace/TOOLS.md` — environment notes (git, gh, pnpm, proxy, limitations)
- [ ] `services/sandbox-openclaw/gateway-workspace/MEMORY.md` — curated project context (architecture, conventions, gotchas)

## Review Checklist

- [ ] **Work Item:** `task.0023` linked in PR body
- [ ] **Spec:** Matches [openclaw-workspace-spec](../../docs/spec/openclaw-workspace.md)
- [ ] **Tests:** Manual validation (5-message rapid-fire, zero HEARTBEAT_OK, skills listing)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Spec: [openclaw-workspace-spec](../../docs/spec/openclaw-workspace.md) — dual-workspace design
- Related: bug.0021 (HEARTBEAT_OK contamination), task.0008 (gateway protocol lifecycle)
- OpenClaw system prompt: `src/agents/system-prompt.ts` (in openclaw repo)
- OpenClaw skills: `src/agents/skills/workspace.ts` (in openclaw repo)
- OpenClaw memory: `src/memory/` + `docs/concepts/memory.md` (in openclaw repo)
- Handoff: [handoff](../handoffs/task.0023.handoff.md)

## Attribution

- Investigation: claude-opus-4.6 + derekg1729
