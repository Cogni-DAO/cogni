---
id: design.node-wizard-formation-wiring
type: design
title: "Graph-Execution Routing as a Per-Node Substrate (born-green Temporal wiring)"
status: draft
created: 2026-06-10
skills:
  - ../../.claude/skills/node-wizard-expert/SKILL.md
  - ../../.claude/skills/devops-expert/SKILL.md
spec_refs:
  - ../spec/node-baas-architecture.md
  - ../spec/node-formation.md
related:
  - ../../work/handoffs/manual-edits-ledger.node-wizard-2026-06-10.md
---

# Graph-Execution Routing as a Per-Node Substrate

## Outcome

Success is when **a wizard-spawned node's Temporal worker routing is provisioned
as substrate** — so `chat/completions` works on candidate-a / preview / production
with **zero hand-edits**, the last gap to a reproducibly-green node spawn.

## The reframe (why the earlier draft was wrong)

The first draft of this design invented a catalog `node_id` projection + a "web3
merkle → gitops merkle" SSOT story. That mis-modeled the problem. **There was never
a SSOT for Temporal wiring** — `COGNI_NODE_ENDPOINTS` was a hand-maintained,
catalog-rendered configmap (stale at 3 of 10 nodes). The correct model, from
[`node-baas-architecture.md`](../spec/node-baas-architecture.md) §BaaS Substrate Map:

| Substrate | Node declares | Operator provides |
| --- | --- | --- |
| Postgres | migrations, DSNs | per-node DB, roles → `COGNI_NODE_DBS` |
| Doltgres | migrations, domains | per-node `knowledge_<node>` |
| **Graphs** | `packages/graphs` | **execution host, ROUTING, observability** |
| Gateway | ports, health | Caddy route |
| Secrets | key shape | OpenBao values, ESO |

**Graph execution is a managed substrate**, and the scheduler-worker polling a
node's `scheduler-tasks-<node_id>` queue **is the "routing" the operator provides.**
So Temporal wiring belongs exactly where Postgres/Doltgres/Secrets/Gateway wiring
already lives — the **per-node substrate reconciler**, not a git-rendered configmap
and not the mint.

Identity is untouched: `repo-spec.yaml` stays the node's identity SSOT (`node_id` +
on-chain bindings), already consumed at runtime for **billing attribution**. The
reconciler simply **reads `node_id` from repo-spec at reconcile time** — when the
submodule IS initialized (during flight), unlike at PR-gen — and uses it to
provision routing. `node_id` flows repo-spec → substrate exactly as it flows
repo-spec → billing. No projection, no new SSOT.

## Approach

Make graph-execution routing a per-node substrate, parallel to `COGNI_NODE_DBS`.

1. **`reconcile-node-substrate.sh`** — when it reconciles a node (it already appends
   the node's DB to `COGNI_NODE_DBS` at line ~314), it also **registers the node's
   Temporal routing**: read `node_id` from `nodes/<slug>/.cogni/repo-spec.yaml`,
   add `<slug>=<url>,<node_id>=<url>` to the scheduler-worker's endpoint inventory,
   bounce the worker.
2. **Scheduler-worker reads its inventory from the provision-owned source** (a
   reconciler-managed ConfigMap, or — endgame — the node registry), **not** the
   catalog-rendered Argo configmap. This is the same provision-vs-deploy split that
   #1607 drew for AppSets: the node inventory is provision-owned, not deploy-owned.
3. **Retire** the catalog-rendered `COGNI_NODE_ENDPOINTS` configmap +
   `render-scheduler-worker-endpoints.sh` drift gate — wrong plane (deploy-time git
   for a provision-time substrate). The drift class disappears with it.
4. **Keep the mint's skip** (`github-repo-write.ts:1184`) — the mint correctly does
   NOT author routing; substrate is the operator/reconciler's job. The comment's
   "until the projection lands" resolves to "the reconciler provisions it."

### Endgame (top-0.1%)

The scheduler-worker **dynamically discovers** its node set from the node registry
(Postgres `nodes` table, task.5083), starting/stopping a per-node worker as nodes
register/deregister and scaling concurrency by per-node queue depth. Then "wired" =
"provisioned + registered" — zero static config, zero drift class, load auto-scales.
Step 1–3 above are the substrate-reconcile increment that gets us there without the
runtime registry dependency.

## Rejected

- **Catalog `node_id` projection / "gitops merkle" SSOT (this design's own first
  draft):** invents a git-time identity SSOT for what is reconcile-time substrate.
  `node_id` is identity (repo-spec, billing); routing is substrate (reconciler).
  Conflating them added a catalog field, a drift gate, and an invariant change to
  solve a problem that vanishes once routing is reconciled.
- **Mint-time endpoint splice:** the mint can't read submodule `node_id` at PR-gen,
  AND shouldn't — routing isn't formation git.
- **Hand-adding the endpoint (#1608) / hand-editing the live configmap:** the drift
  gate correctly rejects it; ledger row 12 was a proof, not a fix.

## Invariants (review criteria)

- [ ] REPO_SPEC_IS_IDENTITY_SSOT: unchanged — `node_id`/on-chain bindings stay in
      repo-spec; the reconciler reads, never projects, identity (spec: node-baas)
- [ ] GRAPH_ROUTING_IS_SUBSTRATE: scheduler-worker routing is provisioned by the
      per-node reconciler, parallel to `COGNI_NODE_DBS` (spec: node-baas §substrate)
- [ ] PROVISION_OWNS_NODE_INVENTORY: node endpoint inventory is provision-owned, not
      a deploy-time catalog/Argo artifact (aligns with #1607 provision/deploy split)
- [ ] NO_SILENT_DROP: a reconciled node missing from the worker inventory fails loud
- [ ] BORN_GREEN: a flighted spawn reaches `chat/completions` success with zero
      hand-edits
- [ ] SIMPLE_SOLUTION: reuses the `COGNI_NODE_DBS` reconcile pattern; deletes the
      catalog-render + drift-gate rather than adding to it

## Files

- Modify: `scripts/ci/reconcile-node-substrate.sh` — register node Temporal routing (read node_id from repo-spec; parallel to the `COGNI_NODE_DBS` append)
- Modify: `services/scheduler-worker/*` — consume node inventory from the provision-owned source
- Remove/retire: `scripts/ci/render-scheduler-worker-endpoints.sh` drift gate + the catalog-rendered `COGNI_NODE_ENDPOINTS` base configmap
- Keep: `github-repo-write.ts:1184` skip (correct)
- Test: reconcile a node → worker polls its `scheduler-tasks-<node_id>` queue; reconcile-only path adds the endpoint with no git/catalog edit

## E2E validation signal

Re-flight oss to candidate-a with **no manual scheduler edit** → the substrate
reconcile registers oss's Temporal routing → worker polls oss's queue →
`chat/completions` returns a completion. Repeat on preview (born-correct #1584).
