---
id: task.0346
type: task
title: "verify-candidate reads /readyz.buildSha, retires Loki app-started scrape"
status: needs_triage
priority: 2
rank: 50
estimate: 1
summary: "Replace the Loki `{msg=\"app started\"} | buildSha=…` log scrape as the proof-of-rollout gate with a direct HTTP read of /readyz.buildSha. Log scrape moves to post-fail forensic only."
outcome: "Flight workflows (candidate-flight.yml, flight-preview.yml) no longer depend on Loki log ingestion for their critical-path verify step. scripts/ci/verify-buildsha.sh reads .buildSha from /readyz (fallback to .version for one cycle). pr-coordinator skill proof-of-rollout step becomes a single curl + jq check."
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.observability-hardening
branch: feat/task-0339-verify-candidate-readyz
pr:
reviewer:
revision: 0
blocked_by: [task.0345]
deploy_verified: false
created: 2026-04-20
updated: 2026-04-20
labels: [ci-cd, observability]
external_refs:
---

# verify-candidate Reads /readyz.buildSha

## Context

Tonight (2026-04-19 → 20), proof-of-rollout for flights depended on:
1. Promote commit on `deploy/candidate-a` matching PR head SHA
2. Loki query: `{namespace="cogni-candidate-a"} |= "app started" | json | buildSha=<sha>`

When the MCP/Loki path is disconnected (as happened several times), the coordinator cannot verify rollout without asking the user to eyeball the URL. That's unacceptable for a "flight and confirm" contract.

The `/readyz.buildSha` field (introduced in task.0345) is the right primary signal:
- HTTP-reachable without MCP or log-ingest
- Returns 200 with the exact SHA the pod is running
- Already consumed by `verify-buildsha.sh` (currently reads `.version`)

## Scope

### 1. Update `scripts/ci/verify-buildsha.sh`

Read `.buildSha` first, fall back to `.version`:

```bash
ACTUAL=$(curl -fsS "$URL/readyz" | jq -r '.buildSha // .version // ""')
```

Drop the `.version` fallback after 1 release cycle (tracked in task.0345 deprecation note).

### 2. Flight workflows

No change needed — `candidate-flight.yml` and `flight-preview.yml` already call `verify-buildsha.sh`. That script already runs at the right point in the job graph.

### 3. pr-coordinator proof-of-rollout sequence

In `.claude/skills/pr-coordinator-v0/SKILL.md` "Proof of Rollout (REQUIRED)" section and the corresponding `MEMORY.md` entry, replace:

```
# old: Loki check
{namespace="..."} |= "app started" | json | buildSha="<PR head SHA>"
```

with:

```bash
curl -fsS "https://<app>-test.cognidao.org/readyz" | jq -e --arg sha "$PR_HEAD_SHA" '.buildSha == $sha'
```

Loki log query stays documented as the **forensic** path (why didn't the pod boot, what exception), not the gate.

### 4. Delete the Loki-scrape step from candidate-flight.yml's "Verify buildSha on endpoints"

Only if that step exists today and is duplicative with `verify-buildsha.sh`. Verify during implementation; skip if redundant.

## Validation

- exercise:
  - `bash scripts/ci/verify-buildsha.sh` against candidate-a serving `.buildSha`
  - Same script against a pre-0337 node serving only `.version` (simulate with a stub)
  - Dispatch a candidate-flight run with grafana MCP intentionally offline; confirm terminal outcome
- acceptance:
  - Flight verify step no longer queries Loki in its critical path.
  - `verify-buildsha.sh` reads `.buildSha` first, falls back to `.version`.
  - `.claude/skills/pr-coordinator-v0/SKILL.md` no longer lists Loki as the primary proof-of-rollout signal.

## Non-Goals

- Removing the Loki `app started` log emission from node-app bootstrap — keep it, valuable for forensics.
- Fixing verify-candidate Argo sync flakiness — task.0341.
- Publicly publishing `/metrics` without auth — stays bearer-authed.

## Related

- task.0345 — provides `.buildSha` field consumed here
- task.0347 — updates skill/guide docs
- task.0341 — independent Argo flakiness investigation
