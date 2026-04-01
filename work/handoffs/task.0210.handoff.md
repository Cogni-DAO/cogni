---
id: handoff.task.0210
type: handoff
work_item_id: task.0210
status: active
created: 2026-03-27
updated: 2026-03-27
branch: feat/byo-ai-openai-compatible
last_commit: 04ee2baf
---

# Handoff: BYO-AI ChatGPT OAuth — deploy pipeline + UI + RLS fix

## Context

- The BYO-AI ChatGPT flow (task.0192) shipped device-code OAuth, AEAD-encrypted token storage, and a profile page connect UI
- PR #641 merged the multi-provider LLM rearchitecture (ModelRef + ModelProviderPort) to staging
- On the preview deployment, the ChatGPT connect flow failed at token exchange with "Server configuration error" — `CONNECTIONS_ENCRYPTION_KEY` was never propagated beyond the Zod schema and `.env.local`
- This session fixed env propagation (8 files), improved the connect UX (single-click + stepped walkthrough), and diagnosed an RLS policy violation on the `connections` table INSERT

## Current State

- **Done**: `CONNECTIONS_ENCRYPTION_KEY` propagated across all deploy files (compose, workflows, deploy.sh, docs). GitHub secrets set for preview + production environments. PR #643 open against staging.
- **Done**: Connect UI fixed — single click starts flow immediately (no double-click), stepped walkthrough with warning about Device Code auth setting, reordered steps (open link → enter code → wait)
- **Done**: Error logging in exchange route no longer dumps the encrypted credential blob; extracts `err.cause.message` instead
- **In progress / broken**: The `connections` table INSERT fails with `new row violates row-level security policy`. The fix is partially applied — `withTenantScope` imported but the import path was wrong (`@cogni/db-client/tenant-scope` should be `@cogni/db-client`). The corrected import is on disk but **not yet tested or committed**
- **Not started**: The PKCE "copy URL" flow redesign (replacing device code with authorization-code + paste-back, emulating OpenClaw's approach) — plan drafted at `.claude/plans/dreamy-growing-whale.md` but paused per user request

## Decisions Made

- Device Code flow stays for now; PKCE redesign paused (user wants to fix what's broken first)
- `CONNECTIONS_ENCRYPTION_KEY` is optional in Zod schema — BYO-AI features disabled when unset, CI unaffected
- Error logging must never include Drizzle's query-param dump (contains encrypted ciphertext) — extract `err.cause` for the real Postgres error
- Connect UI renders as expanded card below SettingRow, not crammed inline
- Warning uses `text-warning` / `bg-warning` design tokens (defined in tailwind.css as `--color-warning`)

## Next Actions

- [ ] Fix the RLS violation: `withTenantScope(db, userActor(session.id as UserId), fn)` in exchange route (import from `@cogni/db-client`, not `@cogni/db-client/tenant-scope`) — verify locally end-to-end
- [ ] Run `pnpm check:fast` after the RLS fix
- [ ] Test full connect flow locally: profile → Connect → device code → OpenAI auth → "Connected" state
- [ ] Commit RLS fix + error logging improvement + UI changes together
- [ ] Merge PR #643 to staging, verify preview deployment picks up the encryption key
- [ ] Test connect flow on preview deployment end-to-end
- [ ] Consider whether `status` and `disconnect` routes also need `withTenantScope` (they use `resolveAppDb()` too — reads may silently return empty due to RLS, writes will fail)

## Risks / Gotchas

- The `connections` RLS policy is `USING (created_by_user_id = current_setting('app.current_user_id', true))` — any route using `resolveAppDb()` without `withTenantScope` will silently filter rows or reject writes. The status route currently returns `{ connected: false }` even when a connection exists because of this.
- The `bytea` custom type in `packages/db-schema/src/connections.ts` has no `toDriver`/`fromDriver` — this works with node-postgres but may cause issues with other drivers
- Drizzle error messages include full query params (including binary encrypted blobs). The improved logging in the exchange route truncates this, but other routes that touch `connections` should follow the same pattern.
- The deploy pipeline won't pick up `CONNECTIONS_ENCRYPTION_KEY` until the workflow file changes land on the `staging` branch (PR #643 merge)

## Pointers

| File / Resource                                                     | Why it matters                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/operator/src/app/api/v1/auth/openai-codex/exchange/route.ts`  | Token exchange — RLS fix needed here                                            |
| `apps/operator/src/app/api/v1/auth/openai-codex/authorize/route.ts` | Device code initiation                                                          |
| `apps/operator/src/app/api/v1/auth/openai-codex/status/route.ts`    | Status check — also affected by RLS (silent empty result)                       |
| `apps/operator/src/app/(app)/profile/view.tsx`                      | ChatGptConnectFlow component (lines ~290-520)                                   |
| `packages/db-client/src/tenant-scope.ts`                            | `withTenantScope` — the correct RLS pattern                                     |
| `packages/db-schema/src/connections.ts`                             | Table schema + RLS policy + unique index                                        |
| `apps/operator/src/shared/crypto/aead.ts`                           | AEAD encrypt/decrypt — returns Buffer for bytea column                          |
| `.claude/plans/dreamy-growing-whale.md`                             | Drafted PKCE redesign plan (paused)                                             |
| PR #643                                                             | Env propagation PR against staging                                              |
| `scripts/ci/deploy.sh`                                              | 3 places for new env vars: OPTIONAL_SECRETS, append_env_if_set, SSH passthrough |
