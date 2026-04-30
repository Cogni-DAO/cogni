---
id: task.0433
type: task
title: "Extract @cogni/node-ui-kit baseline UI package, vendor into node-template"
status: needs_review
priority: 2
rank: 1
estimate: 3
summary: "Establish a shared `packages/node-ui-kit` package containing the shadcn primitives + reui data-grid kit that ship with node-template. Forks (poly, operator, …) keep their local UI free to customize, but treat the kit as a read-only baseline they can adopt or override."
outcome: "node-template's app imports every shadcn primitive and every reui data-grid component from `@cogni/node-ui-kit/*` instead of `@/components/vendor/*` and `@/components/reui/*`. Local copies in node-template are deleted. operator follows the same swap (its `app/`, `components/kit/`, `components/index.ts` barrel, and `app/(app)/work/_components/HeaderFilter.tsx` route through the kit; its local `components/vendor/shadcn/`, `components/reui/`, `shared/util/cn.ts`, `shared/hooks/useIsMobile.ts` are deleted). Forks (poly, ai-only, resy) are untouched. AGENTS.md guidance + a CODEOWNERS-style read-only contract keeps the kit a baseline that nodes don't fork."
spec_refs:
  - docs/spec/packages-architecture.md
  - docs/spec/ui-implementation.md
assignees: []
credit:
project:
branch: design/task-0433-node-ui-kit
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-30
updated: 2026-04-30
labels: [ui, packages, refactor, dx]
external_refs:
  - https://github.com/Cogni-DAO/node-template/pull/1150
  - https://github.com/Cogni-DAO/node-template/pull/1156
---

# `@cogni/node-ui-kit` — Baseline UI Package

## Design

### Outcome

A new `packages/node-ui-kit` package owns the shadcn primitives + reui data-grid kit that node-template uses. node-template's `components/vendor/shadcn/*` and `components/reui/*` directories are deleted; imports go through `@cogni/node-ui-kit/*`. Forks (poly, operator, ai-only, …) are unchanged in this PR — they keep their local copies and remain free to customize.

The kit is a **baseline**: forks are free to either (a) adopt `@cogni/node-ui-kit` as-is, (b) wrap individual exports in their own `components/kit/*`, or (c) keep a local copy and diverge. They MUST NOT modify the shared kit directly — divergence belongs in their own node tree.

### Why this shape

Three things forced the design:

1. **Drift is real, not hypothetical.** poly's `data-grid-column-header.tsx` already added a filter-count badge that operator and node-template don't have. My own `HeaderFilter` (task.0432) only landed in operator + node-template. Each port is a manual translation that re-introduces variance.
2. **Forks should be free to customize.** This repo's mission is "reproducible foundation for autonomous AI-powered organizations." A fork (e.g. a wallet-heavy poly, a chat-heavy ai-only) needs to override UI surfaces without asking permission. A read-only baseline + override pattern preserves that freedom.
3. **node-template is the canonical receiver.** It's the reference fork; whatever ships there is what new forks inherit. Making it the only consumer in this PR keeps the diff small and proves the wiring before forks opt in.

### Scope of THIS PR (kept tight)

- Create `packages/node-ui-kit` with three export roots: `./shadcn`, `./reui`, `./util`.
- Copy node-template's current `vendor/shadcn/*`, `vendor/assistant-ui/*`, `vendor/shadcn-io/*`, `reui/*` into the package verbatim. Move `shared/util/cn.ts` into `./util` so the kit is self-contained.
- Switch node-template's imports to `@cogni/node-ui-kit/*`. Delete the local copies.
- Add CODEOWNERS + AGENTS.md guidance: `packages/node-ui-kit/` is a baseline; forks override in their own tree; PRs that change `packages/node-ui-kit/` need explicit reviewer sign-off.
- **Out of scope**: poly, operator, ai-only, resy. They keep their local copies and may opt-in later. Token reconciliation (`tailwind.css` `:root` vars) is a separate task.

### CI scope question (must resolve before implementation)

This PR touches `packages/node-ui-kit/*` (new) + `nodes/node-template/app/src/**` (deletes + import rewrites). The single-node-scope gate previously classified `packages/*` as operator-domain (see task.0432 PR-A split). Two viable shapes:

- **Option A — sequential, two PRs**:
  - PR-1 (operator-scope): create the package, no consumers. CI proves it builds.
  - PR-2 (node-template-scope): switch imports, delete local copies.
