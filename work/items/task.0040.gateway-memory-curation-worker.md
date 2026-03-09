---
id: task.0040
type: task
title: "Gateway memory curation worker — scan ephemeral state, persist valuable context, reset container"
status: needs_triage
priority: 2
estimate: 3
summary: "Periodic worker that scans the gateway container's ephemeral memory (daily logs, gitignored artifacts), extracts valuable snippets into durable storage (MEMORY.md or git), then resets the container to a clean state."
outcome: "Durable insights from gateway conversations are automatically persisted before container resets. No silent knowledge loss. Agent starts fresh but retains curated context."
spec_refs: [openclaw-workspace-spec]
assignees: []
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [openclaw, memory, automation]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 12
---

# Gateway memory curation worker

## Problem

The gateway agent accumulates valuable context during conversations — architecture decisions, debugging insights, project conventions — in OpenClaw's auto-populated `memory/` directory (daily markdown logs at `memory/YYYY-MM-DD.md`). This directory is ephemeral: gitignored, lost on container hard-reset. Git is the source of truth, so anything not committed doesn't survive.

Currently, durable insights must be manually curated into `MEMORY.md`. This means knowledge is silently lost whenever the container resets.

## Requirements

- Periodic scan of the gateway container's ephemeral state (`/workspace/gateway/memory/`)
- Extract valuable snippets: architecture decisions, confirmed patterns, debugging insights, user preferences
- Filter out noise: routine conversation, transient task context, redundant information
- Persist extracted context durably (options: update MEMORY.md via PR, write to a dedicated store)
- Reset the container to a clean state after successful extraction
- No data loss — extraction must complete before reset

## Design Considerations

- **Where to run**: Could be a host-side cron job, a scheduler-worker activity, or a sidecar. Host-side is simplest (docker exec + git).
- **LLM-assisted curation**: Use an LLM to read the daily logs and decide what's worth keeping vs. noise. Cheaper model is fine for summarization.
- **Persistence target**: Most natural target is `MEMORY.md` in the gateway-workspace (already in git). Could also write to a separate `knowledge/` area or a database.
- **PR workflow**: Extracted insights could be proposed as a PR for human review before merging into MEMORY.md — maintains human oversight of what the agent "remembers."
- **Reset strategy**: `docker compose restart openclaw-gateway` after successful extraction. Or `docker compose up -d --force-recreate openclaw-gateway` for a full reset.
- **Frequency**: Daily is likely sufficient. The daily logs are already date-partitioned.

## Open Questions

- Should the worker create PRs for human review, or auto-commit directly to MEMORY.md?
- Should it also scan other ephemeral artifacts (e.g., `/tmp/` debug logs, workspace state)?
- What's the right deduplication strategy to prevent MEMORY.md from growing unbounded?
- Should this integrate with the existing scheduler-worker (Temporal activity) or be standalone?

## Validation

- [ ] Worker runs on schedule, reads gateway `memory/` daily logs
- [ ] Valuable snippets extracted and persisted (MEMORY.md or PR)
- [ ] Container reset after successful extraction
- [ ] No data loss — extraction completes before reset
- [ ] MEMORY.md doesn't grow unbounded (deduplication)

## Plan

_To be designed during implementation._

## Attribution

- Concept: derekg1729
