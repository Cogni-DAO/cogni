---
id: task.0347
type: task
title: "Propagate buildSha surface alignment to skill + guide docs"
status: needs_triage
priority: 3
rank: 50
estimate: 1
summary: "Update agent-api-validation guide, candidate-flight guide, pr-coordinator-v0 skill (SKILL.md + MEMORY.md), and the contributor guide to document the buildSha surfaces and the /api/metrics app_build_info proof-of-rollout pattern. /readyz.version is deprecated."
outcome: "A new contributor reading CONTRIBUTING.md + docs/guides/agent-api-validation.md + the pr-coordinator skill understands: (1) every node-app must wire APP_BUILD_SHA through /api/metrics (canonical), .well-known/agent.json, and /readyz (deprecated); (2) flight proof-of-rollout queries /api/metrics for app_build_info, not /readyz."
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/observability.md
assignees: []
credit:
project: proj.observability-hardening
branch: feat/task-0347-buildsha-docs
pr:
reviewer:
revision: 0
blocked_by: [task.0345, task.0346]
deploy_verified: false
created: 2026-04-20
updated: 2026-04-21
labels: [docs]
external_refs:
---

# buildSha Docs Propagation

## Scope

### 1. `docs/guides/agent-api-validation.md`

Add a "Published build info" section. Canonical source is `/api/metrics` returning `app_build_info{version,commit_sha}` (Bearer auth required). Include curl examples. Note: `/readyz.version` is deprecated.

### 2. `docs/guides/candidate-flight-v0.md`

Update the "Proof of rollout" section: primary signal is `/api/metrics` → `app_build_info{commit_sha}`; Loki log scrape is forensic-only.

### 3. `.claude/skills/pr-coordinator-v0/SKILL.md`

Replace the "Proof of Rollout (REQUIRED)" block. New sequence:

```
1. gh run view <id> --json conclusion   # flight+verify terminal states
2. git log origin/deploy/candidate-a -1 # promote commit references PR head SHA
3. curl -H "Authorization: Bearer $METRICS_TOKEN" /api/metrics | grep app_build_info   # ← primary, was Loki
```

### 4. `.claude/skills/pr-coordinator-v0/MEMORY.md`

Update the "NEVER claim a flight is healthy" entry to reflect the new proof-of-rollout primitive. Keep the Loki query documented but tag it "forensic, not gate."

### 5. `CONTRIBUTING.md` (or `docs/guides/agents-context.md` — confirm during implementation)

Add a one-paragraph callout: "Publishing your build info" — every new node-app must emit `APP_BUILD_SHA` via `/api/metrics` as `app_build_info{version,commit_sha}` or CI verify-candidate will not know what's running.

## Validation

- exercise:
  - `pnpm check:docs`
  - `grep -rE "readyz.*version.*primary" docs/ .claude/skills/ | wc -l` returns 0 (deprecated)
- acceptance:
  - A reader searching "buildSha" or "app_build_info" across `docs/` and `.claude/skills/` finds consistent guidance in every hit.
  - `CONTRIBUTING.md` (or `docs/guides/agents-context.md`) has a short "Publishing your build info" callout referencing `/api/metrics` as canonical.

## Non-Goals

- Introducing new skills — only update existing.
- Rewriting unrelated sections of the guides.

## Related

- task.0345, task.0346 — blockers
- docs/spec/observability.md — BUILD_SHA_IN_METRICS invariant
