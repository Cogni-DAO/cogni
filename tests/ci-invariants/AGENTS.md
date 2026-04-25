# ci-invariants · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** stable

## Purpose

Static structural tests that pin CI-side policy invariants (workflow shape, action SHA-pins, fixture-asserted classifier behavior) so policy drift between docs, workflow YAML, and runtime resolvers fails the local + CI gate.

## Pointers

- [.github/workflows/ci.yaml](../../.github/workflows/ci.yaml) — the workflows these tests pin
- [docs/spec/node-ci-cd-contract.md](../../docs/spec/node-ci-cd-contract.md) — the invariants
- [work/items/task.0381.\*](../../work/items/) — single-node-scope rationale

## Boundaries

```json
{
  "layer": "tests",
  "may_import": ["*"],
  "must_not_import": []
}
```

## Public Surface

- **Exports:** `classify(paths, nonOperatorNodes) → ClassifyResult` from `classify.ts` — reference TS implementation of the single-node-scope policy. Imported by parity tests; task.0382's runtime resolver must produce identical results on the same fixtures.
- **Fixtures:** `fixtures/single-node-scope/*.json` — shared diff fixtures (the contract surface task.0382 must match).
- **Routes (if any):** none
- **Env/Config keys:** none

## Responsibilities

- This directory **does**: pin workflow filter lists to `nodes/*` listing, assert action SHA-pinning, replay shared fixtures through a reference classifier.
- This directory **does not**: invoke GitHub Actions, shell out to `git`, or run network I/O.

## Notes

- Adding a new node directory under `nodes/` requires updating `.github/workflows/ci.yaml` (single-node-scope filters) — the meta-test fails until both sides match.
- When task.0382 lands, replace the `it.todo` cases in `single-node-scope-parity.spec.ts` with real assertions using the runtime resolver against the same fixtures.
