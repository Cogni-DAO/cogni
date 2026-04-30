---
id: bug.0434
type: bug
title: "Cross-node EVENT_NAMES registry forces operator-domain edits for every poly/resy/node-template log line — breaks single-node-scope by construction"
status: needs_design
priority: 1
rank: 6
estimate: 3
created: 2026-04-30
updated: 2026-04-30
summary: "Every node's structured-log event names live in `packages/node-shared/src/observability/events/index.ts` (operator domain) — including 12+ poly-specific names like `POLY_AUTO_WRAP_*`, `POLY_MIRROR_*`, `POLY_RECONCILER_*`, `POLY_TRADE_*`, `POLY_WALLET_*`. Adding a new poly event requires editing operator-domain files, which forces single-node-scope to fail and demands an admin-merge bypass on every observability change. PR #1149 (task.0429) hit this at least twice and triggered chore PRs #1152, #1153, #1155, #1157 in the cascade. Per docs/spec/observability.md and the /observability skill, event names must come from the registry — but there's no per-node registry today. The poly node has an empty aspirational `nodes/poly/app/src/shared/observability/events/` dir with an AGENTS.md that says 'all new event names MUST be added to EVENT_NAMES registry' but no actual registry there; `nodes/poly/app/src/shared/observability/index.ts` simply re-exports `EVENT_NAMES` from `@cogni/node-shared`. Net: the architecture says per-node, the implementation is centralized."
outcome: "Each node owns its own `EVENT_NAMES` registry: `packages/node-shared/src/observability/events/index.ts` keeps cross-node + adapter-level events (LiteLLM, billing, governance), while `nodes/{poly,resy,node-template,operator}/app/src/shared/observability/events/index.ts` defines node-local event names (`POLY_AUTO_WRAP_*`, `POLY_MIRROR_*`, `POLY_RECONCILER_*`, etc. for poly). `EventName` becomes a per-node union. Adding a poly event becomes a poly-only PR — single-node-scope passes cleanly. Cross-node events (inter-node callbacks, billing ingest) stay in the shared registry because they genuinely span node domains."
assignees: []
spec_refs:
  - observability
project: proj.cicd-services-gitops
deploy_verified: false
labels: [observability, refactor, single-node-scope, registry, event-names]
external_refs:
  - work/items/task.0429.poly-auto-wrap-usdce-to-pusd.md
  - https://github.com/Cogni-DAO/node-template/pull/1149
  - https://github.com/Cogni-DAO/node-template/pull/1152
  - https://github.com/Cogni-DAO/node-template/pull/1153
  - https://github.com/Cogni-DAO/node-template/pull/1155
  - https://github.com/Cogni-DAO/node-template/pull/1157
---

# bug.0434 — Centralized EVENT_NAMES leaks every node's events into operator domain

## Why this exists

PR #1149 (task.0429, poly-scoped) needed to add 10 new event names like `POLY_AUTO_WRAP_TICK_COMPLETED`, `POLY_AUTO_WRAP_TX_SUBMITTED`. The canonical registry `packages/node-shared/src/observability/events/index.ts` is operator-domain. Adding poly events there fails `single-node-scope` (multi-domain PR) → admin-merge bypass needed every time.

This is structurally wrong. The poly node has:

- `nodes/poly/app/src/shared/observability/events/AGENTS.md` saying "All new event names MUST be added to EVENT_NAMES registry"
- An empty `events/` directory with no actual `index.ts`
- `nodes/poly/app/src/shared/observability/index.ts` that just re-exports `EVENT_NAMES` from `@cogni/node-shared`

The aspirational architecture (node-local registry) and the implementation (centralized registry re-exported into each node) disagree.

## Today's pain (from PR #1149's cascade)

- task.0429's first attempt added poly events to `@cogni/node-shared` → single-node-scope fail
- Reverted to local const → /observability skill correctly flagged it as off-pattern
- Re-added to shared → single-node-scope fails again, requires admin bypass
- Mirror-pipeline events (POLY_MIRROR_*) and reconciler events (POLY_RECONCILER_*) hit the same shape every time someone adds a poly observability primitive

The biome cascade chore PRs (#1152, #1153, #1155, #1157) document the same architectural class — single-node-scope is correct policy but the registry layout fights it.

## Fix shape

Split the registry. Each node app owns `nodes/<node>/app/src/shared/observability/events/index.ts`:

```ts
// nodes/poly/app/src/shared/observability/events/index.ts
export const POLY_EVENT_NAMES = {
  POLY_AUTO_WRAP_SINGLETON_CLAIM: "poly.auto_wrap.singleton_claim",
  POLY_MIRROR_RECONCILE_TICK_ERROR: "poly.mirror.reconcile.tick_error",
  // … all `poly.*` events
} as const;

export type PolyEventName =
  (typeof POLY_EVENT_NAMES)[keyof typeof POLY_EVENT_NAMES];
```

`@cogni/node-shared` keeps only:

- AI/payments/governance events emitted by every node
- Adapter events that are vendor-bound (LiteLLM, Tigerbeetle, etc.)
- Inter-node callback events (`internode.*`)
- Cross-cutting infrastructure events (langfuse, billing ingest)

Each node's `@/shared/observability` re-exports `{ ...EVENT_NAMES, ...POLY_EVENT_NAMES }` so call sites don't change shape.

## Migration plan

1. Move the 12+ `POLY_*` names from `@cogni/node-shared` → `nodes/poly/app/src/shared/observability/events/index.ts`. Same for resy + node-template if/when they have local events.
2. Re-export from the per-node `@/shared/observability` barrel.
3. Update `logEvent()`'s `EventName` union to accept a wider type (or genericize per-node).
4. Single PR per node (each is single-domain → single-node-scope passes).
5. Drop the `POLY_*` entries from `@cogni/node-shared` in a follow-up cleanup PR (operator-domain).

Each step is independently mergeable (idempotent: same event name, just moved homes).

## Repro

```bash
git checkout -b chore/add-some-poly-event main
# Edit packages/node-shared/src/observability/events/index.ts to add POLY_X
gh pr create
# CI: single-node-scope fails because PR spans operator (added) + poly (consumer)
# OR: PR span only operator → other ports' edits dragged in
```

## Out of scope

- Migrating cross-cutting events (billing, AI, governance) to per-node — they ARE shared by definition.
- Restructuring `logEvent()` itself.
- Generalizing the same fix for metrics (`prom-client` registry is similar but has its own seam).

## Validation

- After landing: a poly-only PR can add a `POLY_*` event by editing only `nodes/poly/...`. CI shows `single-node-scope: pass` without bypass.
- `pnpm lint` continues to pass; existing log call sites compile unchanged.
- `pnpm db:check` + `pnpm check:fast` clean.

## Notes

- This bug was filed during PR #1149's flight. The PR adds events to the centralized registry as an interim fix because doing the right thing in the same PR would balloon scope.
- Task.0425 (per-node packaging refactor) set the pattern; observability simply hasn't followed yet.
