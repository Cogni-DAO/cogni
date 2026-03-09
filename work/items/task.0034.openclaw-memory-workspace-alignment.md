---
id: task.0034
type: task
title: "Wire OpenClaw memory search + bootstrap files for cogni-template repo context"
status: needs_design
priority: 1
estimate: 2
summary: Configure OpenClaw gateway to index cogni-template docs/work via memorySearch.extraPaths, add curated MEMORY.md + TOOLS.md to gateway workspace, and document the integration in openclaw-sandbox-spec
outcome: Gateway agent can semantically search repo docs, has curated project knowledge injected via bootstrap files, and the spec documents how memory search and bootstrap file alignment work
spec_refs: openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [openclaw, memory, system-prompt]
external_refs:
  - docs/research/openclaw-memory-workspace-alignment.md
revision: 0
blocked_by:
deploy_verified: false
rank: 12
---

# Wire OpenClaw memory search + bootstrap files for cogni-template repo context

## Requirements

### Problem

The OpenClaw gateway agent has no semantic search over our repo's documentation (`docs/spec/`, `docs/guides/`, `docs/research/`, `work/projects/`, `work/items/`). It can `grep`/`find` files but cannot do vector/hybrid retrieval. Additionally, the agent has no curated `MEMORY.md` (project knowledge) or `TOOLS.md` (environment-specific tool notes) — two bootstrap files that OpenClaw injects into the system prompt automatically.

### Background

OpenClaw has two independent context delivery mechanisms (see [research doc](../../docs/research/openclaw-memory-workspace-alignment.md)):

1. **Bootstrap files** (`AGENTS.md`, `SOUL.md`, `MEMORY.md`, `TOOLS.md`, etc.) — loaded from workspace directory, injected verbatim into the system prompt under `# Project Context`. Each file truncated at `bootstrapMaxChars` (default 20,000 chars).

2. **Memory search** (`memorySearch.extraPaths`) — indexes `*.md` files from specified directories into a SQLite + sqlite-vec vector store. Agent queries via `memory_search`/`memory_get` tools.

The two mechanisms are **fully additive** — no conflicts.

### Acceptance Criteria

- [ ] `openclaw-gateway.json` and `openclaw-gateway.test.json` contain `memorySearch` config with `extraPaths` targeting repo doc subdirs
- [ ] `memorySearch.enabled` is `false` initially (no embedding provider yet — enable is a follow-up)
- [ ] Gateway workspace directory (created by task.0023) contains curated `MEMORY.md` with key project knowledge (<20K chars)
- [ ] Gateway workspace directory contains `TOOLS.md` documenting available tools, repo layout, and useful commands
- [ ] `docs/spec/openclaw-sandbox-spec.md` has a new section documenting: (a) how bootstrap files align with the repo, (b) how `memorySearch.extraPaths` works, (c) the recommended config
- [ ] `pnpm check:docs` passes
- [ ] Manual verification: inspect gateway system prompt (via `openclaw status` or log inspection) to confirm `MEMORY.md` and `TOOLS.md` content appears under `# Project Context`

## Allowed Changes

- `services/sandbox-openclaw/openclaw-gateway.json` — add `memorySearch` config block
- `services/sandbox-openclaw/openclaw-gateway.test.json` — mirror `memorySearch` config
- `services/sandbox-openclaw/gateway-workspace/MEMORY.md` — new file (curated project knowledge)
- `services/sandbox-openclaw/gateway-workspace/TOOLS.md` — new file (environment + tool notes)
- `docs/spec/openclaw-sandbox-spec.md` — new section: "Memory Search & Bootstrap File Alignment"
- `docs/research/openclaw-memory-workspace-alignment.md` — minor updates if needed

**Out of scope:**

- Enabling memory search (requires embedding provider routing — separate task)
- Creating the gateway workspace directory itself (task.0023)
- `AGENTS.md` or `SOUL.md` (task.0023 scope)
- LiteLLM embedding model config

