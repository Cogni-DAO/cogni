# scripts/ops · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** stable

## Purpose

One-shot operator scripts that mutate remote git state outside the regular CI/CD pipeline. Distinct from `scripts/ci/` (workflow-invoked) and `scripts/setup/` (provisioning). Intended for occasional human-driven runs.

## Pointers

- [`bootstrap-per-node-deploy-branches.sh`](bootstrap-per-node-deploy-branches.sh): create + fast-forward `deploy/<env>-<node>` branches from each whole-slot `deploy/<env>` tip (task.0372 / `BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE`).

## Boundaries

```json
{
  "layer": "scripts",
  "may_import": [],
  "must_not_import": ["*"]
}
```

## Public Surface

- **Exports:** none (executable shell scripts only)
- **Env/Config keys:** `ENVS` (CSV, default `candidate-a,preview,production`); `DRY_RUN` (1 = print plan, no push); `BOOTSTRAP_ALLOW_DIVERGENCE` (1 = proceed past diverged per-node branches)

## Responsibilities

- This directory **does**: idempotent ops scripts that read/write `origin/deploy/*` refs.
- This directory **does not**: ship CI logic (lives in `scripts/ci/`), provision VMs (lives in `scripts/setup/`), or carry app build steps.

## Notes

- Run from a clean local clone with push access to `origin/deploy/*`.
