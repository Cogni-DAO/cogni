---
id: bug.0201
type: bug
title: "Runbook gap: secret changes require container recreation, not just workflow re-runs"
status: needs_implement
priority: 2
rank: 10
estimate: 1
summary: "After updating GitHub secrets, re-running a failed deploy does not update already-running containers — `docker compose up -d` is a no-op for running services unless image/config changes. Operators must trigger fresh deploys that recreate containers, not re-run old workflows. This cost multiple wasted 30-min deploy cycles during the secret regeneration incident."
outcome: "Deploy runbook and SECRET_ROTATION.md document that secret changes require container recreation. deploy.sh forces container recreation after .env writes (e.g. `docker compose up -d --force-recreate` for affected services)."
spec_refs: []
assignees: derekg1729
credit:
project: proj.reliability
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [deploy, documentation, reliability, p2]
external_refs:
  - pm.secret-regen-cascade.2026-03-25
---

# Runbook gap: secret changes require container recreation

## Bug

After updating GitHub secrets and re-running a failed deploy, the containers continued running with stale environment variables. `docker compose up -d` does not restart already-running containers when only `.env` values change — it's a no-op unless the image or compose config changes. This is not documented in our runbooks. During the secret regeneration incident (pm.secret-regen-cascade.2026-03-25), multiple re-runs were attempted after updating secrets, wasting ~30 min per failed cycle.

## Requirements

- Document in `docs/runbooks/SECRET_ROTATION.md`: after changing secrets, trigger a **fresh** deploy that forces container recreation
- Document in `docs/runbooks/INFRASTRUCTURE_SETUP.md` same warning
- Consider: `deploy.sh` should use `docker compose up -d --force-recreate` (or equivalent) after writing `.env` to ensure containers pick up new values

## Validation

Verify the warning is documented in both runbooks and `deploy.sh` logs a warning on re-runs.

## Allowed Changes

- `docs/runbooks/SECRET_ROTATION.md`
- `docs/runbooks/INFRASTRUCTURE_SETUP.md`
- `scripts/ci/deploy.sh` (optional warning)