## Plan

### Part A: Gateway config — memorySearch.extraPaths

- [ ] Add `memorySearch` block to `services/sandbox-openclaw/openclaw-gateway.json`:
  ```json
  "memorySearch": {
    "enabled": false,
    "extraPaths": ["docs/spec", "docs/guides", "docs/research", "work/projects", "work/items"]
  }
  ```
- [ ] Add same block to `services/sandbox-openclaw/openclaw-gateway.test.json`
- [ ] Verify JSON is valid (`node -e "JSON.parse(require('fs').readFileSync('...'))"`)

### Part B: Curated bootstrap files

- [ ] Create `services/sandbox-openclaw/gateway-workspace/MEMORY.md`:
  - Cogni architecture summary (hex layering, key directories)
  - OpenClaw integration model (two execution modes, billing flow)
  - Key specs and their locations
  - Common gotchas (dockerode streams, tmpfs masking, etc.)
  - Keep under 15K chars (leave headroom below 20K truncation limit)
- [ ] Create `services/sandbox-openclaw/gateway-workspace/TOOLS.md`:
  - Available tools in sandbox (exec, read, write, edit, grep, find, ls, apply_patch)
  - Denied tools and why (no web, browser, cron, gateway, message)
  - Repo layout pointer (`/repo/current` structure)
  - Useful commands (`pnpm check`, `pnpm test`, `pnpm build`)
  - LLM proxy info (localhost:8080, routes to LiteLLM via nginx)

### Part C: Spec documentation

- [ ] Add new section to `docs/spec/openclaw-sandbox-spec.md` after "Agent Provisioning Guide":
  - **Bootstrap File Loading**: workspace files → system prompt injection, how existing repo AGENTS.md already loads, curated MEMORY.md/TOOLS.md/SOUL.md in gateway-workspace
  - **Memory Search (extraPaths)**: how it works, path resolution, embedding provider requirement, compatibility note (purely additive)
  - **Recommended Config**: show the memorySearch block with extraPaths, reference research doc
- [ ] Add design note about `bootstrapMaxChars` limit (20K chars per file)
- [ ] Add new anti-pattern row: "Enable memorySearch without embedding route → silent index failures"

### Part D: Validation

- [ ] `pnpm check:docs` passes
- [ ] Both JSON configs parse without error
- [ ] (After task.0023 merges) Restart gateway, verify `MEMORY.md` and `TOOLS.md` appear in system prompt

## Validation

**Commands:**

```bash
# JSON validity
node -e "JSON.parse(require('fs').readFileSync('services/sandbox-openclaw/openclaw-gateway.json'))"
node -e "JSON.parse(require('fs').readFileSync('services/sandbox-openclaw/openclaw-gateway.test.json'))"

# Docs check
pnpm check:docs

# Bootstrap file size (must be <20K chars)
wc -c services/sandbox-openclaw/gateway-workspace/MEMORY.md
wc -c services/sandbox-openclaw/gateway-workspace/TOOLS.md
```

**Expected:** JSON parses, docs pass, both files under 20,000 bytes.

## Review Checklist

- [ ] **Work Item:** `task.0034` linked in PR body
- [ ] **Spec:** openclaw-sandbox-spec updated with memory search section
- [ ] **Tests:** JSON validity, docs check, file size verification
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Depends on: task.0023 (creates gateway workspace directory + volume mount)
- Research: [openclaw-memory-workspace-alignment.md](../../docs/research/openclaw-memory-workspace-alignment.md)
- Spec: [openclaw-sandbox-spec.md](../../docs/spec/openclaw-sandbox-spec.md)
- OpenClaw source: `src/agents/workspace.ts` (bootstrap loading), `src/memory/internal.ts` (extraPaths indexing)
- Follow-up: Enable memory search after adding embedding model to LiteLLM proxy config

## Attribution

-
