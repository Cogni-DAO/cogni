# Handoff: task.0318 Phase A — user-owned tracked wallets + RLS

## Status snapshot

- **Work item:** [task.0318](../items/task.0318.poly-wallet-multi-tenant-auth.md) — `status: needs_closeout`, `revision: 1`
- **Spec:** [docs/spec/poly-multi-tenant-auth.md](../../docs/spec/poly-multi-tenant-auth.md) — `spec_state: proposed`
- **Project:** [proj.poly-copy-trading](../projects/proj.poly-copy-trading.md) — Phase 2 deliverable "User-owned tracked wallets + RLS …" = **In Review**
- **Branch:** `feat/task-0318-phase-a` (worktree: `/Users/derek/dev/cogni-template-task-0318-phase-a/`)
- **PR:** [#944](https://github.com/Cogni-DAO/node-template/pull/944)
- **Code verified:** typecheck + unit tests (1322 pass locally). **DB / HTTP round-trip NOT executed** — requires `.env.test` infra that CI owns.

Phase B (per-user signing wallets, `poly_wallet_connections` + `poly_wallet_grants`, `WalletSignerPort`) is **out of scope** and blocked on a 2-day Safe+4337 spike (task.0318 § Phase B checkpoints).

## What was built

### 1. Spec + design (committed to main-adjacent)

| File                                                    | What it says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/spec/poly-multi-tenant-auth.md`                   | End-state contract: two-layer tenancy model (tracked wallets + actor wallets), `CopyTradeTargetSource` + `WalletSignerPort` ports, RLS keyed on `created_by_user_id = current_setting('app.current_user_id', true)` per the `connections` pattern, per-tenant kill-switch, defense-in-depth pattern from `DrizzleConnectionBrokerAdapter`, signing-backend comparison with Safe+4337 as the preferred OSS choice, hard escalation criteria. Phase A's shipped pieces are marked ✅ in the Acceptance Checks table; Phase B's are ⏳. |
| `work/items/task.0318.poly-wallet-multi-tenant-auth.md` | Phased plan A1-A8 (done) + B1-B7 (pending B1 spike). Review Feedback section documents the two blocking bugs caught in rev 0 and their fixes in rev 1.                                                                                                                                                                                                                                                                                                                                                                               |
| `work/projects/proj.poly-copy-trading.md`               | Phase 2 row updated: Phase A = tracked-wallet RLS shipped; Phase 3 row = Phase B signing wallets pending. As-Built Specs link updated.                                                                                                                                                                                                                                                                                                                                                                                               |

### 2. Code (all on `feat/task-0318-phase-a`, rebased onto latest main)

| Layer                                                                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DB migration `0029_poly_copy_trade_multitenant.sql`                           | DROP Phase-0 `poly_copy_trade_{fills,decisions,config}`; CREATE `poly_copy_trade_targets` (tenant-scoped, soft-delete); recreate fills+decisions with `billing_account_id` + `created_by_user_id` NOT NULL; recreate `poly_copy_trade_config` with per-tenant PK on `billing_account_id`, default `enabled=false`; RLS enforced on all four (policy copy-pasted verbatim from `0025_add_connections.sql`); `SELECT set_config(…)` before the bootstrap INSERT for system tenant config row (`enabled=true`). |
| Drizzle schema `nodes/poly/packages/db-schema/src/copy-trade.ts`              | `polyCopyTradeTargets` (new), `polyCopyTradeFills` + `polyCopyTradeDecisions` + `polyCopyTradeConfig` (tenant columns added).                                                                                                                                                                                                                                                                                                                                                                                |
| Port + impls `nodes/poly/app/src/features/copy-trade/target-source.ts`        | `CopyTradeTargetSource` interface with `listForActor(actorId): UserTargetRow[]` (RLS-clamped via `withTenantScope`) + `listAllActive(): EnumeratedTarget[]` (the ONE sanctioned BYPASSRLS read). `envTargetSource` + `dbTargetSource` impls.                                                                                                                                                                                                                                                                 |
| Helper `nodes/poly/app/src/features/copy-trade/target-id.ts`                  | `targetIdFromWallet(wallet)` moved from `bootstrap/jobs/` to features layer so the env source can use it without layer violation. Re-exported from the job shim for back-compat.                                                                                                                                                                                                                                                                                                                             |
| Contract `packages/node-contracts/src/poly.copy-trade.targets.v1.contract.ts` | Three operations: `polyCopyTradeTargetsOperation` (GET list), `polyCopyTradeTargetCreateOperation` (POST), `polyCopyTradeTargetDeleteOperation` (DELETE). `target_id` = DB row PK (the value DELETE accepts).                                                                                                                                                                                                                                                                                                |
| Routes                                                                        | `GET /api/v1/poly/copy-trade/targets` (per-user list), `POST` (create + app-side tenant defense-in-depth), `DELETE /api/v1/poly/copy-trade/targets/[id]` (soft-delete via RLS-clamped UPDATE). Uses memoized `container.orderLedger` for per-tenant kill-switch read.                                                                                                                                                                                                                                        |
| Container `nodes/poly/app/src/bootstrap/container.ts`                         | Wires `dbTargetSource` in production, empty `envTargetSource` in test. Mirror poll iterates `listAllActive` → each enumerated target carries `(billing_account_id, created_by_user_id)` → writes inherit tenant on every fills/decisions insert.                                                                                                                                                                                                                                                             |
| OrderLedger `nodes/poly/app/src/features/trading/order-ledger.ts`             | `snapshotState(target_id, billing_account_id)` reads per-tenant kill-switch. `insertPending` + `recordDecision` require `TenantBinding` (`{billing_account_id, created_by_user_id}`).                                                                                                                                                                                                                                                                                                                        |
| Dashboard `TopWalletsCard.tsx`                                                | `+` button calls `POST` create; `−` button calls `DELETE` by row id; pooled-execution disclaimer banner above the table.                                                                                                                                                                                                                                                                                                                                                                                     |
| Env + CI cleanup                                                              | `COPY_TRADE_TARGET_WALLETS` removed from `server-env`, `.env.local.example`, SKILL.md, workflow, `deploy-infra.sh`.                                                                                                                                                                                                                                                                                                                                                                                          |

### 3. Tests

| Test                                                      | Type                       | What it proves                                                                                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/features/copy-trade/target-source.test.ts`    | unit                       | `envTargetSource` returns `UserTargetRow[]` with stable per-wallet ids via `targetIdFromWallet`; `listAllActive` attributes to the system tenant.                                                                                     |
| `tests/component/copy-trade/db-target-source.int.test.ts` | component (testcontainers) | Two-tenant setup: `listForActor` returns only caller's rows (RLS); `listAllActive` enumerates both with correct attribution; shared wallet across tenants has distinct DB row ids; per-tenant kill-switch; soft-delete excludes rows. |
| `tests/component/copy-trade/targets-route.int.test.ts`    | component (testcontainers) | **POST → GET → DELETE round-trip.** Contract `target_id` = DB row PK; DELETE with the UUIDv5-from-wallet returns 404 (pins the semantic).                                                                                             |
| `scripts/experiments/poly-rls-smoke.sh`                   | manual psql                | Cross-tenant INSERT rejected by `WITH CHECK`; same-tenant INSERT + cleanup succeed.                                                                                                                                                   |

### 4. What was explicitly dropped / what to watch

- **`DROP TABLE … CASCADE` on `poly_copy_trade_{fills,decisions,config}`** wipes candidate-a's Phase-0 prototype trading history. The `/design` decision ratified this ("prototype debris"); ensure the operator knows before rollout.
- **Shared-wallet dedup in the mirror poll** — when N tenants track the same wallet, the container starts N parallel polls. Not a correctness bug (idempotency gate prevents double-placement), but wasteful. Tracked by [task.0332](../items/task.0332.poly-mirror-shared-poller.md). Blocks Phase 3.
- **`bug.0331 → bug.0336` renumber** — PR #932 and PR #937 + main's `bug.0333` from another branch collided on ids. Local branch does the final renumber to `bug.0336` to clear `pnpm check:docs`.

## Validate e2e in candidate-a

> **Goal:** confirm the migration applies cleanly, per-user CRUD works against RLS, and the mirror poll keeps placing orders under the system tenant.

### Preconditions

1. Merge PR #944 to `main`.
2. Existing `COPY_TRADE_TARGET_WALLETS` GH secret at candidate-a env scope is no longer read — delete after rollout: `gh secret delete COPY_TRADE_TARGET_WALLETS --env candidate-a`.
3. Candidate-a's `poly-node-app-secrets` no longer needs that env key.

### Step 1 — Flight the branch

```bash
# From main (after PR #944 merge)
gh workflow run candidate-flight-infra.yml \
  --ref main --field app=poly
```

Watch for the infra deploy to pick up the new image + apply migration 0029. The migrator runs `drizzle-kit migrate`; the `SELECT set_config(...)` before the bootstrap INSERT should let the system-tenant config row seed under FORCE RLS.

**What good looks like:** rollout completes with exit 0. `poly-node-app` pod boots, emits `poly.mirror.poll.singleton_claim` event, and the existing single-operator BeefSlayer mirror keeps placing trades (system tenant owns the targets + config row now).

**Failure modes to watch:**

- Migration apply crashes with `new row violates row-level security policy for "poly_copy_trade_config"` → the `set_config` fix didn't work (CP R1 regressed). Roll back the migration by restoring 0028-era schema from a DB backup; file as bug.
- `poly.mirror.poll.skipped { target_count: 0 }` in Loki → the system-tenant seed row didn't land OR the `poly_copy_trade_targets` table is empty. Check: `psql $DATABASE_URL_POLY -c "SELECT * FROM poly_copy_trade_config;"` — should show one row, `billing_account_id = '00000000-0000-4000-b000-000000000000'`, `enabled = true`.
- `poly.mirror.poll.tick_error` after migration → the ledger writes are probably missing `billing_account_id` on a path you didn't cover. Loki query: `{app="poly-node-app"} |~ "tick_error"`.

### Step 2 — Verify the RLS floor

SSH to the canary VM or open a psql against `$DATABASE_URL_POLY` with **`app_user`** role (not `app_service`):

```bash
psql "$DATABASE_URL_POLY" <<'SQL'
-- Should show zero rows (no app.current_user_id set)
SELECT count(*) FROM poly_copy_trade_targets;

-- Set the system tenant context
SET LOCAL app.current_user_id = '00000000-0000-4000-a000-000000000001';

-- Now the system's own rows surface
SELECT billing_account_id, enabled FROM poly_copy_trade_config;
SELECT id, target_wallet FROM poly_copy_trade_targets WHERE disabled_at IS NULL;
SQL
```

Or run the provided smoke:

```bash
POLY_PSQL='psql ...' scripts/experiments/poly-rls-smoke.sh
```

**What good looks like:** cross-tenant INSERT is rejected by `WITH CHECK`; same-tenant INSERT + cleanup succeed; first SELECT without `SET LOCAL` returns zero rows.

### Step 3 — Verify the per-user CRUD over HTTP

Sign in to the candidate-a dashboard as a non-system user. In the "Monitored Wallets" card:

1. Click the `+` on any top-wallet row you don't already track.
2. Refresh. Confirm the new row appears with the green `★` highlight (or regular tracked row if it's in the top 10).
3. Click the `−` button on that row.
4. Refresh. Confirm the row is gone from the list.

Alternative via `curl`:

```bash
# Replace <session-cookie> with your dashboard session
export COOKIE='next-auth.session-token=...'

# List
curl -s -H "Cookie: $COOKIE" \
  https://candidate-a.<domain>/api/v1/poly/copy-trade/targets \
  | jq '.targets[].target_wallet'

# Create
curl -s -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  -X POST -d '{"target_wallet":"0x<wallet>"}' \
  https://candidate-a.<domain>/api/v1/poly/copy-trade/targets \
  | jq '.target.target_id'
# → capture this uuid

# Delete
TARGET_ID=<the-uuid-from-above>
curl -s -H "Cookie: $COOKIE" -X DELETE \
  "https://candidate-a.<domain>/api/v1/poly/copy-trade/targets/$TARGET_ID" \
  | jq
# → should be { deleted: true }
```

**What good looks like:** POST returns 201 with `target.target_id` as a valid UUID; GET shows that id; DELETE by that id returns `{deleted:true}`; subsequent GET no longer shows the wallet.

**Failure modes:**

- DELETE returns 404 → Bug #2 regressed; contract `target_id` is back to UUIDv5-from-wallet. Check `target_id` value vs `polyCopyTradeTargets.id` row value directly in DB.
- POST returns 500 with `Tenant mismatch` in the logs → `accountsForUser.getOrCreateBillingAccountForUser` returned a `billing_account_id` different from what RLS clamped to. Rare — indicates session/auth drift. Look at the Loki event `poly.copy_trade.targets.tenant_mismatch`.

### Step 4 — Verify cross-tenant isolation (requires 2 accounts)

With two dashboard sessions (user A + user B on candidate-a):

1. User A adds `0xA...A` via the `+` button.
2. User B adds `0xB...B`.
3. Both dashboards show ONLY their own tracked wallet in the "Monitored Wallets" card (+ the top-wallets leaderboard unchanged).
4. If user B tries to delete user A's id (e.g. via crafted `curl`), expect 404.

**What good looks like:** row isolation holds; the mirror pod logs `poly.mirror.decision` events attributing fills correctly to each tenant's `billing_account_id`.

### Step 5 — Verify the mirror poll still ticks under shared execution

Watch Loki for ~60s after deploy:

```
{app="poly-node-app"} | json | event=~"poly.mirror.*"
```

**What good looks like:**

- `poly.mirror.poll.singleton_claim` fires once.
- `poly.wallet_watch.fetch` fires every 30s with `raw=N, fills=N, phase=ok` for each enumerated target.
- `poly.mirror.decision` events on real fills, with `target_id` + `billing_account_id` fields present.
- Zero `poly.mirror.poll.tick_error` events.

### Step 6 — Rollback plan

If Step 1 fails or Step 2 shows any cross-tenant leak:

```bash
# 1. Re-deploy the previous image via Argo rollback
argocd app rollback poly-node-app-candidate-a 0

# 2. Revert migration 0029. CAUTION: this rebuilds the Phase-0 schema.
#    Use the schema from 0027_silent_nextwave.sql as the restore target.
#    There is no auto-generated down-migration; hand-written revert script required.
```

Filed a bug with the failure mode in `work/items/bug.*.md` and link it to task.0318 Review Feedback.

## Known non-blockers (documented, deferred)

1. **task.0332** — Shared batched poller. When N tenants track the same wallet, N polls fire. Blocks Phase 3.
2. **PR #944 drizzle-kit snapshot chain** — `0027_snapshot.json` self-references in `prevId`. Migration 0029 is hand-written (matches 0024-0026 pattern), no snapshot added. Future `db:generate` runs may want the chain repaired.
3. **Phase A tests can't run locally** — no `.env.test` in fresh worktrees. CI executes the component + stack suites via testcontainers.

## Next command

`/closeout task.0318` (or the equivalent closeout pass on rev 1) → update PR #944 body with the fixes, then `/review-implementation` for a second look.
