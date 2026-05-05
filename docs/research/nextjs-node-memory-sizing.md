---
id: nextjs-node-memory-sizing
type: research
title: Next.js node-template memory sizing standards
status: draft
trust: draft
summary: Tiered container memory + V8 heap standard for node-template apps, anchored to MVP-stage reality. Establishes a default that flags any node exceeding it as either real-load or memory-pathology.
read_when: Setting or reviewing k8s memory limits for a node app, debugging an OOM crashloop, deciding whether to raise a node's memory ceiling.
owner: derekg1729
created: 2026-05-05
tags: [infra, observability, sizing]
links:
  - work/items/spike.5002.md
  - work/items/bug.5012.md
  - work/items/bug.5013.md
---

# Research: Next.js node-template memory sizing standards

> spike: spike.5002 | date: 2026-05-05

## Question

What container memory limit + V8 heap configuration should be the default standard for a node-template app, given:

1. Realistic Next.js memory footprint at our actual stage (1 dev, ~0 active users, MVP).
2. Realistic Next.js memory footprint as a node grows (1 → 10 → 100 → 1000 active users).
3. The principle that any node exceeding the standard limit signals either real load or a memory pathology — and we can't tell which today.

## Context

### What exists today

| Node                     | App container    | Request | Limit | NODE_OPTIONS               |
| ------------------------ | ---------------- | ------: | ----: | -------------------------- |
| operator                 | base             |   256Mi | 512Mi | unset                      |
| poly                     | base             |   256Mi | 512Mi | unset                      |
| poly                     | **prod overlay** |   384Mi |   1Gi | unset                      |
| resy                     | base             |   256Mi | 512Mi | unset                      |
| sandbox-openclaw gateway | base             |   256Mi |   1Gi | `--max-old-space-size=768` |

Source files:

- `infra/k8s/base/node-app/deployment.yaml` — base limit 512Mi
- `infra/k8s/overlays/production/poly/kustomization.yaml:75-79` — only override
- `infra/k8s/base/sandbox-openclaw/deployment.yaml:59` — only NODE_OPTIONS

All node apps run Node 22 on `node:22-alpine`. None set `--max-old-space-size`. There is no documented standard.

### What prompted this research

bug.5012: poly prod is OOM-crashlooping at V8 heap ~256MB despite a 1Gi cgroup limit. The "256MB heap ceiling" is exactly the **Node.js 20+ container-aware default of 50% of cgroup memory** when the cgroup limit is the **base 512Mi** — strong evidence that the prod 1Gi overlay was either applied after the running pod started, or never reconciled. Either way: V8 is auto-sizing for 256MB even though prod is meant to allow 1Gi.

bug.5013: nothing autonomous detected this; human Derek noticed via a chrome 502.

## Findings

### F1: Node 22 in containers auto-sizes V8 heap to 50% of cgroup memory (up to 4Gi cap)