- **Option B — single PR with multi-node-scope exception**: requires extending the ride-along whitelist or adding a one-off label/comment override. Simpler diff to review, but needs a CI policy change first.

Default to **Option A** unless PR-2 review reveals it makes the imports/deletes hard to verify. Decide before opening either PR.

### Reuses

- `packages/node-app` — same `peerDependencies` + `exports` map pattern (`./providers`, `./extensions`).
- `packages/node-shared` — same internal helpers + tsup build conventions.
- `packages/node-contracts` — same workspace dependency wiring.

### Rejected alternatives

- **Single monolithic `@cogni/node-ui` covering kit + reui + tokens + per-node `kit/`** — too large for one PR; `kit/` is genuinely per-node (auth/wallet differs). This task explicitly excludes `components/kit/*`.
- **Force all nodes to switch in this PR** — violates the "forks free to customize" goal AND blows up single-node-scope CI. Forks switch on their own schedule.
- **Copy poly's drifted reui into the baseline** — would import a poly-flavored data-grid into node-template without review. Baseline starts from node-template's current state; poly's filter-count enhancement gets ported into the kit as a follow-up if it's worth promoting.
- **Reach for Turborepo / nx now** — premature; `packages/node-app` proves pnpm workspace + tsup is enough.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] BASELINE_READ_ONLY — `packages/node-ui-kit/` is owned by the kit; forks don't modify it. CODEOWNERS + AGENTS.md spell this out.
- [ ] FORKS_FREE — poly, operator, ai-only, resy are NOT touched in this PR. Their local copies stay. Their package.json gets no new dependency on `@cogni/node-ui-kit`.
- [ ] SELF_CONTAINED — `@cogni/node-ui-kit` does not import from any node-specific path. `cn` lives inside the kit.
- [ ] PEER_DEPS_ONLY — react / next / lucide / class-variance-authority / tailwind-merge / clsx / radix-ui are `peerDependencies`, not direct deps.
- [ ] NODE_TEMPLATE_PARITY — every export the node-template app currently imports from `@/components/vendor/*` or `@/components/reui/*` is re-exported from `@cogni/node-ui-kit/*`. No silent drops.
- [ ] CONTRACTS_ARE_TRUTH — no API or schema changes. UI-only refactor.

### Files

#### Create

```
packages/node-ui-kit/
  package.json
  tsconfig.json
  tsup.config.ts
  AGENTS.md
  src/
    shadcn/
      index.ts                    # barrel export of all 24 primitives
      alert.tsx                   ↓ copied verbatim from node-template's vendor/shadcn/
      area-chart-interactive.tsx
      avatar.tsx
      button.tsx
      card.tsx
      chart.tsx
      checkbox.tsx
      dialog.tsx
      drawer.tsx
      dropdown-menu.tsx
      input.tsx
      popover.tsx
      progress.tsx
      scroll-area.tsx
      select.tsx
      separator.tsx
      sheet.tsx
      sidebar.tsx
      skeleton.tsx
      spinner.tsx
      table.tsx
      toggle.tsx
      toggle-group.tsx
      tooltip.tsx
    reui/
      index.ts                    # barrel export
      badge.tsx                   ↓ from node-template's reui/
      data-grid/
        data-grid.tsx
        data-grid-column-filter.tsx
        data-grid-column-header.tsx
        data-grid-column-visibility.tsx
        data-grid-pagination.tsx
        data-grid-scroll-area.tsx
        data-grid-table.tsx
        data-grid-table-dnd.tsx
        data-grid-table-dnd-rows.tsx
        data-grid-table-virtual.tsx
    assistant-ui/                 # vendored chat primitives, used by node-template only
      attachment.tsx              ↓ from node-template's vendor/assistant-ui/
      markdown-text.tsx
      thread.tsx
      tool-fallback.tsx
      tooltip-icon-button.tsx
    shadcn-io/                    # additional shadcn-io primitives
      (copy whatever lives in node-template/app/src/components/vendor/shadcn-io/ verbatim)
    util/
      cn.ts                       ↓ moved from node-template's shared/util/cn.ts
```

`package.json` exports map:

```json
{
  "name": "@cogni/node-ui-kit",
  "exports": {
    "./shadcn": "./dist/shadcn/index.js",
    "./shadcn/*": "./dist/shadcn/*.js",
    "./reui": "./dist/reui/index.js",
    "./reui/data-grid/*": "./dist/reui/data-grid/*.js",
    "./assistant-ui/*": "./dist/assistant-ui/*.js",
    "./shadcn-io/*": "./dist/shadcn-io/*.js",
    "./util/cn": "./dist/util/cn.js"
  }
}
```

