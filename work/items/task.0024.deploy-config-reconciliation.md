---
id: task.0024
type: task
title: Deploy-time config reconciliation — hash-based apply for bind-mounted services
status: needs_triage
priority: 0
estimate: 2
summary: "Single-file bind mounts can pin the old inode after atomic replace (rsync temp→rename); containers keep running stale config. deploy.sh has no mechanism to detect config changes and apply them. Directory mounts avoid the inode issue — prefer those for configs."
outcome: When a config file changes between deploys, the affected container is recreated or reloaded automatically. No more stale configs.
spec_refs: [observability]
assignees: []
credit:
project: proj.reliability
branch:
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [infra, deploy, reliability]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 14
---

# Deploy-time config reconciliation

## Requirements

- Generic `config_reconcile()` function replaces bespoke LiteLLM (deploy.sh:688-711), Caddy (deploy.sh:548-564), and Alloy reload handlers
- Service registry declares: service name, config input paths, apply mode (`recreate` or `reload_http`), reload URL, optional verify
- On deploy: hash inputs per service → compare to stored hash → if changed, apply → fail closed on error → persist new hash
- Each apply emits structured log: `{service, oldHash, newHash, mode, result}`
- Prefer directory mounts over single-file mounts for configs (avoids inode pinning)

## Apply Modes

- **`recreate`**: container recreation via hash-in-spec strategy. Compute `desiredHash` from input dirs/files (`find|sort|sha256`), inject as env/label (`CFG_SHA_<svc>=<hash>`) in a compose override, then `docker compose up -d`. Changed hash = changed service spec = Compose recreates only that container.
- **`reload_http`**: POST to native reload endpoint (e.g. Alloy `POST http://127.0.0.1:12345/-/reload`). Non-2xx = deploy failure.

**Alloy**: `reload_http` by default; fall back to `recreate` only if reload endpoint unavailable.
**LiteLLM, Caddy**: `recreate` (hash-in-spec).

## Invariants

- `DIFF_IMPLIES_APPLY`: desired hash ≠ last-applied hash → deploy must apply and fail closed on error
- `NO_RSYNC_ONLY_SUCCESS`: deploy succeeds only if running services reflect desired config hashes
- `APPLY_IS_OBSERVABLE`: every config apply is logged with service/hash/mode/result
- `APPLY_IMPLIES_RUNTIME_MATCH`: after apply, verify container-visible config matches desired (docker exec sha256 or service health check)
- `PREFER_DIR_MOUNTS_FOR_CONFIG`: use directory bind mounts where possible to avoid single-file inode pinning

## Allowed Changes

- `platform/ci/scripts/deploy.sh` — add generic reconciliation, remove bespoke handlers
- Compose override generation for hash-in-spec
- Hash storage at `/var/lib/cogni/config-hashes/<service>.sha` on VM

## Plan

- [ ] Define service registry (inline array in deploy-remote.sh heredoc)
- [ ] Implement `config_reconcile()`: hash inputs → compare → apply (recreate or reload_http) → verify runtime match → persist
- [ ] Register services: Alloy (`reload_http`), LiteLLM (`recreate`), Caddy (`recreate`)
- [ ] Implement hash-in-spec: generate compose override with `CFG_SHA_<svc>` env vars
- [ ] Remove bespoke LiteLLM and Caddy handlers
- [ ] Test: change Alloy config → deploy → confirm reload + runtime match

## Validation

**Command:**

```bash
# On VM after deploy with changed alloy config:
docker exec cogni-runtime-alloy-1 cat /etc/alloy/config.alloy | sha256sum
# Must match host file hash
```

**Expected:** Changed config files trigger reconciliation. Alloy reloads via HTTP. LiteLLM/Caddy recreated via hash-in-spec. Hash files persisted to `/var/lib/cogni/config-hashes/`.

## Review Checklist

- [ ] **Work Item:** `task.0024` linked in PR body
- [ ] **Spec:** observability invariants upheld
- [ ] **Tests:** manual deploy with config change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Supersedes plan in: bug.0017 (deploy config reload gap)
- Related: task.0018 (dynamic agent catalog — new services will need registry entries)

## Attribution

-
