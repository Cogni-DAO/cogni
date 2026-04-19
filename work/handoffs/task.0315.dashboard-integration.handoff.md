---
id: task.0315.dashboard-integration.handoff
type: handoff
work_item_id: task.0315
status: active
created: 2026-04-18
updated: 2026-04-18
branch: feat/poly-mirror-v0
last_commit: ff7458965
audience: the dev on PR #918 (feat/poly-mirror-dashboard)
---

# Handoff — mirror backend is live; wire your dashboard to it

## Context

You opened [PR #918](https://github.com/Cogni-DAO/node-template/pull/918) (`feat/poly-mirror-dashboard`) before the backend was fully validated. It's validated now.

- PR #920 (`feat/poly-mirror-v0`, ready-to-merge) shipped the mirror backend: poll + wallet-watch + coordinator + order-ledger + 3 read APIs + candidate-a deployment.
- End-to-end live-money validation on candidate-a 2026-04-18 — mirror detected + copied a real $4.925 BUY with a $0.985 mirror order in ≤90s. Evidence on PR #920.
- Branch `feat/poly-mirror-v0` is rebased on current main and already contains everything #918 needs server-side.

## Read this first — the domain skill

**`.claude/skills/poly-dev-expert/SKILL.md`** is the single orientation doc for anyone touching poly code (backend or frontend). It covers: wallet roles (operator vs target), onboarding (USDC.e + CTF), scripts arsenal, mirror runtime wiring, observability signals, **EOA-vs-Safe-proxy UI divergence** (this one will bite your dashboard hard — see below), and anti-patterns. Read it before debugging anything that looks like "the trade never happened."

Also:

- [task.0315](../items/task.0315.poly-copy-trade-prototype.md) — parent spec + P2 RLS note
- [task.0323](../items/task.0323.poly-copy-trade-v1-hardening.md) — **v0 gaps your dashboard will surface** (status-sync lag, noopMetrics, balance-endpoint client rebuild)
- [task.0322](../items/task.0322.poly-copy-trade-phase4-design-prep.md) — P4 streaming / adversarial design
- [PR #920 evidence comment](https://github.com/Cogni-DAO/node-template/pull/920#issuecomment-4274910814) — validation scorecard

## The three endpoints your dashboard consumes

All Zod-contract-driven. Use `z.infer` from `packages/node-contracts/src/` — **do not redeclare types**.

| Endpoint                              | Route file                                                   | Contract                                 |
| ------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `GET /api/v1/poly/wallet/balance`     | `nodes/poly/app/src/app/api/v1/poly/wallet/balance/route.ts` | `poly.wallet.balance.v1.contract.ts`     |
| `GET /api/v1/poly/copy-trade/orders`  | `.../copy-trade/orders/route.ts`                             | `poly.copy-trade.orders.v1.contract.ts`  |
| `GET /api/v1/poly/copy-trade/targets` | `.../copy-trade/targets/route.ts`                            | `poly.copy-trade.targets.v1.contract.ts` |

These return **empty / degraded shapes** when no target is set (`COPY_TRADE_TARGET_WALLET` unset or `poly_copy_trade_config.enabled=false`). That's the designed fallback — render "monitoring inactive" states, not errors.

## Three dashboard gotchas surfaced during validation

### 1. EOA-vs-Safe-proxy profile redirects

The operator trades via `signatureType: EOA` — shares settle against the EOA on-chain. **Polymarket's `/profile/<EOA>` URL auto-redirects to a deterministic Safe-proxy address** which is empty forever for EOA-direct accounts. If your UI links to `polymarket.com/profile/<operator>`, users will see a blank page and think the mirror is broken.

**Correct links:**

- Positions as data: `https://data-api.polymarket.com/positions?user=<EOA>`
- Trades as data: `https://data-api.polymarket.com/trades?user=<EOA>&limit=<N>`
- Per-market activity: drill into a market → Activity tab → filter by EOA
- Polygonscan tx hash for settlement proof (available in Data-API `transactionHash`)

### 2. Ledger `status=open` is stale

`poly_copy_trade_fills.status` is set at placement time and **never re-read from CLOB**. A row showing `status=open` may already be filled (or canceled) on-chain. Cross-check against Data-API `/positions` for ground truth, or show both "ledger status" + "on-chain status" as distinct columns. Reconciler is [task.0323 §2](../items/task.0323.poly-copy-trade-v1-hardening.md).

### 3. Every poll tick emits `skipped:already_placed`

`poly.mirror.decision` fires 2× per minute per detected fill with `reason=already_placed` (dedup working, cursor stuck at max_ts). If you tail Loki live, this looks like noise — it is; it's noted in task.0323 §1. Not a failure. Your UI's "recent decisions" feed should either filter `already_placed` or group by `fill_id`.

## Candidate-a state (as of 2026-04-18 21:45 UTC)

- `poly-node-app-668cf9cbf5-qh2fl` running PR #920 digest
- `COPY_TRADE_TARGET_WALLET=0x50f4748f1096Dcf792eF80f954eE30204Ee3c42B` (test wallet) patched directly into `poly-node-app-secrets`
- `poly_copy_trade_config.enabled=true` (left enabled for your testing — flip off via psql if needed)
- One row in `poly_copy_trade_fills` from the validation trade (status=open but actually filled + sold; don't be confused)

To disable before promotion: `UPDATE poly_copy_trade_config SET enabled=false WHERE singleton_id=1;` on the candidate-a poly DB (`84.32.109.160:5432/cogni_poly`, creds in `poly-node-app-secrets.DATABASE_URL`).

## Key backend files for dashboard dev

| File                                                             | Why you care                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `nodes/poly/app/src/app/api/v1/poly/wallet/balance/route.ts`     | Wallet card — USDC.e + MTM                                    |
| `nodes/poly/app/src/app/api/v1/poly/copy-trade/orders/route.ts`  | Orders table source                                           |
| `nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/route.ts` | Monitored-wallets card source                                 |
| `packages/node-contracts/src/poly.*.v1.contract.ts`              | Shape contracts (Zod) — `z.infer` these                       |
| `nodes/poly/app/src/features/trading/order-ledger.ts`            | How rows land in `poly_copy_trade_fills` (dedup, status enum) |
| `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts`   | Decision logic (if you render decision reasons)               |
| `.claude/skills/poly-dev-expert/SKILL.md`                        | Everything else                                               |

## Scripts to replay the validation locally

If you need to reproduce a mirror event while hacking the dashboard:

```bash
# Place a real $5 BUY from the test wallet that the mirror watches:
pnpm dotenv -e .env.test -- pnpm tsx scripts/experiments/raw-pk-polymarket-order.ts \
  place --token-id <tokenId> --price <near-market> --size 5 \
  --side BUY --outcome YES --yes-real-money

# Close it later (requires onboard-raw-pk-wallet.ts to have been run for CTF approvals):
pnpm dotenv -e .env.test -- pnpm tsx scripts/experiments/raw-pk-polymarket-order.ts \
  place --token-id <tokenId> --price <below-bid> --size <size_usdc> \
  --side SELL --outcome YES --yes-real-money
```

Within ≤90s the poly pod on candidate-a mirrors the BUY. Watch Loki: `{namespace="cogni-candidate-a"} |~ "poly\\.mirror\\.decision"`.

## Merge order

1. PR #920 (backend) merges first — ready now
2. Rebase #918 on main
3. Your dashboard PR is then purely frontend (you'll pick up the rebased import paths automatically)

## Contact

The backend's PR #920 validation comment enumerates every signal the dashboard can render, and `.claude/skills/poly-dev-expert/SKILL.md` is your runbook. Ping in PR if anything here is stale.
