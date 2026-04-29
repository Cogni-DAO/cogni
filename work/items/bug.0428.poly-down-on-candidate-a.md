---
id: bug.0428
type: bug
title: "Poly is hard-down on candidate-a (502 from all endpoints) — blocks every flight that promotes poly"
status: needs_triage
priority: 1
rank: 10
estimate: 2
summary: "All three of poly's HTTP endpoints on candidate-a return HTTP 502 with empty body: `/livez`, `/readyz`, `/version`. Operator and resy on the same VM return 200. Poly-promoting flights (e.g. run 25094993506) fail at the `verify-candidate` smoke step with `[ERROR] poly livez did not return expected JSON` — which is a true positive: the smoke gate is correctly reporting that poly is unreachable. Confirmed against `https://poly-test.cognidao.org/{livez,readyz,version}` at the time of filing. Issue is not the smoke check; the smoke check is the only thing telling us poly is down. Likely root cause: app pod crashlooping (recent breaking change in poly's bootstrap or doltgres-port refactor lineage from PR 1343ab7c)."
outcome: "Poly serves valid JSON from `/livez` + `/readyz` + `/version` on candidate-a. `verify-candidate (candidate-a, poly)` smoke step passes for any PR that promotes poly. Other PRs no longer get tripped by an unrelated poly outage."
spec_refs:
  - ci-cd-spec
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-29
updated: 2026-04-29
labels: [poly, candidate-a, flight, smoke, outage]
external_refs:
  - https://github.com/Cogni-DAO/node-template/actions/runs/25094993506
  - https://github.com/Cogni-DAO/node-template/actions/runs/25090855798
  - scripts/ci/smoke-candidate.sh
  - nodes/poly/app/src/bootstrap/
---

# bug.0428 — Poly is down on candidate-a; smoke check correctly reports it

## How it surfaces

`verify-candidate (candidate-a, poly)` step `Run candidate smoke checks (per-node)`:

```
poly livez:
[ERROR] poly livez did not return expected JSON
##[error]Process completed with exit code 1.
```

The empty body upstream of the smoke check is the actual signal. Live evidence at filing time (2026-04-29 ~07:00 UTC):

```
$ curl -s -o /dev/null -w "%{http_code} %{size_download}b\n" https://poly-test.cognidao.org/livez   → 502 0b
$ curl -s -o /dev/null -w "%{http_code} %{size_download}b\n" https://poly-test.cognidao.org/readyz  → 502 0b
$ curl -s -o /dev/null -w "%{http_code} %{size_download}b\n" https://poly-test.cognidao.org/version → 502 0b
$ curl -s -o /dev/null -w "%{http_code} %{size_download}b\n" https://test.cognidao.org/livez        → 200 57b   (operator OK)
$ curl -s -o /dev/null -w "%{http_code} %{size_download}b\n" https://resy-test.cognidao.org/livez   → 200 57b   (resy OK)
```

Ingress is up (it's returning 502, not connection refused) — no Ready endpoints behind the poly-node-app Service.

## How this is tripping unrelated PRs

Per Axiom 19, every promoted-app verify-candidate cell must observe its own `/version.buildSha`. Poly-promoting PRs (most PRs, given affected-only over-fan-out on lockfile changes) fail at the smoke step before they ever get to `verify-buildsha`. The smoke gate is doing its job — but the underlying outage means any PR that touches poly's image cannot flight green until poly is fixed.

A reasonable mitigation while the root-cause fix lands: relax `smoke-candidate.sh` to a warning-only step (still emit `::warning::` but exit 0 if the only failing app is the one we're explicitly trying to verify via verify-buildsha). This is a band-aid; the right fix is restoring poly. Out of scope for this bug; would be a separate task if we choose to land it.

## Root cause hypothesis (needs confirmation via VM SSH)

PR 1343ab7c (`fix(task.0424): route doltgres port through @/ports/server barrel`) merged earlier today and the original failure (run 25090855798) attributed it to that refactor breaking poly's bootstrap. PRs since then have promoted poly multiple times; if the breaking change is still in-tree on poly's path, every poly pod since 1343ab7c starts → crashes → backoff. Need to:

1. SSH read-only to candidate-a VM
2. `kubectl -n cogni-candidate-a logs poly-node-app-<pod> -c app --previous --tail=50`
3. Diagnose container-level crash reason

I have not done this yet — keeping scope to filing the bug per the dev's recommendation. Whoever picks this up should start there.

## Acceptance

- `curl https://poly-test.cognidao.org/livez` returns HTTP 200 with `{"status":"ok"}` (or equivalent shape per `check_livez` in `scripts/ci/smoke-candidate.sh`).
- A new candidate-flight that promotes poly passes its `verify-candidate (candidate-a, poly)` cell end-to-end (smoke + verify-buildsha + readiness).
- `bug.0428` set to `done`, `deploy_verified: true` after observing the green flight on a real PR.

## Out of scope

- Adjusting `smoke-candidate.sh` semantics (the script is correct; the app is broken).
- Wider doltgres-port-refactor cleanup (separate task).
- Cross-PR concurrency race (covered by PR #1135).
