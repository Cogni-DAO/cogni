---
id: task.0346
type: task
title: "verify-candidate reads /api/metrics build_info, retires Loki scrape"
status: needs_triage
priority: 2
rank: 50
estimate: 1
summary: 'Replace the Loki `{msg="app started"} | buildSha=…` log scrape as the proof-of-rollout gate with direct HTTP read of /api/metrics app_build_info. Log scrape moves to post-fail forensic only. /readyz.version is deprecated.'
outcome: "Flight workflows (candidate-flight.yml, flight-preview.yml) no longer depend on Loki log ingestion for their critical-path verify step. scripts/ci/verify-buildsha.sh reads app_build_info from /metrics. pr-coordinator skill proof-of-rollout step becomes a metrics scrape query. /readyz.version deprecated — do not use."
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/observability.md
assignees: []
credit:
project: proj.observability-hardening
branch: feat/task-0346-metrics-buildsha
pr:
reviewer:
revision: 0
blocked_by: [task.0345]
deploy_verified: false
created: 2026-04-20
updated: 2026-04-21
labels: [ci-cd, observability]
external_refs:
---

# verify-candidate Reads /api/metrics build_info

## Context

**Canonical source:** `/api/metrics` returns `app_build_info{version,commit_sha}` per BUILD_SHA_IN_METRICS invariant.

Tonight (2026-04-19 → 20), proof-of-rollout for flights depended on:

1. Promote commit on `deploy/candidate-a` matching PR head SHA
2. Loki query: `{namespace="cogni-candidate-a"} |= "app started" | json | buildSha=<sha>`

When the MCP/Loki path is disconnected (as happened several times), the coordinator cannot verify rollout without asking the user to eyeball the URL. That's unacceptable for a "flight and confirm" contract.

**`/readyz.version` is deprecated.** Use `/api/metrics` for build verification.

## Scope

### 1. Update `scripts/ci/verify-buildsha.sh`

Read `app_build_info` from `/metrics` (Bearer auth required):

```bash
# Query /metrics for app_build_info{commit_sha="..."}
ACTUAL=$(curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" \
  "$URL/api/metrics" | grep "^app_build_info{" | grep -o 'commit_sha="[^"]*"' | cut -d'"' -f2)
```

Fallback to `/readyz.version` only for pre-task.0345 images (deprecated path).

### 2. Flight workflows

No change needed — `candidate-flight.yml` and `flight-preview.yml` already call `verify-buildsha.sh`. That script already runs at the right point in the job graph.

### 3. pr-coordinator proof-of-rollout sequence

In `.claude/skills/pr-coordinator-v0/SKILL.md` "Proof of Rollout (REQUIRED)" section:

Query metrics scrape from Loki (the canonical path via Prometheus → Loki):

```logql
{namespace="cogni-candidate-a"} |= "app_build_info{" | json | commit_sha = "<PR head SHA>"
```

Or direct HTTP (requires METRICS_TOKEN):

```bash
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" \
  "https://<app>-test.cognidao.org/api/metrics" | grep "^app_build_info{"
```

Loki log query stays documented as the **forensic** path (why didn't the pod boot, what exception), not the gate.

### 4. Delete the Loki-scrape step from candidate-flight.yml's "Verify buildSha on endpoints"

Only if that step exists today and is duplicative with `verify-buildsha.sh`. Verify during implementation; skip if redundant.

## Validation

- exercise:
  - `bash scripts/ci/verify-buildsha.sh` against candidate-a with METRICS_TOKEN
  - Query Loki for `app_build_info{commit_sha="<SHA>"}` in candidate-a namespace
  - Dispatch a candidate-flight run with grafana MCP intentionally offline; confirm terminal outcome using direct /metrics curl
- acceptance:
  - Flight verify step reads `/api/metrics` for build verification.
  - `scripts/ci/verify-buildsha.sh` queries `/metrics` for `app_build_info` (not `/readyz`).
  - `.claude/skills/pr-coordinator-v0/SKILL.md` uses `/metrics` as primary proof-of-rollout signal.

## Non-Goals

- Removing the Loki `app started` log emission from node-app bootstrap — keep it, valuable for forensics.
- Fixing verify-candidate Argo sync flakiness — task.0341.
- Publicly publishing `/metrics` without auth — stays bearer-authed.

## Related

- task.0345 — provides `app_build_info` metric consumed here
- docs/spec/observability.md — BUILD_SHA_IN_MENTRICS invariant
- task.0341 — independent Argo flakiness investigation
