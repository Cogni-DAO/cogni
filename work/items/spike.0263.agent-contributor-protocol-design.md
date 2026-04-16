---
id: spike.0263
type: spike
title: "Spike: agent contributor protocol — communication mechanism + workflow design"
status: needs_research
priority: 1
rank: 99
estimate: 3
summary: "Research and design the communication mechanism and workflow protocol for multi-agent coordination. Evaluate git-native vs GitHub-native vs event bus. Produce a protocol spec."
outcome: "A protocol spec (docs/spec/agent-contributor-protocol.md) with: state machine, message formats, communication mechanism decision, structured review feedback format, and external agent onboarding flow."
spec_refs: []
assignees: derekg1729
credit:
project: proj.development-workflows
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
labels: [infrastructure, agents, protocol, research]
external_refs:
---

# Spike: agent contributor protocol — communication mechanism + workflow design

Parent: story.0262

## Research Questions & Findings

### 1. Communication mechanism — DECIDED: Node streams

**Decision:** Agents talk to Cogni via the same HTTP/SSE stream endpoints the dashboard uses. No `gh` CLI dependency. No local file scraping.

**Rejected alternatives:**

- ~~Git-native (frontmatter polling)~~ — requires monorepo clone, filesystem coupling
- ~~GitHub-native (`gh` CLI wrapper)~~ — adds platform lock-in, user wants to purge `gh` dependency
- ~~Event bus (Redis/webhooks)~~ — unnecessary infra when nodes already serve streams

**Why streams:** The nodes already expose `/api/streams/*` (health, vcs-activity, logs). Work items, task claiming, and review status are just more streams. One transport for everything — dashboard, CLI, external agents all consume the same API.

**What the CLI becomes:**

```bash
cogni status                    # GET /api/streams/health
cogni activity --node poly      # GET /api/streams/vcs-activity
cogni tasks                     # GET /api/streams/work-items (new)
cogni logs --follow             # GET /api/streams/logs (SSE)
cogni claim <task_id>           # POST /api/work-items/<id>/claim (new)
cogni submit <task_id>          # POST /api/work-items/<id>/submit (new)
```

### 2. Structured review feedback — DEFERRED

Depends on stream API shape. Will follow from whatever format `/api/streams/review-status` returns.

### 3. Task claiming — DEFERRED

Server-side via `POST /api/work-items/<id>/claim`. Conflict prevention is a backend concern, not a CLI concern.

### 4. External agent trust model — DEFERRED

Auth via API key or token against the node. Trust tiers enforced server-side.

### 5. Existing art — NOTED

Claude Code's `RemoteTrigger` / scheduled agents is the closest model. External agent gets a token, hits the API.

## Current state: `packages/contributor-cli/`

**Status: DEAD CODE — delete when convenient.**

The existing CLI (`cogni-contribute`) is a local filesystem scraper that reads `work/items/*.md` YAML from disk. It requires being inside the monorepo. This is the wrong abstraction — the replacement CLI will be an HTTP client against node stream endpoints.

## Allowed Changes

- `docs/spec/agent-contributor-protocol.md` — the output spec
- `work/items/` — update story.0262 with findings
- `packages/contributor-cli/` — delete (filesystem scraper, replaced by stream client)
- `.claude/skills/contribute/` — update to reference stream-backed CLI

## Plan

- [x] Evaluate communication mechanisms (decision: node streams)
- [x] Reject `gh` CLI / GitHub-native approach (user directive: purge gh dependency)
- [x] Reject filesystem scraper approach (requires monorepo clone)
- [ ] Define stream API endpoints for work items (GET list, POST claim/submit)
- [ ] Build stream-backed CLI (`cogni` command, npm-publishable)
- [ ] Delete `packages/contributor-cli/` (dead filesystem scraper)
- [ ] Write protocol spec
- [ ] Update story.0262 with final protocol
- [ ] Document external agent onboarding in CLAUDE.md

## Validation

- CLI works via `npx cogni` against a running node (no monorepo clone needed)
- External agent with only an API token can list tasks, claim, and submit
- Same streams power both the dashboard UI and the CLI

## PR / Links

- Parent: story.0262 (agent contributor protocol)
- Related: task.0242 (VCS tool plane), story.0091 (manager agent)
- Primary research source: this conversation (task.0248 multi-agent coordination session)

## Attribution

-
