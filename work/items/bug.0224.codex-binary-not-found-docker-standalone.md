---
id: bug.0224
type: bug
title: "Codex binary MODULE_NOT_FOUND in Docker — standalone bundles pruned @openai/codex, bypasses global install"
status: needs_triage
priority: 0
rank: 1
estimate: 1
summary: "Codex SDK's findCodexPath() resolves @openai/codex from the bundled standalone copy (pruned, no native binary) instead of the global pnpm install. Every ChatGPT BYO chat in preview fails with MODULE_NOT_FOUND."
outcome: "ChatGPT BYO chat works in preview. Codex SDK resolves the native binary from the global install, not the pruned standalone bundle."
spec_refs: [multi-provider-llm]
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/task-0212-unified-usage
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-28
updated: 2026-03-28
labels: [ai, byo-ai, docker, blocker]
external_refs: []
---

# Codex binary MODULE_NOT_FOUND in Docker standalone

## Requirements

### Observed

Every ChatGPT BYO chat request in preview fails with:

```
Error: Cannot find module '/app/node_modules/.pnpm/@openai+codex@0.116.0/node_modules/@openai/codex/bin/codex.js'
  code: 'MODULE_NOT_FOUND'
```

Confirmed from Grafana Cloud logs at `2026-03-28T17:51:48Z` — 14 hours after latest deploy of sha `6c870b25` which contains the "fix."

### Expected

ChatGPT BYO chat works. Codex SDK spawns the native binary from the global pnpm install at `/usr/local/share/pnpm/`.

### Root Cause

**Resolution chain (3 layers deep):**

1. **App code** (`codex-llm.adapter.ts:153`): `const codexBin = existsSync(devBin) ? devBin : "codex"` — resolves to `"codex"` in Docker. Passes as `codexPathOverride`.

2. **Codex SDK** (`@openai/codex-sdk/dist/index.js:152-158`):

   ```js
   var moduleRequire = createRequire(import.meta.url);
   // import.meta.url = the BUNDLED SDK inside .next/standalone
   ```

   `CodexExec` constructor: `this.executablePath = executablePath || findCodexPath()`. With our `"codex"` override, it uses `"codex"` as the spawn target.

3. **Global shim** (`/usr/local/share/pnpm/codex`): The global pnpm shim spawns `node` which tries to `require("@openai/codex/bin/codex.js")`. Node resolves `@openai/codex` by walking from CWD (`/app`) → finds the **pruned** copy in `.next/standalone/node_modules` → binary not there → `MODULE_NOT_FOUND`.

**Why the global install doesn't help**: Next.js standalone bundles `@openai/codex-sdk` into the app output (it's not in `serverExternalPackages`). The bundled SDK's `createRequire(import.meta.url)` resolves from the standalone directory, not the global store. Even the global shim fails because Node's module resolution from CWD finds the pruned copy first.

### Fix

Add `@openai/codex-sdk` and `@openai/codex` to `serverExternalPackages` in `next.config.ts`:

```ts
serverExternalPackages: [
  // ... existing entries ...
  // Codex: subprocess binary — standalone tracing prunes native platform deps
  "@openai/codex-sdk",
  "@openai/codex",
  "@openai/codex-linux-x64",
],
```

This tells Next.js standalone to NOT bundle these packages. At runtime, Node resolves them from the global pnpm install (on PATH via `PNPM_HOME`), where the native `@openai/codex-linux-x64` binary is intact.

The adapter code (`codex-llm.adapter.ts`) can then be simplified — don't pass `codexPathOverride` at all and let the SDK's `findCodexPath()` work naturally from the global install context.

### Impact

- **Severity**: P0 — all ChatGPT BYO chat is broken in preview (and would be in production)
- **Scope**: Only codex provider. Platform (LiteLLM) and local (OpenAI-compatible) are unaffected.
- **Since**: First deploy with codex support

## Allowed Changes

- `apps/web/next.config.ts` — add codex packages to `serverExternalPackages`
- `apps/web/src/adapters/server/ai/codex/codex-llm.adapter.ts` — simplify binary resolution (remove `existsSync` fallback, let SDK resolve)
- `apps/web/Dockerfile` — verify global install path is correct (may already be fine)

## Plan

- [ ] Add `@openai/codex-sdk`, `@openai/codex`, `@openai/codex-linux-x64` to `serverExternalPackages`
- [ ] Remove manual binary resolution from adapter — let SDK's `findCodexPath()` handle it
- [ ] Verify `pnpm docker:stack` builds and codex chat works locally
- [ ] Push and verify preview deploy

## Validation

**Command:**

```bash
pnpm docker:stack
# Then send a ChatGPT BYO chat message
```

**Expected:** Codex spawns successfully. No `MODULE_NOT_FOUND`. Chat response arrives.

**Log check:** No `Cannot find module` errors in `docker logs cogni-app`.

## Review Checklist

- [ ] **Work Item:** `bug.0224` linked in PR body
- [ ] **Spec:** multi-provider-llm invariants upheld (ADAPTER_IMPLEMENTS_PORT)
- [ ] **Tests:** existing codex adapter tests still pass
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Logs: Grafana Cloud, `{env="preview", service="app"} |~ "MODULE_NOT_FOUND"`, 2026-03-28

## Attribution

-