Per [Red Hat developer guide on Node 20+ container memory](https://developers.redhat.com/articles/2025/10/10/nodejs-20-memory-management-containers):

| cgroup memory |  Auto-detected `max-old-space-size` |
| ------------: | ----------------------------------: |
|        512 Mi |                             ~256 MB |
|          1 Gi |                             ~512 MB |
|          2 Gi |                            ~1024 MB |
|          4 Gi |                ~2080 MB (caps here) |
|        ≥ 4 Gi | ~2080 MB (no further auto-increase) |

This matches the observed 250–258 MB V8 ceiling on poly prod when the cgroup limit was effectively 512Mi. **There is no bug in V8.** The bug is that nothing tells V8 we want more.

### F2: Real-world Next.js idle baseline

[vercel/next.js#75652](https://github.com/vercel/next.js/discussions/75652) (Node 24 alpine, Next.js 15, idle):

| Metric     |  Value |
| ---------- | -----: |
| RSS        | 279 MB |
| Heap used  | 107 MB |
| Heap total | 114 MB |
| External   |   4 MB |

A bare Next.js app idle uses ~280 MB RSS — already over half of our 512Mi base limit, before any user request lands. **The base 512Mi limit has no headroom for a real Next.js app.** Most workloads work at all only because nodes serve very little traffic and V8 GC keeps old-space well below its 256 MB ceiling.

### F3: Active-users vs memory model (tiered estimates)

Drawn from [Next.js perf benchmarks (Martijn Hols)](https://martijnhols.nl/blog/how-much-traffic-can-a-pre-rendered-nextjs-site-handle), GitHub discussions (#75652, #88603, #46873), and our own production data point.

Honest caveats: per-request memory varies wildly with payload size, SSR data fetching, and library choice. These ranges assume mixed SSR + API routes (similar to our nodes), Node 22, no obvious leaks.

```
Concurrent active users vs single-pod RSS (typical Next.js node)

  ~1500 MB  +                                            * (1000 conc.)
            |                                          ╱
  ~1100 MB  +                                  *  (500 conc.)
            |                              ╱
   ~750 MB  +                       * (200 conc.)
            |                  ╱
   ~500 MB  +           * (50 conc.)
            |       ╱
   ~380 MB  +    * (10 conc.)
            | ╱
   ~280 MB  +* (idle baseline, 0 active)
            +----+----+----+----+----+----+
            0   10   50   200  500   1000
                  concurrent active users

  Trend: ~280 MB baseline + ~1 MB per concurrent active user (mid-range)
  Range: 0.3 MB/user (cached / static-heavy) to 3 MB/user (heavy SSR + DB joins)
```

Active _concurrent_ users ≠ DAU. As a rule of thumb, peak concurrent ≈ DAU / 100 for a low-engagement product. So 1000 concurrent is roughly 100k DAU — far past where we are today.

### F4: V8 heap should be a deliberate fraction of the cgroup limit, with RSS headroom

The heap is one of three RSS contributors: heap (`max-old-space-size`), V8 internals (~50–100 MB), and Node runtime + native buffers (~80–150 MB depending on libs). A safe rule of thumb (synthesizing Vercel community guidance and the Red Hat article):

```
container_limit ≈ heap_limit + 256 MB headroom

heap_limit (--max-old-space-size) ≈ 0.7 × container_limit_MB - 100
```

For a 1 Gi (1024 MB) container, set `--max-old-space-size=768`; this matches what `sandbox-openclaw` already does and leaves ~256 MB for Node runtime + native buffers + GC overhead. Below 512 MB containers, the formula breaks down (heap ≤ 250 MB is too tight to host even an idle Next.js app reliably).

### F5: Poly's OOM is amplified by an unbounded boot-time fan-out, not a steady-state leak

Audit of `nodes/poly/app/src/features/redeem/redeem-catchup.ts:206-221` and `nodes/poly/app/src/bootstrap/redeem-pipeline.ts:279-319`:

- On every container start, `runRedeemCatchup()` walks the chain looking for `ConditionResolution` events.
- For each condition_id (50+ in a typical chunk), it calls `subscriber.enqueueForCondition(...)` **sequentially without `pLimit` or batching**.
- Each enqueue does a CTF multicall (4 reads × N positions) + collateral inference + decision allocation.
- Errors per condition flood `event="poly.ctf.subscriber.catchup_error"` but the loop continues.

Result: the boot work is bursty enough to exhaust V8's old-space ceiling (256 MB at base 512Mi cgroup) before steady state. **Even at the proposed 1 Gi tier with 768 MB heap, this fan-out should be capped** — otherwise it just delays the next OOM until the wallet/condition count grows.

## Recommendation

### S1: Three-tier sizing standard for node-template

| Tier       | Stage                    | Container limit | Container request | `--max-old-space-size` | Use when                                                                                                  |
| ---------- | ------------------------ | --------------: | ----------------: | ---------------------: | --------------------------------------------------------------------------------------------------------- |
| **Tier 0** | MVP / no users           |          512 Mi |            256 Mi |                    384 | Default for new nodes; nodes with no live users                                                           |
| **Tier 1** | Real product / pre-scale |            1 Gi |            384 Mi |                    768 | Once a node has live, recurring users; is the steady-state we should target for production-relevant nodes |
| **Tier 2** | Scaled product           |            2 Gi |            512 Mi |                   1536 | Only with multi-replica HPA wired and a documented load profile                                           |

**Default for new nodes: Tier 0.** A node should only move up a tier with one of:

- A documented user/load profile that justifies the bump, OR
- Loki evidence of OOM at the current tier (V8 FATAL, OOMKilled) AND
- A captured triage note saying "investigated for leak/pathology — see X" before the bump.

This makes any tier-up a small audit moment, not a silent kustomize edit.

### S2: Codify the standard in base config + CI

- `infra/k8s/base/node-app/deployment.yaml`: encode Tier 0 (current 512Mi limit + add `NODE_OPTIONS=--max-old-space-size=384` env var). Today the env is missing entirely — a node-template fork inherits "implicit V8 default" which depends on the host's cgroup behavior. Make it explicit.
- A small CI check (script in `scripts/`) that scans `infra/k8s/overlays/**/kustomization.yaml`, finds any `resources/limits/memory` patch on the node-app Deployment, and fails the static job if the corresponding `NODE_OPTIONS` is missing or off the per-tier table. This is the "tell us when a node is exceeding standard" signal.

### S3: Apply Tier 1 to poly _and_ cap the boot fan-out

Two changes, one PR (since fixing only the heap papers over the unbounded loop):

1. Set poly prod overlay to `--max-old-space-size=768`, lift container limit to 1 Gi if not already (already is, per overlay).
2. Wrap the `redeem-catchup` enqueue loop in `pLimit(N)` (N=4 to start; matches existing CLOB rate-limit ceiling per `poly-market-data` skill).

This addresses bug.5012 directly and makes the catchup not a tier-up trap.

### Trade-offs accepted

- **Tier 0 keeps small-default-bias.** A real Next.js app idle uses ~280 MB RSS and our Tier 0 limit is 512 MB. That gives ~230 MB headroom for active load — fine for 0–10 concurrent users, tight beyond that. We accept that any node hitting steady-state load will OOM at Tier 0 and _that's the signal_ to either tier up (with an audit moment) or fix a leak.
- **Heap formula leaves ~256 MB RSS headroom.** Could be tighter for cost, but Node 22 + Next 16's fetch / route preload buffers can spike, and cgroup-OOMKilled events are catastrophic vs V8 FATAL (no log). The headroom is cheap insurance.
- **No HPA at Tier 0/1.** Single replica + manual scale is correct for our actual stage. Add HPA when Tier 2 is reached, not preemptively.

## Open Questions

1. **Why didn't the existing poly prod 1Gi overlay take effect?** Either the deploy/production branch never picked up the override (kustomize / Argo reconcile gap), or the running pod predates the merge. Must verify before declaring victory on the heap bump. _Action: confirm in `/implement` for bug.5012._
2. **Is `node:22-alpine` ideal for memory-sensitive Node services?** Alpine's `musl` libc has known overhead in Node memory allocators in some workloads; `node:22-bookworm-slim` is the alternative `scheduler-worker` already uses. Out of scope for now but worth a follow-up if Tier 1 still OOMs.
3. **What's the actual traffic on poly prod right now?** F3 chart is a model, not measurement. We should confirm with Loki request-rate metrics before Tier 1 alone is judged sufficient.

## Proposed Layout

### Project

No new `proj.*` needed. Sits inside existing `proj.agentic-dev-setup` or a future infra-hardening project.

### Specs

A new short spec section (or addition to `docs/spec/architecture.md`):

> **Node-template memory sizing.** Every node-app Deployment declares both `resources.limits.memory` and `NODE_OPTIONS=--max-old-space-size=...` per the tier table in `docs/research/nextjs-node-memory-sizing.md`. Tier upgrades require evidence (load profile or OOM triage); CI fails on overlay overrides that leave NODE_OPTIONS un-paired.

### Tasks (rough sequence)

1. **task: codify Tier 0 in node-app base** — set `NODE_OPTIONS=--max-old-space-size=384` in `infra/k8s/base/node-app/deployment.yaml`. No-op for any node currently OOM-free under base; locks the standard for new forks. Also: comment the tier table in the manifest.
2. **task: poly Tier 1 + catchup pLimit (closes bug.5012)** — overlay sets `--max-old-space-size=768`; redeem-catchup wraps `enqueueForCondition` loop in `pLimit(4)`. Test: hit candidate-a, watch poly stderr for FATAL ERROR over 6h window; expect zero. Backfill: same change to `bootstrap/redeem-pipeline.ts:279-319` since it has the same unbounded loop.
3. **task: CI check for tier compliance** — `scripts/check-node-sizing.mjs` parses overlays, fails if memory limit is overridden without paired NODE_OPTIONS at the right tier. Wire into the `static` CI job.
4. **(deferred / depends on bug.5013) — Loki probe `{stream="stderr"} |~ "FATAL ERROR"` is the autonomous detector for tier-overrun in prod.** Lives with the prod-health-watch agent, not this spike.

## Sources

- [Next.js memory usage guide](https://nextjs.org/docs/app/guides/memory-usage)
- [Node.js 20+ memory management in containers (Red Hat)](https://developers.redhat.com/articles/2025/10/10/nodejs-20-memory-management-containers)
- [Next.js k8s OOM discussion #75652](https://github.com/vercel/next.js/discussions/75652)
- [Pre-rendered Next.js perf benchmarks (Martijn Hols)](https://martijnhols.nl/blog/how-much-traffic-can-a-pre-rendered-nextjs-site-handle)
- [Next.js memory leak in k8s discussion #26801](https://github.com/vercel/next.js/discussions/26801)
- Internal: `infra/k8s/base/node-app/deployment.yaml`, `infra/k8s/overlays/production/poly/kustomization.yaml`, `infra/k8s/base/sandbox-openclaw/deployment.yaml`, `nodes/poly/app/src/features/redeem/redeem-catchup.ts`, `nodes/poly/app/src/bootstrap/redeem-pipeline.ts`
