---
id: design.node-wizard-formation-wiring
type: design
title: "Node-Wizard Formation Wiring — born-green Temporal endpoint via node_id projection"
status: draft
created: 2026-06-10
skills:
  - ../../.claude/skills/node-wizard-expert/SKILL.md
  - ../../.claude/skills/devops-expert/SKILL.md
spec_refs:
  - ../spec/node-formation.md
  - ../spec/multi-node-tenancy.md
related:
  - ../../work/handoffs/manual-edits-ledger.node-wizard-2026-06-10.md
---

# Node-Wizard Formation Wiring

## Outcome

Success is when **a wizard-spawned submodule node is born with its scheduler-worker
Temporal endpoint registered**, so `chat/completions` works on candidate-a /
preview / production with **zero hand-edits** — the last formation gap to a
reproducibly-green node spawn.

## Problem (evidence)

The node-wizard mint **deliberately skips** splicing the scheduler-worker endpoint
(`nodes/operator/app/src/adapters/server/vcs/github-repo-write.ts:1184`):

> "a submodule node's identity lives in the minted repo's `.cogni/repo-spec.yaml`,
> not in the parent checkout. The parent renderer skips `.gitmodules` nodes until
> the catalog → NodeRegistry metadata projection lands, so inserting this endpoint
> here would make the generated PR fail the scheduler endpoint drift check."

Chain: `node_id` lives in the child repo-spec (`REPO_SPEC_IS_IDENTITY_SSOT`).
`image-tags.sh:69` reads it from `${path_prefix}.cogni/repo-spec.yaml`; for a
submodule that file is **absent at PR-gen + CI-render time** → `node_id=""` → the
node is dropped from `COGNI_NODE_ENDPOINTS`. The worker spins one Temporal worker
per `node_id` in that CSV, so the spawned node has **no worker** → `chat/completions`
enqueues a workflow nothing polls → hangs forever. Proven on candidate-a: oss
returned a haiku **only** after the endpoint was hand-added (ledger row 12).

The drift gate (`render-scheduler-worker-endpoints.sh --check`) passes anyway,
because configmap == renderer (both exclude the node). So CI is green while the
node is broken — a silent-success seam.

## SSOT model — web3 merkle → gitops merkle (the load-bearing rationalization)

`.cogni/repo-spec.yaml` is the node's **identity source of truth** and must stay
that way: it defines the node's **web3 mappings** — `node_id`, `scope_id`,
`dao_contract` / `plugin_contract` / `signal_contract`, `chain_id` — the
cryptographic, merkle-rooted identity that binds the on-chain DAO to its git tree.
Those bytes live in the minted repo and nowhere else. `REPO_SPEC_IS_IDENTITY_SSOT`
is unchanged.

But the *gitops deployment* also keys off that identity (Temporal queue =
`scheduler-tasks-<node_id>`, DB attribution, billing). The parent operator repo
needs `node_id` at **gitops-time** — PR-gen (Git Data API) and CI-render — exactly
where a submodule's repo-spec is unreadable. So we let identity **flow one way**:

```
repo-spec (web3 merkle root, in the minted repo)
   │  projected once, at mint, by the operator that authored both
   ▼
catalog node_id (gitops-merkle projection, in the parent repo)
   │  consumed by renderers/mint at gitops-time
   ▼  ── drift gate: catalog.node_id MUST equal repo-spec.node_id ──
```

The catalog `node_id` is a **one-way, drift-gated mirror** — never an authority. If
it disagrees with the repo-spec, the gate fails and the **web3 root wins** (CI red,
not a silent fork). This is the "web3 merkle → gitops merkle" bridge: the repo-spec
is the root; the catalog is a verified gitops-side hash of one field, present only
because the parent cannot read across the submodule boundary at render time. The
node-wizard mint — which generates *both* the repo-spec and the catalog entry in one
act — is the only writer, so the projection cannot drift at birth.

## Approach

**Project only `node_id` into the catalog as the drift-gated gitops mirror** above.
The catalog (`infra/catalog/<slug>.yaml`) is always parent-readable at PR-gen and
CI-render time. No other repo-spec field moves — identity stays whole in the
repo-spec; the catalog carries the single field gitops must resolve before the
submodule is checked out.

**Reuses:** the catalog-as-per-node-metadata pattern that **#1607** establishes
(`envs:` field, `task.5017`); the existing scheduler-endpoints generator
(`gens/scheduler-endpoints.ts`) + drift gate (`render-scheduler-worker-endpoints.sh`);
the mint's existing gen pipeline.

