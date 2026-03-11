---
id: task.0156
type: task
title: "Governance signal executor e2e test — live Sepolia tx + webhook replay"
status: needs_design
priority: 1
rank: 99
estimate: 2
summary: "Add e2e test for governance signal executor: replay a real Alchemy webhook payload against the running app, verify RPC fetch + decode + DAO config validation succeeds. Optionally, full live-fire test (wallet → Aragon proposal → Alchemy webhook → PR merge) as a deployment-verification smoke test."
outcome: "Governance signal execution pipeline validated end-to-end against real on-chain data."
spec_refs:
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-12
updated: 2026-03-12
labels: [governance, e2e, testing]
external_refs:
  - cogni-git-admin/e2e/AGENTS_E2E_MVP.md
  - cogni-git-admin/e2e/tests/blockchain-pr-merge.spec.ts
  - cogni-git-admin/e2e/tests/fixture-replay.spec.ts
---

# Governance Signal Executor E2E Test

## Context

cogni-git-admin has a full e2e suite (`e2e/`) that tests the complete DAO vote → GitHub action flow:

1. **fixture-replay** — POST captured Alchemy webhook JSON to running app (fast, 30s). Currently `test.skip`'d — fixture targets a stale PR.
2. **blockchain-integration** — live wallet tx on Sepolia, wait for real Alchemy webhook, poll GitHub for PR merge (slow, 5min).

Signal executor is now ported to cogni-template (task.0155). We need equivalent validation here.

### Sepolia contracts (same as cogni-git-admin)

- Signal: `0x8f26cf7b9ca6790385e255e8ab63acc35e7b9fb1`
- DAO: `0xB0FcB5Ae33DFB4829f663458798E5e3843B21839`
- Admin plugin: `0x77BA7C0663b2f48F295E12e6a149F4882404B4ea`

## Requirements

- **Tier 1 (`test:external`):** POST a crafted Alchemy webhook payload (valid HMAC) to `/api/internal/webhooks/alchemy` on a running app. Payload references a real Sepolia tx containing a CogniAction event. Validates: HMAC verify → normalize → RPC fetch → decode → DAO config check. GitHub action fails (no matching PR) — expected and asserted.
- **Tier 2 (deploy smoke, optional):** Full live-fire: create test PR → wallet submits Aragon proposal → wait for Alchemy webhook → verify PR merged. Post-deploy only, not CI.

## Allowed Changes

- `tests/external/governance/` — external tests
- `tests/external/governance/fixtures/` — captured Alchemy webhook payloads
- `.env.local.example` — document e2e env vars
- `e2e/` — deployment smoke test (tier 2)

## Plan

- [ ] Capture a real Alchemy webhook payload for a known Sepolia CogniAction tx (or reuse from cogni-git-admin)
- [ ] Write tier 1 external test: construct HMAC, POST to webhook endpoint, assert 200 + signal handler RPC fetch + decode succeeded
- [ ] Write tier 2 deploy smoke script (optional): port `blockchain-pr-merge.spec.ts` flow
- [ ] Document required env vars

## Validation

**Command:**

```bash
pnpm test:external tests/external/governance/
```

**Expected:** Tier 1 passes against running app with `EVM_RPC_URL` + `ALCHEMY_WEBHOOK_SECRET`.

## Review Checklist

- [ ] **Work Item:** `task.0156` linked in PR body
- [ ] **Tests:** tier 1 exercises HMAC → RPC → decode pipeline
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Reference: cogni-git-admin e2e suite
- Depends on: task.0155

## Attribution

-
