---
id: bug.0157
type: bug
title: "WalletConnect pino@7 pulls test-only deps into Turbopack Client Component SSR"
status: needs_implement
priority: 0
rank: 1
estimate: 2
summary: "WalletConnect → pino@7 → thread-stream@0.15 ships test files requiring 'tape', 'tap', 'desm', 'fastbench'. Turbopack follows these during Client Component SSR because Next.js prerenders Client Components by default. Current workaround is a thread-stream noop stub via turbopack.resolveAlias."
outcome: "WalletConnectButton (and its RainbowKit parent) is loaded via next/dynamic with ssr: false. No thread-stream noop stub needed. pnpm check:full passes (Docker build succeeds)."
spec_refs:
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-11
updated: 2026-03-11
labels: [build, dx, wallet]
external_refs:
---

# WalletConnect pino@7 SSR bundling failure

## Symptoms

`pnpm --filter operator build` (Turbopack) fails with 21 "Module not found" errors in Docker:

```
Module not found: Can't resolve './ROOT/node_modules/.pnpm/thread-stream@0.15.2/node_modules/thread-stream/test/close-on-gc.js'
Module not found: Can't resolve 'tape'
Module not found: Can't resolve 'tap'
```

## Root Cause

Next.js prerenders Client Components on the server by default. The import chain:

```
AppHeader.tsx [Client Component SSR]
  → WalletConnectButton.tsx
    → @rainbow-me/rainbowkit
      → @wagmi/connectors
        → @walletconnect/universal-provider
          → pino@7.11.0
            → thread-stream@0.15.2
              → thread-stream/test/*.js  ← requires 'tape', 'tap' (not installed)
```

This only manifests with `outputFileTracingRoot` set (monorepo layout) because Turbopack's module resolution scope expands to the workspace root.

## Current Containment (temporary)

- `apps/operator/src/shared/stubs/thread-stream-noop.ts` — noop class
- `apps/operator/next.config.ts` → `turbopack.resolveAlias: { "thread-stream": "./src/shared/stubs/thread-stream-noop.ts" }`

## Real Fix

Remove the wallet subtree from SSR entirely using a client-only dynamic boundary. Next.js `ssr: false` is the supported escape hatch for browser-only dependency chains:

```tsx
// apps/operator/src/components/wallet/WalletConnectButton.tsx (or parent)
import dynamic from "next/dynamic";

const WalletConnectButton = dynamic(
  () => import("./WalletConnectButtonInner"),
  { ssr: false }
);
```

Once the dynamic boundary is in place:

- Remove `apps/operator/src/shared/stubs/thread-stream-noop.ts`
- Remove `turbopack.resolveAlias` from `next.config.ts`
- Remove `"pino"` and `"pino-pretty"` from `serverExternalPackages` (if only there for this issue)

## Requirements

- WalletConnectButton (and RainbowKit) loaded via `next/dynamic` with `ssr: false`
- No thread-stream noop stub in the codebase
- No turbopack.resolveAlias workaround in next.config.ts
- `pnpm check:full` passes (Docker build succeeds without the stub)
- Wallet functionality unchanged (connect, sign, disconnect)

## Allowed Changes

- `apps/operator/src/components/` — wallet component files
- `apps/operator/src/app/` — layouts that render wallet components
- `apps/operator/next.config.ts` — remove workaround
- `apps/operator/src/shared/stubs/` — delete thread-stream-noop.ts

## Plan

- [ ] Identify all SSR entry points that import WalletConnectButton
- [ ] Wrap with `next/dynamic({ ssr: false })` at the highest reasonable boundary
- [ ] Verify wallet functionality works (connect, sign, disconnect)
- [ ] Remove `thread-stream-noop.ts` stub
- [ ] Remove `turbopack.resolveAlias` from `next.config.ts`
- [ ] Remove `pino`/`pino-pretty` from `serverExternalPackages` if no longer needed
- [ ] `pnpm check:full` passes

## Validation

```bash
pnpm check:full
```

**Expected:** Docker build succeeds without thread-stream stub. Wallet connects in browser.

## Review Checklist

- [ ] **Work Item:** `bug.0157` linked in PR body
- [ ] **Spec:** no spec invariants affected
- [ ] **Tests:** wallet e2e or manual verification
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