### Changes

1. **`infra/catalog/_schema.json`** — add optional `node_id` (uuid). It is a
   projection field, allowed only for `type:node` with a `path_prefix`.
2. **`gens/catalog.ts`** — emit `node_id` (the mint already generates it in
   `gens/repo-spec.ts`; thread it through). Drop the "schema forbids node_id" note.
3. **`scripts/ci/lib/image-tags.sh`** — `node_id_for_target` reads `node_id` from
   the **catalog** (parent-readable) with the repo-spec as fallback for in-repo
   nodes. Submodule nodes resolve from the catalog projection.
4. **Drift gate** — a CI check verifies `catalog.node_id == <node>/.cogni/repo-spec.yaml
   node_id` (submodule initialized in this one check, or verified against the child
   repo head) so the projection can never silently lie. `REPO_SPEC_IS_IDENTITY_SSOT`
   preserved.
5. **`github-repo-write.ts`** — remove the deliberate scheduler-endpoint skip
   (:1184); the mint now splices the endpoint using the catalog-projected `node_id`
   → matches the renderer → drift-clean.
6. **`render-scheduler-worker-endpoints.sh`** — **fail loud** when a `type:node`
   catalog entry has no resolvable `node_id` (kills the silent-drop seam).

### Rejected

- **Submodule init in CI render** — adds recursive-checkout cost to every render and
  still doesn't help the **operator mint** (Git Data API composes a tree; it cannot
  `git submodule update`). The mint already *has* `node_id` in memory; it just needs
  a parent-readable place to put it.
- **Runtime NodeRegistry (Postgres `nodes` table, task.5083)** — not available at
  CI-render / PR-gen time; it is a runtime view, not a git-time projection.
- **Hand-adding the endpoint (#1608)** — the drift gate correctly rejects it; the
  fix must be in the formation, not per-node.

## Invariants (review criteria)

- [ ] REPO_SPEC_IS_IDENTITY_SSOT: repo-spec remains the sole authority for the
      node's web3 identity (node_id, scope_id, dao/plugin/signal contracts, chain_id).
      Only `node_id` projects to the catalog, as a mirror (spec: multi-node-tenancy)
- [ ] IDENTITY_FLOWS_ONE_WAY: repo-spec → catalog `node_id`, never the reverse;
      drift gate fails CI on mismatch (web3 root wins, no silent fork)
- [ ] CATALOG_IS_SSOT: catalog is the parent-readable per-node *gitops* metadata SSOT
      (aligns with #1607 `envs:`); it mirrors — never defines — identity
- [ ] NO_SILENT_DROP: a `type:node` entry with unresolvable `node_id` fails the
      render/drift gate loudly (no node silently missing its worker)
- [ ] BORN_GREEN: the formation PR a wizard mints includes the scheduler endpoint;
      a flighted spawn reaches `chat/completions` success with zero hand-edits
- [ ] SIMPLE_SOLUTION: extends the catalog (one field) + reuses the existing
      generator/drift-gate; no new service or store
- [ ] ALIGNMENT_1606_1607: lands on/after #1607 (`envs:`); orthogonal to #1606
      (capacity)

## Files

- Modify: `infra/catalog/_schema.json` — allow `node_id` (projection field)
- Modify: `nodes/operator/app/src/shared/node-app-scaffold/gens/catalog.ts` — emit `node_id`
- Modify: `scripts/ci/lib/image-tags.sh` — resolve `node_id` from catalog (repo-spec fallback)
- Modify: `scripts/ci/render-scheduler-worker-endpoints.sh` — fail-loud on missing `node_id`
- Modify: `nodes/operator/app/src/adapters/server/vcs/github-repo-write.ts` — splice endpoint (remove :1184 skip)
- Add: catalog `node_id` ↔ repo-spec drift check (CI)
- Backfill: `node_id` into existing `type:node` catalog entries (incl oss)
- Test: scheduler-endpoints gen includes a submodule node; drift gate fails on mismatch/missing

## E2E validation signal

After implement: flight a fresh spawn (or re-flight oss) to candidate-a with **no
manual scheduler edit** → `COGNI_NODE_ENDPOINTS` carries the node from the formation
PR → worker polls its queue → `chat/completions` returns a completion. Repeat on
preview (born-correct #1584) to prove env-independence.
