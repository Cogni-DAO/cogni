---
id: bug.0198
type: bug
title: "Single Privy app shared across preview and production — no env isolation"
status: needs_design
priority: 2
rank: 10
estimate: 2
summary: "One Privy app (one set of PRIVY_APP_ID/SECRET/SIGNING_KEY) is used for both preview and production. Operator wallets created in preview are visible in production and vice versa. repo-spec.yaml has a single operator_wallet section with no env awareness."
outcome: "Separate Privy apps for preview and production. Each environment has its own operator wallet namespace. repo-spec supports per-env wallet config or env-specific overrides."
spec_refs:
  - operator-wallet
assignees: derekg1729
credit:
project: proj.reliability
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-25
updated: 2026-03-25
labels: [security, operator-wallet, privy]
external_refs:
---

## Problem

Privy credentials (APP_ID, APP_SECRET, SIGNING_KEY) are environment-level GitHub secrets, but they all point to the same Privy app. This means:

- Operator wallets created during preview testing exist in production
- No isolation between preview and production wallet state
- A bug in preview could affect production operator wallet

## Root Cause

`repo-spec.yaml` has a single `operator_wallet` section. The Privy adapter reads credentials from env vars but there's only one Privy app configured in the Privy dashboard.

## Fix

1. Create a second Privy app (e.g. "Cogni Preview") in the Privy dashboard
2. Set preview-specific credentials in the `preview` GitHub environment
3. Set production credentials in the `production` GitHub environment
4. Optionally: add `operator_wallet.privy_app_id` per-env to repo-spec, or keep it env-var only

## Validation

```bash
# Verify different app IDs per env
gh secret list --repo Cogni-DAO/node-template --env preview | grep PRIVY_APP_ID
gh secret list --repo Cogni-DAO/node-template --env production | grep PRIVY_APP_ID
# Should show different updated_at timestamps (different values)
```
