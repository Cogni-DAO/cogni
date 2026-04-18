---
id: bug.0317
type: bug
title: "candidate-flight-infra.yml checks out main, so a feature branch cannot ship new env/secret plumbing via the infra lever"
status: needs_triage
priority: 2
rank: 99
estimate: 2
created: 2026-04-18
updated: 2026-04-18
summary: "The infra lever (`.github/workflows/candidate-flight-infra.yml`) checks out `ref: main` before running `scripts/ci/deploy-infra.sh`, so new env/secret plumbing that lives on a feature branch (e.g. adding `POLY_PROTO_*` to the SECEOF heredoc + to the workflow's `env:` block) never reaches candidate-a until those changes are merged to main. Caught on task.0315 CP4.25 flight: GH environment secrets had been set correctly, but the poly pod booted with all capability flags false because the deploy-infra.sh version that ran from main didn't know about the new secret keys and the workflow's env: block didn't surface them. Had to hotfix with a direct SSH `kubectl patch` to unblock the flight."
outcome: "Infra lever can deploy env/secret changes from a feature branch for validation purposes, without requiring pre-merge to main. Either: (a) make the workflow accept `ref` as a true input that also controls the `actions/checkout` step, (b) cut a narrow path where certain files (workflow + deploy-infra.sh) always come from the dispatched ref instead of main, or (c) document that infra plumbing changes must land on main first and update task/PR flows accordingly. Whichever path is chosen, the failure mode of 'secrets set on env but deploy-infra.sh on main doesn't know about them' must produce a loud error, not a silently-booting pod."
spec_refs: []
assignees: []
project: proj.cicd-services-gitops
related:
  - task.0315
  - https://github.com/Cogni-DAO/node-template/pull/900
labels: [ci-cd, infra, candidate-flight, hotfix-followup]
---

# bug.0317 — candidate-flight-infra.yml hardcoded to main

## Repro

1. On feature branch, add a new env var to `scripts/ci/deploy-infra.sh` SECEOF heredoc + to the `env:` block of `.github/workflows/candidate-flight-infra.yml`.
2. Set the value as a GH environment secret on `candidate-a`.
3. Push the feature branch.
4. workflow_dispatch candidate-flight-infra against the feature branch ref.
5. Observe: the workflow runs, the deploy script runs, but the new env var is NOT in the resulting per-node k8s Secret. The pod boots without the new env.

## Root cause

`.github/workflows/candidate-flight-infra.yml` lines ~100–103:

```yaml
- name: Checkout (for scripts)
  uses: actions/checkout@...
  with:
    ref: main
    fetch-depth: 0
```

The `inputs.ref` CLI arg is only passed to `deploy-infra.sh --ref` for rsyncing `infra/compose/**`; the deploy-infra.sh file ITSELF runs from main, and the workflow's top-level `env:` block (which surfaces GH secrets into the script's process env) also reflects main. So any feature-branch changes to either the script or the workflow are silently ignored by candidate-flight-infra.

## Evidence

task.0315 CP4.25 flight on 2026-04-18:

- Secrets `POLY_PROTO_*` + `POLY_CLOB_*` set on `candidate-a` GH env (verified via `gh secret list`).
- Feature branch PR #900 added those 7 vars to both the workflow `env:` block and the deploy-infra.sh heredoc.
- After standard candidate-flight + candidate-flight-infra, poly pod boot log: `poly.trade.capability.unavailable has_operator_wallet=false has_clob_creds=false has_privy=false`.
- Unblock required SSH + `kubectl patch secret poly-node-app-secrets --type=merge` from a locally-built JSON patch, then `kubectl rollout restart`. Post-patch log: `poly.trade.capability.env_ok`.

## Options

(a) Make checkout step honor `inputs.ref` so the workflow + scripts both come from the dispatched ref. Simple, but raises the supply-chain surface: a feature branch can modify what the infra lever does when targeted at its ref. Mitigation: environment protection rules already require approval.

(b) Narrow overlay — keep checkout on main for everything EXCEPT the specific files that dictate env plumbing (workflow + deploy-infra.sh + k8s overlay), which come from the ref. Complex; likely out of proportion.

(c) Keep current behavior, document it loudly, and introduce a validation step: after deploy-infra applies the secret, script exec's into each pod and asserts all expected keys are present in env, failing the workflow if any are missing.

Recommended: (c) first (fast, prevents silent failures), then (a) as the follow-up once environment protection rules are in place.

## Validation

Fixed when: a feature-branch PR that adds a new `POLY_PROTO_*`-shaped env var to the SECEOF heredoc + workflow `env:` block can flight to candidate-a without any SSH-hotfix intervention. CI log asserts the pod's env contains all expected keys; if any are missing, the workflow fails with a clear message naming the missing key(s).

## Related

- [bug.0318](./bug.0318.rename-canary-to-candidate-a.md) — parallel infra-naming cleanup
- [task.0315](./task.0315.poly-copy-trade-prototype.md) — caller that hit this
- PR #900
