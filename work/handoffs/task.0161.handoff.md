---
id: task.0161.handoff
type: handoff
work_item_id: task.0161
status: active
created: 2026-03-12
updated: 2026-03-12
branch: feat/governance-integration
last_commit: 8d63f999
---

# Handoff: Governance Signal Executor + Proposal Launcher

## Context

- Cogni DAO governance requires three capabilities: automated PR review, on-chain proposal creation, and signal execution (on-chain vote → GitHub action). These lived in three standalone repos: `cogni-git-review`, `cogni-proposal-launcher`, `cogni-git-admin`.
- This branch consolidates all three into cogni-template as a single deployment. PR review was already ported (pre-existing). This work adds signal execution and the proposal launcher page.
- The e2e loop: PR fails review → dev clicks deep link → creates Aragon proposal → DAO votes → CogniAction emitted on-chain → Alchemy webhook → cogni-template verifies via RPC → merges PR.
- All DAO contract addresses are governed in `.cogni/repo-spec.yaml`, not env vars.

## Current State

- **Code: DONE.** All three subsystems implemented, tests pass, `pnpm check` clean.
- **PR #549 open** against staging, 22 commits, ready for merge.
- **Specs written:**
  - `docs/spec/governance-signal-execution.md` — as-built spec for signal execution (active)
  - `docs/spec/dao-governance-loop.md` — draft spec for the e2e loop (has open questions)
- **NOT deployed.** Infrastructure wiring (Alchemy webhook subscription, GitHub App permissions, `base_url` in repo-spec) not yet done.
- **E2E test (task.0159)** is `needs_design` — no automated e2e validation yet.

## Decisions Made

- Single GitHub App for both review bot and signal executor (crawl simplicity) — see `docs/spec/dao-governance-loop.md#SINGLE_GITHUB_APP`
- In-memory tx hash dedup (not DB-backed) — acceptable for crawl, tracked as open question in draft spec
- `extractDaoConfig()` is the canonical accessor in `@cogni/repo-spec` — no duplicate type definitions in app code
- `/propose/merge` is a public route (no auth, wallet-connect only) — matches standalone proposal-launcher behavior
- `repoUrl` validated against GitHub HTTPS allowlist regex to prevent XSS
- Fire-and-forget dispatch pattern (same as PR review) — errors logged, never block webhook response

## Next Actions

- [ ] **Merge PR #549** to staging
- [ ] **Configure GitHub App permissions**: add `administration: write` + `contents: write` (needed for merge + collaborator actions)
- [ ] **Create Alchemy webhook**: ADDRESS_ACTIVITY subscription monitoring the CogniSignal contract address (`0xb87acef56be3ccfc6a71c48fb0a2276ff395d1af` on Base)
- [ ] **Update `base_url`** in `.cogni/repo-spec.yaml` from `http://localhost:3000` to deployed URL
- [ ] **Set `ALCHEMY_WEBHOOK_SECRET`** and `EVM_RPC_URL` in deployment environment
- [ ] **Implement task.0159**: E2E test — replay real Alchemy webhook payload, verify RPC decode pipeline
- [ ] **Resolve open questions** in `docs/spec/dao-governance-loop.md` (DB dedup, nonce protection, app scoping, `/join` page)
- [ ] **Live-fire test**: create a test PR → review fails → create proposal on Sepolia → vote → verify webhook fires → verify PR merges

## Risks / Gotchas

- **In-memory dedup resets on deploy**: if Alchemy retries a webhook after a redeploy, the same tx could execute twice. Mitigated by GitHub API idempotency (merging an already-merged PR is a no-op), but `grant:collaborator` is not idempotent. Walk phase should add DB-backed dedup.
- **GitHub App needs installation on target repo**: `dispatchSignalExecution()` looks up the installation ID per repo. If the app isn't installed on the target repo, the action silently fails (logged as error).
- **Sepolia vs Base contracts**: repo-spec currently has Base mainnet addresses. For testing, you need Sepolia contracts (see `task.0159` for addresses). Don't mix them.
- **`base_url` is `localhost`**: deep links in Check Run summaries point to localhost until updated. Review bot works fine, but the "Propose Vote" link won't work for anyone else.

## Pointers

| File / Resource                                     | Why it matters                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `docs/spec/dao-governance-loop.md`                  | Draft spec — the target state for the e2e loop. Open questions live here. |
| `docs/spec/governance-signal-execution.md`          | As-built spec — invariants, schemas, file pointers for signal execution.  |
| `docs/design/governance-integration-crawl.md`       | Original design doc — architecture rationale for the consolidation.       |
| `docs/guides/alchemy-webhook-setup.md`              | How to set up Alchemy webhooks + SMEE tunnel for local dev.               |
| `apps/operator/src/features/governance/AGENTS.md`   | Public surface of the governance feature (exports, routes, boundaries).   |
| `work/items/task.0159.governance-e2e-validation.md` | Next work item — e2e test plan with Sepolia contract addresses.           |
| `cogni-git-admin/e2e/` (sister repo)                | Reference e2e suite with Playwright tests for the live-fire flow.         |
| `.cogni/repo-spec.yaml` lines 40-45                 | DAO contract addresses — update `base_url` before deploy.                 |
