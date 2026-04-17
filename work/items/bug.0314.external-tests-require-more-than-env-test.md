---
id: bug.0314
type: bug
title: "External tests fail when only .env.test is loaded — need EVM_RPC_URL, smee webhook delivery, or safer skip-gates"
status: needs_triage
priority: 2
rank: 99
estimate: 2
created: 2026-04-17
updated: 2026-04-17
summary: "With .env.test loaded, 18/25 external tests pass cleanly but 4 still fail because they need infrastructure beyond what .env.test provides: operator-wallet needs EVM_RPC_URL (or should skip-gate on it), github-webhook-e2e + webhook-poll-dedup need a running smee proxy (or local port-forward) so GitHub webhook deliveries reach the dev server, and pr-review-e2e needs the same webhook delivery path. All four tests throw/assert instead of skipping when these prereqs are missing."
outcome: "pnpm test:external with only .env.test + dev:stack running produces zero failures: every test either runs and passes, or skips with a clear message about what env/infrastructure is missing. Skip-gates on provider constructors (operator-wallet) + preflight checks on webhook delivery (smee/port-forward reachable) are the two mechanisms."
spec_refs: []
assignees: []
project: proj.system-test-architecture
related:
  - task.0316
  - https://github.com/Cogni-DAO/node-template/pull/889
labels: [testing, external, skip-gates]
---

# bug.0314 — External tests require more than .env.test provides

## Repro

```bash
# Prereqs: Docker running, .env.test populated with GH_REVIEW_APP_*, PRIVY_*, OPENROUTER_API_KEY
# dev:stack NOT required for the failing subset
pnpm test:external
```

Observed on PR #889 at commit `186d64f26`:

```
Test Files  4 failed | 2 passed | 1 skipped (7)
      Tests  4 failed | 18 passed | 3 skipped (25)
```

## Four failing tests

1. **`tests/external/operator-wallet/operator-wallet.external.test.ts`**

   ```
   UrlRequiredError: No URL was provided to the Transport.
   ❯ new PrivyOperatorWalletAdapter .../privy-operator-wallet.adapter.js:58:44
   ❯ tests/external/operator-wallet/operator-wallet.external.test.ts:32:19
   ```

   The test constructs `PrivyOperatorWalletAdapter` before checking whether
   `EVM_RPC_URL` is set. The adapter's `createPublicClient({ transport: http(undefined) })`
   throws inside the constructor. Skip-gate logic sits on the `describe` but
   the provider is constructed at file-level or `beforeAll` without the
   same gate.

2. **`tests/external/ingestion/github-webhook-e2e.external.test.ts`** —
   `expect(found).toBe(true)` after 102s wait. Test pushes a commit to a
   test repo, expects the webhook event to land in the local DB via
   `api/internal/webhooks/github`. No webhook arrives because the dev
   server has no public URL (smee proxy `pnpm test:smee` not running, or
   the webhook target isn't configured to it).

3. **`tests/external/ingestion/webhook-poll-dedup.external.test.ts`** —
   same root cause as #2 (60s timeout). Depends on webhook-then-poll
   dedup, but no webhook means the dedup path isn't exercised.

4. **`tests/external/review/pr-review-e2e.external.test.ts`** —
   `expect(checkRun).toBeDefined()`. Test opens a PR, expects a GitHub
   check run to appear within 30s. The pr-review feature triggers off the
   webhook; same delivery gap as #2/#3.

## What passes (for context)

18 tests pass cleanly on this setup:

- `tests/external/ingestion/github-adapter.external.test.ts` (6)
- `tests/external/ingestion/ledger-collection.external.test.ts` (12)

These hit GitHub's REST API directly — no webhook delivery, no RPC
client, no chain state. They confirm the `.env.test` pipeline works end
to end.

## Proposed fixes

**Minimal (unblock `pnpm test:external` on a laptop):**

1. Move provider construction inside `describe.skipIf` for all three
   wallet/webhook tests so missing env becomes a skip, not a throw.
2. Add a preflight to the three webhook-dependent tests: `describe.skipIf(!process.env.GH_WEBHOOK_PROXY_URL)` — skip unless the
   smee proxy URL is set.
3. Document the full happy-path env in `tests/external/AGENTS.md`:
   - `.env.test` (GH creds + OpenRouter)
   - `EVM_RPC_URL` (for operator-wallet)
   - `pnpm test:smee` running in another terminal (for webhook tests)

**Nice-to-have:**

- Refactor the 3 webhook tests to a shared helper that probes the smee
  proxy liveness on startup and fails fast with a clear message.
- Add a `pnpm preflight:test:external` that prints which env/infra is
  missing before running.

## Non-goals

- Fixing the underlying webhook delivery infrastructure — that works,
  it just needs to be running.
- Rewriting the tests to avoid webhooks — they're testing webhook paths
  specifically, that's the point.

## Validation

- [ ] `pnpm test:external` with only `.env.test` + Docker: 0 failures
      (everything runs or skips, no exceptions)
- [ ] `pnpm test:external` with `.env.test` + `EVM_RPC_URL` +
      `pnpm test:smee` running: all 25 tests run (or skip if real creds
      are absent), no failures
- [ ] Clear message in terminal about what's missing when a suite is
      skipped
