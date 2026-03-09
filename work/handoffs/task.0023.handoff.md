---
id: handoff.task.0023
type: handoff
work_item_id: task.0023
status: active
created: 2026-02-13
updated: 2026-02-13
branch: feat/task-0023-gateway-workspace
last_commit: pending
---

# Handoff: Gateway Agent Workspace

## Context

- The OpenClaw gateway agent reads the **wrong AGENTS.md** (repo-root coding-agent meta-prompt with `pnpm check`, spec-first, etc.) — not appropriate for a chat/dev agent
- It has **no personality** (SOUL.md), **no skills** (OpenClaw has its own skill system, not `.claude/commands/`), and **no curated memory**
- OpenClaw injects `HEARTBEAT_OK` instructions into the system prompt even when heartbeats are disabled (`heartbeat.every: "0"`), causing the LLM to hallucinate HEARTBEAT_OK as chat responses
- The fix is a **dual-workspace architecture**: dedicated `/workspace/gateway/` for system prompt context, with the repo at `/repo/current/` for code work
- A new spec (`openclaw-workspace-spec`) documents the design: workspace layout, skills integration, memory config, and dev workflow

## Current State

- **Done**: Spec written (`docs/spec/openclaw-workspace.md`), task plan updated with 5-part todo list
- **Done**: Gateway workspace behavior files created — `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md`, `.gitignore` in `services/sandbox-openclaw/gateway-workspace/`
- **Done**: 10 OpenClaw skills created at `.openclaw/skills/` (implement, commit, spec, test, document, bug, task, handoff, pull-request, review-implementation)
- **Done**: Validator exclusions — `gateway-workspace/` excluded from AGENTS.md validator, `.openclaw` added to root-layout allowlist
- **Done**: Config changes — `openclaw-gateway.json` + `.test.json` updated: workspace → `/workspace/gateway`, `skills.load.extraDirs`, `memorySearch.extraPaths`
- **Done**: Docker compose volume mounts — both prod (`docker-compose.yml`) and dev (`docker-compose.dev.yml`) bind-mount `gateway-workspace:/workspace/gateway`
- **Not done**: Upstream OpenClaw PR for heartbeat prompt conditional (separate repo)
- **Not done**: Manual validation (5-message test, skills listing)
- **Human review needed**: The 4 system prompt `.md` files need human review for tone, accuracy, and completeness (checklist in task)

## Decisions Made

- **Dual-workspace**: Agent workspace at `/workspace/gateway/`, repo at `/repo/current/` — see [openclaw-workspace-spec](../../docs/spec/openclaw-workspace.md) invariant 29 (GATEWAY_WORKSPACE_SEPARATION)
- **Skills at repo root**: `.openclaw/skills/` alongside `.claude/commands/` and `.gemini/commands/` — see invariant 30 (SKILLS_AT_REPO_ROOT), loaded via `skills.load.extraDirs` config
- **Memory via extraPaths**: Semantic search over `/repo/current/docs` and `/repo/current/work` without indexing source code
- **Dev workflow**: Agent creates git worktrees from `/repo/current/` when it needs to write code, documented in gateway `AGENTS.md`
- **Skill content**: Near-identical to `.claude/commands/` with minimal YAML frontmatter added
- **Both compose files**: Volume mount added to both `docker-compose.yml` (prod) and `docker-compose.dev.yml` (dev) — dev uses `../../../../services/sandbox-openclaw/gateway-workspace` relative path

## Next Actions

- [x] Update `services/sandbox-openclaw/openclaw-gateway.json`: workspace → `/workspace/gateway`, add `skills.load.extraDirs`, add `memorySearch.extraPaths`
- [x] Update `services/sandbox-openclaw/openclaw-gateway.test.json`: same changes
- [x] Update compose files: bind mount gateway-workspace into container (both prod + dev)
- [x] Update task status to `In Progress`, set branch field
- [ ] **Human review**: Read the 4 gateway workspace `.md` files for tone/accuracy (checklist in task)
- [ ] Upstream OpenClaw PR: make heartbeat prompt section conditional on `heartbeat.every > 0` (in `/Users/derek/dev/openclaw/`)
- [ ] Manual test: restart gateway, verify workspace files present, send 5 messages, zero HEARTBEAT_OK

## Risks / Gotchas

- The bind mount `gateway-workspace:/workspace/gateway` overlays inside the `cogni_workspace` named volume — Docker allows this but order matters in compose
- OpenClaw's `memory/` directory needs RW access in the bind-mounted workspace for daily log writes
- The heartbeat fix is in a separate repo (`/Users/derek/dev/openclaw/`) — without it, the system prompt still contains HEARTBEAT_OK instructions (mitigated by workspace separation but not eliminated)
- Gateway workspace `.md` files are NOT validated by the repo's AGENTS.md validator (documented as OQ-1 in spec)
- Skill names become slash commands — OpenClaw sanitizes to max 32 chars and replaces hyphens (e.g., `pull-request` → `/pull_request`)

## Pointers

| File / Resource                                          | Why it matters                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `docs/spec/openclaw-workspace.md`                        | Spec: invariants 29-30, design, anti-patterns                  |
| `work/items/task.0023.gateway-agent-system-prompt.md`    | Task: 5-part plan, acceptance criteria, human review checklist |
| `services/sandbox-openclaw/gateway-workspace/`           | The 4 system prompt files + .gitignore                         |
| `.openclaw/skills/`                                      | 10 converted skills (from `.claude/commands/`)                 |
| `services/sandbox-openclaw/openclaw-gateway.json`        | Gateway config — needs workspace/skills/memory updates         |
| `platform/infra/services/runtime/docker-compose.yml:426` | Gateway service definition — needs volume mount                |
| `scripts/validate-agents-md.mjs:407`                     | Validator exclusion for gateway-workspace                      |
| `scripts/check-root-layout.ts:72`                        | Root layout allowlist for `.openclaw`                          |
| `/Users/derek/dev/openclaw/src/agents/system-prompt.ts`  | Upstream: heartbeat section injection (lines ~590)             |
