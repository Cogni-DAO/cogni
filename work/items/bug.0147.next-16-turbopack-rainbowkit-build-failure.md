---
id: bug.0147
type: bug
title: "Next.js 16.0.7 build fails: Turbopack scans thread-stream test fixtures via RainbowKit dep chain, webpack fallback blocked by node: barrel leaks"
status: needs_merge
priority: 1
rank: 5
estimate: 3
summary: "Upgrading Next.js from 16.0.1 to 16.0.7 breaks production builds. Turbopack crawls into thread-stream's test/ directory (via RainbowKit → WalletConnect → pino) and fails on non-JS files (LICENSE, .zip, intentional syntax errors). The webpack fallback (`next build --webpack`) surfaces a second class of bugs: barrel exports leak `node:crypto` and `node:util` into client component bundles. Both bundlers fail; no clean path to Next 16.0.7 exists today."
outcome: "`pnpm build` succeeds on Next.js 16.0.7 with no bundler workarounds. CI and Docker production builds pass."
spec_refs:
  - build-architecture
assignees: []
credit:
project:
branch: dependabot/npm_and_yarn/next-16.0.7
pr: https://github.com/Cogni-DAO/node-template/pull/138
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-10
labels: [build, dependencies, rainbowkit, turbopack, p1-blocked]
external_refs:
  - https://github.com/Cogni-DAO/node-template/pull/138
---

# Next.js 16.0.7 build fails: Turbopack + RainbowKit dep chain, webpack + barrel leaks

## Requirements

### Observed

**Failure 1 — Turbopack (default bundler, `next build`):**

`next build` fails with 174 errors. Turbopack scans the entire `thread-stream` package directory (including `test/`, `LICENSE`, `README.md`) and tries to parse them as ECMAScript. The import chain is:

```
RainbowKit (dist/index.js) [Client Component SSR]
  → @wagmi/connectors (walletConnect.js)
    → @walletconnect/ethereum-provider
      → @walletconnect/universal-provider
        → pino@7.11.0
          → thread-stream@0.15.2 / @3.1.0
            → test/ts.test.ts          → "Missing module type"
            → test/syntax-error.mjs    → parse error (intentional)
            → LICENSE                  → "Unknown module type"
            → README.md               → "Unknown module type"
            → test/dir with spaces/    → "Unknown module type"
```

This is a Turbopack regression — 16.0.1 builds clean on the same codebase.

**Failure 2 — Webpack fallback (`next build --webpack`):**

Two `node:` protocol imports leak into client bundles via barrel exports:

1. **`node:crypto`** via MetaMask SDK:
   - `src/components/kit/animation/Reveal.tsx:21` imports `cn` from `@/shared/util`
   - `src/shared/util/index.ts:15` barrel re-exports `deriveAccountIdFromApiKey` from `./accountId`
   - `src/shared/util/accountId.ts:15` imports `createHash` from `node:crypto`
   - Webpack error: `UnhandledSchemeError: Reading from "node:crypto" is not handled`

2. **`node:util`** via scheduler-core:
   - `src/app/(app)/credits/CreditsPage.client.tsx` → `payments/public.ts` → `payments/errors.ts` → `src/ports/index.ts` → `packages/scheduler-core`
   - scheduler-core uses `node:util`
   - Same `UnhandledSchemeError`

### Expected

`pnpm build` succeeds on Next.js 16.0.7. Both Turbopack and webpack should produce working production builds.

### Reproduction

```bash
# On the dependabot/npm_and_yarn/next-16.0.7 branch (rebased onto staging):
pnpm build              # Turbopack: 174 errors (thread-stream)
pnpm build --webpack    # Webpack: UnhandledSchemeError (node:crypto, node:util)

# On staging (16.0.1):
pnpm build              # Clean
```

### Impact

- **Dependabot PR #138** has been open 3+ months — security patch (CVE-2025-66478) unmerged
- Blocks all future Next.js upgrades until resolved
- The barrel export contamination (Failure 2) is a latent architecture issue — Turbopack 16.0.1 papers over it but it will surface again

### Root Causes

1. **Turbopack module scanning** — Turbopack in 16.0.2+ scans package directories beyond what `import`/`require` actually references, hitting test fixtures and non-JS files. `serverExternalPackages` does not help because the errors occur on the Client Component SSR bundling path, which is outside its scope. No documented `turbopack.rules` syntax exists for excluding files by path (the API expects `loaders`/`as`/`condition`, not a raw exclude mechanism).

2. **Barrel export contamination** — `src/shared/util/index.ts` and `src/ports/index.ts` re-export server-only symbols (`node:crypto`, `node:util`) into the client bundle graph. Turbopack 16.0.1 is lenient about `node:` protocol imports in client SSR; webpack is not.

## Allowed Changes

- `package.json` — build script, dependency versions
- `next.config.ts` — bundler configuration
- `src/shared/util/index.ts` — break barrel export contamination
- `src/shared/util/accountId.ts` — move to server-only path if needed
- `src/ports/index.ts` — split client/server exports
- `src/components/kit/animation/Reveal.tsx` — fix import path
- `src/app/(app)/credits/CreditsPage.client.tsx` — fix import path

## Plan

- [x] Step 1: Fix barrel export contamination — remove `accountId.ts` from `@/shared/util` barrel; split `@/ports` into client-safe `index.ts` and server-only `server.ts`.
- [x] Step 2: Switch production builds to webpack (`next build --webpack` in `package.json`). Turbopack stays as default for `next dev`.
- [x] Step 3: Verify `pnpm build` passes with webpack on Next 16.0.7.
- [ ] Step 4: Bump RainbowKit 2.2.9 → 2.2.10 while we're touching deps (minor, reduces future risk). _Deferred — not blocking._
- [x] Step 5: Run `pnpm check` to validate no regressions.
- [ ] Step 6: Re-evaluate Turbopack for production builds when upstream fixes land (track via Next.js and pino issue trackers).

## Validation

**Command:**

```bash
pnpm build && pnpm check
```

**Expected:** Production build succeeds with webpack on Next.js 16.0.7. All lint, type, and format checks pass.

## Review Checklist

- [ ] **Work Item:** `bug.0147` linked in PR body
- [ ] **Spec:** build-architecture invariants upheld
- [ ] **Tests:** `pnpm test` passes, `pnpm build` succeeds
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Dependabot PR: https://github.com/Cogni-DAO/node-template/pull/138
- RainbowKit SIWE ↔ Auth.js v5 incompatibility: `work/items/task.0107.authjs-multi-provider-migration.md`
- Thirdweb migration audit (rainbowkit fragility): `docs/research/thirdweb-auth-migration-audit.md`
- Wallet button stability: `docs/archive/HANDOFF_WALLET_BUTTON_STABILITY.md`

## Attribution

- Investigation: Claude Code + derekg1729
