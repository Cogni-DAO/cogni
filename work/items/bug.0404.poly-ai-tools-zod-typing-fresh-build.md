---
id: bug.0404
type: bug
title: "@cogni/poly-ai-tools fails fresh tsc -b with ZodObject not assignable to ZodType (TS2740)"
status: needs_triage
priority: 2
rank: 50
estimate: 2
created: 2026-04-27
updated: 2026-04-27
summary: "Fresh `tsc -b nodes/poly/packages/ai-tools` (or any rebuild that invalidates the turbo cache for this package) emits TS2740 'Type ZodObject<...> is missing properties from type ZodType<...>' across 8 sites in poly-data-trades-market.ts, poly-data-value.ts, poly-list-orders.ts, poly-place-trade.ts, and wallet-top-traders.ts. The errors hide behind turbo cache on most pre-push runs (build is reused from prior CI/PR), but surface immediately when any source file in the package is touched, making future PRs to nodes/poly/packages/ai-tools/ block on pre-push check:fast."
outcome: "pnpm typecheck:full and pnpm check:fast pass on a freshly cleared workspace (no .turbo / no .tsbuildinfo) without errors in @cogni/poly-ai-tools."
spec_refs: []
assignees: []
project: proj.tool-use-evolution
labels: [poly, typing, zod, infra]
---

# bug.0404 — @cogni/poly-ai-tools fresh build fails with ZodObject ↔ ZodType TS2740

## Reproduction

From a clean workspace (`pnpm install --frozen-lockfile && find packages nodes -name "*.tsbuildinfo" -delete`):

```bash
pnpm exec tsc -b nodes/poly/packages/ai-tools
```

Emits 10 errors of the form:

```
nodes/poly/packages/ai-tools/src/tools/poly-place-trade.ts(226,3): error TS2740:
  Type 'ZodObject<...>' is missing the following properties from type 'ZodType<...>':
  _type, _parse, _getType, _getOrReturnCtx, and 7 more.
```

Affected files / lines:

- `poly-data-trades-market.ts:87, 88`
- `poly-data-value.ts:57, 58`
- `poly-list-orders.ts:77, 78`
- `poly-place-trade.ts:226, 227`
- `wallet-top-traders.ts:117, 118`

All sites are tool contracts where `inputSchema` / `outputSchema` are typed as `ZodType<X>` but assigned a `ZodObject<...>` literal. Smells like a zod major-version mismatch (`ZodObject` from one zod version not structurally satisfying `ZodType` from another) — possibly a transitive dependency of `@cogni/ai-tools` brings a different zod than the one `@cogni/poly-ai-tools` resolves directly.

## Why it surfaces now

`turbo run build` and `tsc -b` both rely on `.tsbuildinfo` / `.turbo/` caches. PRs that don't touch `nodes/poly/packages/ai-tools/**` reuse the cached good build and never run tsc fresh against this package. PRs that touch ANY source file in the package invalidate the cache, surface the latent errors, and fail pre-push.

Confirmed pre-existing on `origin/main` (HEAD `071f775c3` at filing time): same 10 errors emit when poly-ai-tools is rebuilt from scratch. Not caused by bug.0319 ckpt 2/3 — those changes simply moved files into a package whose typing was already broken under fresh build.

## Reproduction context

Discovered while attempting to delete the dead `polyClosePositionBoundTool` export (a zero-consumer cleanup post-bug.0319 ckpt 3). The deletion itself was correct, but the rebuild it triggered exposed this latent issue. Cleanup was split: the doc-only fix went into [PR #1093](https://github.com/Cogni-DAO/node-template/pull/1093); the close-position deletion is parked behind this bug.

## Likely fix paths

1. Pin / dedupe zod across `@cogni/ai-tools`, `@cogni/poly-ai-tools`, `@cogni/ai-core`, and any transitive consumer. `pnpm why zod | head -30` from the repo root will show the resolution graph.
2. If two zod major versions are coexisting, decide which one is canonical and align package.json + pnpm-lock.
3. As a safety net, add `nodes/poly/packages/ai-tools` to the workspace ci `typecheck:full` invocation so this surfaces in CI even when turbo cache hides it locally.

## Validation

- `find packages nodes -name "*.tsbuildinfo" -delete && pnpm exec tsc -b nodes/poly/packages/ai-tools` → exits 0.
- `pnpm check:fast` after a clean workspace → all 7 checks green without relying on cache.
- A no-op edit to any `nodes/poly/packages/ai-tools/src/tools/*.ts` file does NOT break pre-push.

## Related

- [bug.0319](./bug.0319.ai-tools-per-node-packages.md) — the per-node ai-tools split that moved these files; surfaced the latent issue but did not cause it.
- [PR #1093](https://github.com/Cogni-DAO/node-template/pull/1093) — doc-only piece of the bug.0319 cleanup batch; the polyClosePositionBoundTool deletion was parked behind this bug.
