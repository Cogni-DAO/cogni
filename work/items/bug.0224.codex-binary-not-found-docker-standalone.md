---
id: bug.0224
type: bug
title: "Codex binary not found in Docker — standalone misses platform-specific optional dep"
status: needs_merge
priority: 0
rank: 1
estimate: 1
summary: "Codex SDK's findCodexPath() chains createRequire through @openai/codex → @openai/codex-linux-x64. Next.js standalone traces the first two packages (serverExternalPackages) but the platform binary is an optional dep resolved dynamically — it's never copied to the Docker image."
outcome: "ChatGPT BYO chat works in Docker (dev stack and preview). Codex binary resolves from the standalone node_modules tree."
spec_refs: [multi-provider-llm]
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: fix/codex-dockerfile-hotfix
pr: https://github.com/Cogni-DAO/node-template/pull/662
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-03-28
updated: 2026-03-30
labels: [ai, byo-ai, docker, blocker]
external_refs: []
---

# Codex binary not found in Docker standalone

## Postmortem: 5 failed attempts

### The Problem (one sentence)

The Codex SDK resolves its native binary via a 3-step `createRequire` chain: **SDK → `@openai/codex` → `@openai/codex-linux-x64`**. Next.js standalone traces the first two (they're in `serverExternalPackages`), but `@openai/codex-linux-x64` is an optional dep resolved dynamically at runtime — standalone never sees it, so it's missing from the Docker image.

### Resolution chain (how the SDK finds its binary)

```
codex-sdk/dist/index.js
  moduleRequire = createRequire(import.meta.url)        // rooted at SDK location
  moduleRequire.resolve("@openai/codex/package.json")   // step 1: find codex wrapper
  codexRequire = createRequire(codexPackageJsonPath)     // rooted at codex location
  codexRequire.resolve("@openai/codex-linux-x64/...")   // step 2: find platform binary
  → vendor/x86_64-unknown-linux-musl/codex/codex        // step 3: native binary
```

Every failed fix addressed a different layer of this chain but none ensured `@openai/codex-linux-x64` was actually in the image.

### Failed attempts

| #   | Commit / PR                       | What was tried                                                                                  | Why it failed (Loki error)                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `93447224` / `b2c1b1ba` (PR #648) | `COPY node_modules/@openai/codex /opt/codex` — copy package to global path                      | pnpm copies **symlinks**, not real files. Even with real files: `/opt/codex/bin/codex.js` calls `require.resolve("@openai/codex-linux-x64")` → **MODULE_NOT_FOUND** (platform binary wasn't copied)                                                                                                                                        |
| 2   | `8de7c007` (PR #650)              | `pnpm add -g @openai/codex` + adapter falls back to `"codex"` shim on PATH                      | pnpm v10 global install creates **broken symlinks** (CAS store `.pnpm/` dir empty). Global shim resolves `@openai/codex` from CWD `/app` → finds pruned standalone copy → **MODULE_NOT_FOUND**                                                                                                                                             |
| 3   | `b296449a`                        | Replace Codex CLI subprocess with OpenAI HTTP adapter                                           | Reverted (`ae3ebc0b`) — broke streaming/usage pipeline                                                                                                                                                                                                                                                                                     |
| 4   | `230e593a` (PR #654)              | Add `@openai/codex-sdk`, `@openai/codex`, `@openai/codex-linux-x64` to `serverExternalPackages` | SDK + codex now load from standalone. But `findCodexPath()` still fails: `codexRequire.resolve("@openai/codex-linux-x64")` walks up node_modules → **not there**. `serverExternalPackages` tells Next.js "don't bundle, I'll provide at runtime" but standalone doesn't trace optional deps. Loki: `"Unable to locate Codex CLI binaries"` |
| 5   | This fix                          | `COPY --from=builder` the platform binary package into `./node_modules/@openai/codex-linux-x64` | See below                                                                                                                                                                                                                                                                                                                                  |

### Key insight all attempts missed

The builder's `pnpm install` on Linux x64 **does** install `@openai/codex-linux-x64` — it's right there at:

```
node_modules/.pnpm/@openai+codex@0.116.0-linux-x64/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/codex/codex
```

Every attempt tried to install it in the runner stage (global pnpm, global npm, PATH shims) instead of just copying it from the builder where it already exists.

### The fix (one line)

```dockerfile
COPY --from=builder --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/@openai+codex@0.116.0-linux-x64/node_modules/@openai/codex \
  ./node_modules/@openai/codex-linux-x64
```

This places the platform binary at `/app/node_modules/@openai/codex-linux-x64/`. The SDK's `codexRequire.resolve("@openai/codex-linux-x64/package.json")` walks up from `@openai/codex/` → hits `/app/node_modules/` → finds it.

### Proven via Docker test

Minimal Dockerfile (`test-codex-resolve5.Dockerfile`) simulating standalone + COPY:

```
Step 1 - codex: /app/node_modules/@openai/codex/package.json
Step 2 - platform: /app/node_modules/@openai/codex-linux-x64/package.json
SUCCESS: Codex binary found
```

Builder verification with real lockfile confirms platform dep exists:

```
node_modules/.pnpm/@openai+codex@0.116.0-linux-x64/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/codex/codex
```

### Version coupling note

The COPY path contains `@0.116.0-linux-x64` — when `@openai/codex` is upgraded, this line must be updated. Build will fail loudly ("source path not found") rather than silently break.

### What `serverExternalPackages` actually does (and doesn't)

- `@openai/codex-sdk` — **needed**: prevents webpack from bundling the SDK; standalone copies the real package to node_modules
- `@openai/codex` — **needed**: same; the wrapper package with `bin/codex.js` and `findCodexPath()`
- `@openai/codex-linux-x64` — **no-op**: standalone can't find it to copy (optional dep, not statically imported), but harmless to keep as documentation

## Allowed Changes

- `apps/operator/Dockerfile` — replace broken `pnpm add -g` with `COPY --from=builder` for platform binary

## Validation

```bash
pnpm docker:dev:stack        # build and run full stack
# Send a ChatGPT BYO chat message from the UI
# Check: docker logs cogni-app — no MODULE_NOT_FOUND or "Unable to locate Codex CLI"
```

## PR / Links

- Handoff: [handoff](../handoffs/bug.0224.handoff.md)
- PR #662 (hotfix): https://github.com/Cogni-DAO/node-template/pull/662
- PR #661 (broke preview): https://github.com/Cogni-DAO/node-template/pull/661

## Attribution

-
