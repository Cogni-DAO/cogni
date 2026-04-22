---
id: task.0348
type: task
title: "Poly wallet — orphan sweep for user-wallets Privy app"
status: needs_design
priority: 3
rank: 18
estimate: 2
summary: "Add an ops-safe orphan sweep for Privy user wallets that were created during provisioning attempts but never committed as active `poly_wallet_connections` rows. Keep it separate from task.0318's v0 path so per-tenant wallet provisioning and real CLOB trading can ship first."
outcome: "Operators can run a dry-run sweep against the user-wallets Privy app, see which wallets have no matching active DB row, and optionally delete only the wallets that are older than 24h and hold zero MATIC and zero USDC.e. The runtime path stays unchanged; this is operational cleanup, not feature behavior."
spec_refs:
  - poly-trader-wallet-port
  - poly-multi-tenant-auth
assignees: []
project: proj.poly-copy-trading
pr:
created: 2026-04-21
updated: 2026-04-21
labels: [poly, polymarket, wallets, privy, ops]
external_refs:
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
  - docs/spec/poly-trader-wallet-port.md
  - docs/guides/poly-wallet-provisioning.md
---

# task.0348 — Poly wallet orphan sweep

> Split out of [task.0318](task.0318.poly-wallet-multi-tenant-auth.md) on 2026-04-21. Useful hygiene, but not a v0 trading blocker.

## Context

`provision()` is intentionally advisory-locked and transactional, but it still creates the Privy wallet before the DB row commits. Any failure between `createWallet()` and the final insert can leave an unused backend wallet behind. That is an acceptable correctness tradeoff for v0 because retries stay safe and the orphan set is bounded, but it does leave ops cleanup work.

The original Phase B checklist kept the orphan sweep inside B2. In practice that bloats the merge bar for the feature that actually matters: prove per-tenant provisioning, derive real CLOB creds, and get real trades onto a tenant-owned wallet. The sweep is cleanup. It should be tracked, designed, and shipped on its own.

## Goal

Provide an explicit dry-run-first script for the user-wallets Privy app that:

1. lists server wallets from Privy
2. cross-references active `poly_wallet_connections`
3. flags only wallets that are older than 24h, have no matching active row, and hold zero MATIC plus zero USDC.e
4. deletes flagged wallets only when an operator passes `--apply`

## Non-goals

- Rewriting the provisioning flow to eliminate all possible orphans
- Scheduled cleanup or cron wiring
- Preview / production automation
- Any runtime behavior change in `POST /api/v1/poly/wallet/connect` or the executor path

## Design constraints

- Dry-run is the default; deletion requires explicit `--apply`
- Match on `privy_wallet_id` first, not address heuristics
- Balance checks are mandatory before delete
- Scope is the dedicated `PRIVY_USER_WALLETS_*` app only, never the operator-wallet app
- Output should be operator-readable: total wallets, matched active rows, flagged candidates, deleted count

## Validation

- [ ] Running the script without `--apply` against a seeded fixture prints flagged wallets but deletes nothing.
- [ ] A wallet with either non-zero MATIC or non-zero USDC.e is reported as retained, not deletable.
- [ ] `--apply` deletes only wallets already shown as safe-to-delete in dry-run output.
- [ ] A wallet that still has an active `poly_wallet_connections` row is never flagged.

## Why separate from task.0318

- task.0318 v0 still has one real blocker: B2.12, the real CLOB creds factory.
- The orphan sweep does not help candidate-a prove provisioning or real trading.
- Shipping it later keeps the merge bar honest and the review surface smaller.