`peerDependencies`: react, react-dom, next, lucide-react, class-variance-authority, clsx, tailwind-merge, @radix-ui/\* primitives that the originals import, @tanstack/react-table, @tanstack/react-query, vaul, sonner, recharts, embla-carousel-react, react-hook-form, zod (any peer the copied files actually import — enumerate from a real grep, don't list speculatively).

#### Modify (node-template only)

- `nodes/node-template/app/package.json` — add `"@cogni/node-ui-kit": "workspace:*"`.
- `nodes/node-template/app/src/app/**/*.tsx` and `nodes/node-template/app/src/components/kit/**/*.tsx` — every import from `@/components/vendor/{shadcn,assistant-ui,shadcn-io}/*` rewrites to `@cogni/node-ui-kit/{shadcn,assistant-ui,shadcn-io}/*`. Every import from `@/components/reui/*` rewrites to `@cogni/node-ui-kit/reui/*`. Every import of `@/shared/util/cn` rewrites to `@cogni/node-ui-kit/util/cn`. Estimated ~40 import sites — one codemod scriptable in 10 lines of sed.
- `nodes/node-template/app/src/components/AGENTS.md` — note that `vendor/` and `reui/` were extracted to `@cogni/node-ui-kit`; `kit/` remains node-local.

#### Delete (node-template only)

- `nodes/node-template/app/src/components/vendor/shadcn/` (entire directory — 24 files)
- `nodes/node-template/app/src/components/vendor/assistant-ui/` (5 files)
- `nodes/node-template/app/src/components/vendor/shadcn-io/`
- `nodes/node-template/app/src/components/reui/` (entire directory — 11 files)
- `nodes/node-template/app/src/shared/util/cn.ts` (moved into the package)

#### Add CODEOWNERS-style guardrail

- `.github/CODEOWNERS` — add `packages/node-ui-kit/ @derekg1729` (or whoever owns the baseline).
- `packages/node-ui-kit/AGENTS.md` — document the BASELINE_READ_ONLY contract; tell forks to wrap in their own `kit/` instead of editing the kit.

#### Tests

- `packages/node-ui-kit/tests/build.smoke.test.ts` — import every public export, assert it's defined. Catches missing barrel re-exports.
- Run `pnpm typecheck` from `nodes/node-template/app`; CI-level guarantee that no import dangled after the rewrite.

### Implementation Sequence

1. **Decide PR shape (A or B above)** — answer the multi-node-scope question first; the rest of the sequence assumes Option A.
2. **PR-1 (operator-scope) — create the package**:
   - Scaffold `packages/node-ui-kit/{package.json,tsconfig.json,tsup.config.ts}` mirroring `packages/node-app`.
   - Copy file trees verbatim from node-template into `src/`. Change relative cross-imports inside the kit (e.g. `@/components/vendor/shadcn/button` → `../shadcn/button`).
   - Add `AGENTS.md` + `CODEOWNERS` entry.
   - Add the smoke test.
   - Wire `pnpm-workspace.yaml` if needed (`packages/*` is already covered).
   - Land. CI: required gates only — no consumer yet, so no risk to runtime.
3. **PR-2 (node-template-scope) — adopt the kit**:
   - Add `"@cogni/node-ui-kit": "workspace:*"` to `nodes/node-template/app/package.json`.
   - Codemod the imports (single sed pass; verify zero diff in compiled output for the changed files).
   - Delete the local `vendor/`, `reui/`, `shared/util/cn.ts`.
   - Update `nodes/node-template/app/src/components/AGENTS.md`.
   - Land. CI: typecheck + unit + component must stay green; visual diff at `/work` is the smoke test.
4. **Follow-ups (NOT in this task)**:
   - poly, operator opt-in (per-node tasks; each handles its own drift reconciliation).
   - Token base layer extraction (`tailwind.css :root` vars).
   - Promote poly's data-grid filter-count-badge into the kit if it's worth shipping by default.

## Validation

```
exercise: |
  After PR-2 lands, locally run node-template's dev server and load /work.
  Confirm visual parity with the current /work table — every header, filter,
  pagination, skeleton renders identically. Open a column header dropdown
  and confirm the per-column filter UI from task.0432 still works.

observability: |
  CI typecheck + unit + component all green on both PR-1 and PR-2. The
  smoke test in packages/node-ui-kit/tests asserts every public export
  resolves at runtime. No deployed-URL Loki check required (UI-only).
```
