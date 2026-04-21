---
id: task.0347
type: task
title: "Propagate buildSha surface alignment to skill + guide docs"
status: needs_triage
priority: 3
rank: 50
estimate: 1
summary: "Update agent-api-validation guide, candidate-flight guide, pr-coordinator-v0 skill (SKILL.md + MEMORY.md), and the contributor guide to document the buildSha surfaces and the /readyz.buildSha proof-of-rollout pattern."
outcome: "A new contributor reading CONTRIBUTING.md + docs/guides/agent-api-validation.md + the pr-coordinator skill understands: (1) every node-app must wire APP_BUILD_SHA through /readyz, /api/metrics, and .well-known/agent.json; (2) flight proof-of-rollout is a curl on /readyz.buildSha, not a Loki query."
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.observability-hardening
branch: feat/task-0340-buildsha-skill-docs
pr:
reviewer:
revision: 0
blocked_by: [task.0345, task.0346]
deploy_verified: false
created: 2026-04-20
updated: 2026-04-20
labels: [docs]
external_refs:
---

# buildSha Docs Propagation

## Scope

### 1. `docs/guides/agent-api-validation.md`

Add a "Published build info" section. Each node exposes `buildSha` at three endpoints (unauthed `/readyz` and `.well-known/agent.json`; authed `/api/metrics` via bearer token). Include curl examples.

### 2. `docs/guides/candidate-flight-v0.md`

Update the "Proof of rollout" section: primary signal is `/readyz.buildSha`; Loki log scrape is forensic-only.

### 3. `.claude/skills/pr-coordinator-v0/SKILL.md`

Replace the "Proof of Rollout (REQUIRED)" block. New sequence:

```
1. gh run view <id> --json conclusion   # flight+verify terminal states
2. git log origin/deploy/candidate-a -1 # promote commit references PR head SHA
3. curl /readyz | jq .buildSha == <PR head SHA>   # ← primary, was Loki
```

### 4. `.claude/skills/pr-coordinator-v0/MEMORY.md`

Update the "NEVER claim a flight is healthy" entry to reflect the new proof-of-rollout primitive. Keep the Loki query documented but tag it "forensic, not gate."

### 5. `CONTRIBUTING.md` (or `docs/guides/agents-context.md` — confirm during implementation)

Add a one-paragraph callout: "Publishing your build info" — every new node-app must emit `APP_BUILD_SHA` via all three surfaces or CI verify-candidate will not know what's running.

## Validation

- exercise:
  - `pnpm check:docs`
  - `grep -rE "app started.*buildSha" docs/ .claude/skills/ | wc -l` returns 0 (no remaining "Loki is primary" guidance)
- acceptance:
  - A reader searching "buildSha" across `docs/` and `.claude/skills/` finds consistent guidance in every hit.
  - `CONTRIBUTING.md` (or `docs/guides/agents-context.md`) has a short "Publishing your build info" callout referencing all three surfaces.

## Non-Goals

- Introducing new skills — only update existing.
- Rewriting unrelated sections of the guides.

## Related

- task.0345, task.0346 — blockers
