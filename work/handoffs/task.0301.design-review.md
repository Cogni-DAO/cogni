---
title: "Design Review: Shared Test Infrastructure (task.0301)"
date: 2026-04-06
status: review
---

# Design Review: Shared Test Infrastructure Package

## Summary

Audit found 832 duplicated test files across 4 nodes (99% identical). This review evaluates the proposed `packages/node-test-utils` extraction and Approach A (shared tests in node-template only, smoke suites in forks).

---

## 1. Is Approach A Sound?

**Yes, with one required supplement.**

The 4 nodes share identical `setup.ts`, `_fakes/`, `_fixtures/`, `helpers/`, and all 5 vitest configs. The `src/` code tests exercise (`@/ports`, `@/shared/db/schema`, `@/shared/observability`) is also identical.

**Risk**: If operator's `container.ts` adds a new adapter that breaks construction, running shared tests only in node-template would miss it. The multi-node stack tests exercise container wiring indirectly (node must boot) but don't run the unit/contract/ports suites.

**Required mitigation**: Each sovereign node gets a per-node smoke suite that at minimum tests `getContainer()` constructs successfully. This catches wiring bugs in <1 second. The nightly full run is a safety net, not a primary defense.

## 2. Package Design: Workspace-Internal, No Build Step

`node-test-utils` should be a `"private": true` workspace package with no tsup build:

- Test utilities import `vitest` (`vi.fn`, `vi.mock`) — bundling these makes no sense
- `setup.ts` does side-effect imports (`@testing-library/jest-dom/vitest`) that tsup would mishandle
- Use `"exports": { "./*": "./src/*.ts" }` with TypeScript source directly; vitest handles resolution via `tsconfigPaths`

### The `@/` Import Problem

Many test utilities import from `@/ports`, `@/shared/db/schema`, `@/adapters/server`, `@/bootstrap/container`. These resolve differently per node. The package cannot be self-contained.

**Recommended approach (Hybrid Strategy C):**

1. **Move portable files** (~60% of files) that only import `@cogni/*` into the shared package
2. **Refactor port imports**: port interfaces that are truly shared should be imported from `@cogni/node-core` instead of `@/ports`
3. **Keep node-coupled files** (those importing `@/adapters`, `@/bootstrap`) in each node's `tests/` as thin composition layers

This gives 60-70% deduplication without magic alias tricks.

### Portable Files (can move to shared package)

- `_fakes/ids.ts`, `fake-clock.ts`, `fake-rng.ts`, `fake-telemetry.ts`
- `_fakes/ai/request-builders.ts`, `usage-fact-builders.ts`
- `_fixtures/env/base-env.ts`, `_fixtures/db/seed-client.ts`
- `helpers/data-stream.ts`, `helpers/sse.ts`

### Node-Coupled Files (stay per-node)

- `_fakes/index.ts` (re-exports from `@/adapters/test`)
- `_fakes/test-context.ts`, `accounts/mock-account.service.ts`, `payments/mock-services.ts`, `ai/fake-llm.service.ts` (import `@/ports`)
- `_fixtures/auth/db-helpers.ts` (imports `@/adapters/server/db/client`, `@/shared/db/schema`)
- `_fixtures/ai/completion-facade-setup.ts` (imports `@/bootstrap/container`)
- `helpers/poll-db.ts` (imports `@/shared/db/schema`)

## 3. Vitest Config Factory

A factory function is the right abstraction. Vitest doesn't support config inheritance — each config is independent.

```typescript
// packages/node-test-utils/src/vitest-configs/create-config.ts
export function createNodeVitestConfig(opts: {
  dirname: string;
  kind: "unit" | "component" | "stack" | "stack-multi" | "external" | "external-money";
  overrides?: Partial<UserConfig["test"]>;
}) => UserConfig
```

Reduces 20 config files (5 per node) to 20 one-liners. Operator's multi-node exclude becomes a one-line override.

## 4. Migration Plan

Every commit leaves CI green. No big bang.

### Phase 0: Preparation

1. Verify byte-identity across all 4 nodes with `diff`. Fix discrepancies first (separate PR).
2. Categorize files: **portable** (only `@cogni/*` imports) vs **node-coupled** (`@/` imports).

### Phase 1: Create package (additive only)

3. Create `packages/node-test-utils/` with `package.json` (`private: true`).
4. Move portable files first (helpers, pure fakes, data fixtures).
5. Move `setup.ts` — extract OTel init into callback parameter.

### Phase 2: Config factory

6. Add `createNodeVitestConfig` to the package.
7. Migrate node-template first. Verify CI.
8. Migrate remaining nodes one at a time.

### Phase 3: Deduplicate test execution

9. Add smoke suite to each sovereign node (3-5 tests, <5s).
10. Update CI to run shared tests only in node-template.
11. Add nightly full-suite workflow.

### Phase 4: Cleanup

12. Delete duplicate portable files from operator/poly/resy.
13. Update imports from `@tests/_fakes/*` to `@cogni/node-test-utils/*`.

## 5. Smoke Suite Design

Each sovereign node's smoke suite tests two things:

**A. Container boot** (~1s):

```typescript
it("getContainer() returns a valid container", async () => {
  const { getContainer } = await import("@/bootstrap/container");
  const c = getContainer();
  expect(c.llmService).toBeDefined();
  expect(c.clock).toBeDefined();
});
```

**B. 2-3 representative contract canaries** — exercises port interfaces this node uses. Not the full suite.

**Budget**: 3-5 test files, <5 seconds runtime per node.

**NOT included**: route response tests (those are stack tests requiring a running server).

## 6. Risk Matrix

| Risk                                              | Likelihood | Impact | Mitigation                                       |
| ------------------------------------------------- | ---------- | ------ | ------------------------------------------------ |
| Container wiring bug missed                       | Medium     | High   | Per-node smoke suite                             |
| Shared package `@/` imports break on divergence   | Low        | High   | Strategy C: no `@/` in shared package            |
| Migration introduces test failures                | Medium     | Medium | Phase-by-phase, CI green each commit             |
| Config factory produces subtly different behavior | Low        | High   | Snapshot/diff resolved config before switching   |
| Nightly discovers failures too late               | Medium     | Medium | Supplement with per-node smoke; alert on nightly |

## 7. Open Questions

1. **Are `@/ports` interfaces being extracted to `@cogni/node-core`?** Would make ~8 more files portable.
2. **Appetite to refactor `@/shared/db/schema` test imports to `@cogni/db-schema`?** Package already exists.
3. **Should vitest config factory be separate package (`@cogni/vitest-config`)?** Different dependency profile.
4. **Acceptable smoke suite runtime budget?** Container-boot only (1s) or + contract canaries (5-10s)?
5. **`setup.ts`'s `@/instrumentation` import** — factory callback, move to `@cogni/node-core`, or keep per-node?
6. **Nightly-only or also on canary/staging pushes?** Promotion without full coverage could ship regressions.
