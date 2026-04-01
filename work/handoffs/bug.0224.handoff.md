---
id: bug.0224.handoff
type: handoff
work_item_id: bug.0224
status: active
created: 2026-03-30
updated: 2026-03-30
branch: fix/codex-dockerfile-hotfix
last_commit: abc704da
---

# Handoff: Codex binary not found in Docker (bug.0224)

## Context

- ChatGPT BYO chat (Codex provider) has never worked in the preview deployment — every attempt fails with `MODULE_NOT_FOUND` or `Unable to locate Codex CLI binaries`
- The Codex SDK resolves its native binary via a 3-step `createRequire` chain: SDK → `@openai/codex` → `@openai/codex-linux-{x64|arm64}`. Next.js standalone traces the first two (via `serverExternalPackages`) but misses the platform-specific optional dep — it's resolved dynamically at runtime
- The builder's `pnpm install` on Linux does install the platform binary. Every previous fix tried to install it in the runner stage instead of copying it from the builder
- Full postmortem with all 5 failed attempts is in [bug.0224](../items/bug.0224.codex-binary-not-found-docker-standalone.md)

## Current State

- **PR #662** ([link](https://github.com/Cogni-DAO/node-template/pull/662)) is the hotfix: additive-only, zero deletions from the original Dockerfile
- **PR #661** ([link](https://github.com/Cogni-DAO/node-template/pull/661)) was the first attempt that broke preview by deleting `ENV PNPM_HOME`/`ENV PATH` and the `pnpm add -g` block. Already merged to staging — #662 reverts the damage and re-adds only the COPY
- Codex chat works in `docker:dev:stack` on arm64 (locally validated 2026-03-30)
- Preview is currently down from #661's broken deploy. #662 must merge to restore it
- `deploy_verified: false` — codex has never been confirmed working in preview

## Decisions Made

- Keep the existing (broken) `pnpm add -g` global install in the Dockerfile — removing it broke preview ([PR #661](https://github.com/Cogni-DAO/node-template/pull/661)). The global install doesn't actually help codex (broken pnpm v10 CAS symlinks), but other things may depend on `ENV PATH` including pnpm on PATH
- The fix is a COPY from the builder that places the real platform binary where `require.resolve` finds it — additive only, no deletions
- `docker:dev:stack` uses `.env.docker` overlay to fix host-mode URL leaks from `.env.local` (DB URLs, `COGNI_REPO_PATH`, `SCHEDULER_APP_BASE_URL`). Added in #661, still on staging

## Next Actions

- [ ] Merge [PR #662](https://github.com/Cogni-DAO/node-template/pull/662) to staging to unbreak preview
- [ ] Verify preview deploy succeeds (`/readyz` passes)
- [ ] Send a codex chat message in preview and confirm it works — set `deploy_verified: true`
- [ ] If codex still fails in preview, check Loki: `{env="preview", service="app"} |= "codex"`
- [ ] Clean up: the `pnpm add -g` block is now dead weight (broken symlinks, does nothing for codex). Consider removing it in a future PR after confirming nothing else depends on it

## Risks / Gotchas

- The COPY source path contains `@0.116.0-linux-${ARCH}` — must be updated when `@openai/codex` is upgraded. Build fails loudly if mismatched
- Docker `COPY dir/ dest/` merges into existing directories (verified in isolated test) — but if BuildKit version changes this behavior, standalone's `@openai/codex` and `@openai/codex-sdk` could get clobbered
- The `pnpm add -g` in the runner is ~10s of build time for broken symlinks. Safe to remove only after proving nothing depends on `PNPM_HOME` on PATH
- Previous PR #661 also added `.env.docker` overlay, `check-root-layout` allowlist, and bootstrap script changes — those are still on staging and are correct

## Pointers

| File / Resource                                                          | Why it matters                                                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `apps/operator/Dockerfile`                                               | The only file changed — two additions (builder stash + runner COPY)                           |
| `work/items/bug.0224...md`                                               | Full postmortem with all 5 failed attempts, resolution chain diagram                          |
| `apps/operator/next.config.ts:11-21`                                     | `serverExternalPackages` — why standalone traces codex-sdk and codex but not the platform dep |
| `node_modules/.pnpm/@openai+codex-sdk@0.116.0/.../dist/index.js:368-430` | `findCodexPath()` — the 3-step createRequire resolution chain                                 |
| `.env.docker.example`                                                    | Container-internal URL overrides for `docker:dev:stack`                                       |
| [PR #648](https://github.com/Cogni-DAO/node-template/pull/648)           | Attempt 1: COPY to /opt/codex (failed — symlinks + missing platform dep)                      |
| [PR #650](https://github.com/Cogni-DAO/node-template/pull/650)           | Attempt 2: pnpm add -g + shim (failed — broken CAS symlinks)                                  |
| [PR #654](https://github.com/Cogni-DAO/node-template/pull/654)           | Attempt 4: serverExternalPackages (partial — SDK loads but platform dep still missing)        |
| [PR #661](https://github.com/Cogni-DAO/node-template/pull/661)           | Attempt 5: COPY from builder (codex worked but broke preview by deleting ENV PATH)            |
| [PR #662](https://github.com/Cogni-DAO/node-template/pull/662)           | Hotfix: restore original + additive COPY only                                                 |
