---
id: task.0161
type: task
title: "Governance signal executor: Alchemy webhook → on-chain verification → GitHub actions"
status: needs_merge
priority: 0
rank: 1
estimate: 3
summary: "Add Alchemy webhook ingestion and on-chain signal execution to cogni-template. Alchemy webhooks arrive at /api/internal/webhooks/alchemy, are verified (HMAC), normalized to ActivityEvents, then the signal handler independently re-fetches the tx from RPC, decodes the CogniAction event, and executes the GitHub action (merge PR, grant/revoke collaborator). Tx hash dedup prevents replay. DAO config read from repo-spec.yaml (not env vars). Deep link URL in review summary wired with full query params."
outcome: "Full governance loop operational: on-chain CogniAction signal → Alchemy webhook → cogni-template verifies on-chain → executes GitHub action. Review bot failure comments include working deep link to proposal launcher. Idempotent — duplicate webhooks are no-ops."
spec_refs:
  - architecture-spec
  - governance-signal-execution
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch: feat/governance-integration
pr: https://github.com/Cogni-DAO/node-template/pull/549
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-11
updated: 2026-03-12
labels: [governance, alchemy, signal, github-actions]
external_refs:
  - docs/design/governance-integration-crawl.md
---

# Governance Signal Executor

## Requirements

- **Alchemy webhook ingestion**: `AlchemyWebhookNormalizer` implements `WebhookNormalizer` port — HMAC-SHA256 verification + payload normalization to `ActivityEvent[]`
- **On-chain re-verification**: Signal handler MUST re-fetch tx receipt from RPC via viem and independently decode the `CogniAction` event. Never trust webhook payload for action parameters
- **Idempotency**: Track executed tx hashes (in-memory Set for crawl). Reject duplicates before action execution
- **DAO config from repo-spec**: Read `signal_contract`, `dao_contract`, `chain_id` from `.cogni/repo-spec.yaml` at runtime. Only `ALCHEMY_WEBHOOK_SECRET` is an env var (it's a secret)
- **Action handlers**: `merge:change` (merge PR), `grant:collaborator` (add admin), `revoke:collaborator` (remove access + cancel pending invitations)
- **GitHub auth**: Reuse existing `GH_REVIEW_APP_ID` / `GH_REVIEW_APP_PRIVATE_KEY_BASE64` credentials. App needs `administration: write` + `contents: write` permissions
- **Deep link wiring**: Review summary formatter generates full `/merge-change?dao=...&plugin=...&signal=...&chainId=...&repoUrl=...&pr=...&action=merge&target=change` URL, not bare `base_url`
- **Zod contract**: `Signal` and `ActionResult` types defined as Zod schemas for runtime validation of decoded on-chain events
- **Flat structure**: No premature subdirectories — flatten to ~5 feature files

## Allowed Changes

- `apps/operator/src/adapters/server/ingestion/alchemy-webhook.ts` — new normalizer
- `apps/operator/src/features/governance/` — new feature (signal handler, parser, actions, types, barrel)
- `apps/operator/src/features/review/summary-formatter.ts` — deep link URL construction
- `apps/operator/src/features/review/services/review-handler.ts` — pass full DAO config to formatter
- `apps/operator/src/bootstrap/container.ts` — register alchemy normalizer
- `apps/operator/src/app/api/internal/webhooks/[source]/route.ts` — add alchemy secret resolution + signal dispatch
- `apps/operator/src/shared/env/server-env.ts` — add `ALCHEMY_WEBHOOK_SECRET`
- `.env.local.example` — document new env var
- `apps/operator/src/shared/config/` — repo-spec DAO config reader (if not already present)
- `apps/operator/tests/unit/features/governance/` — unit tests
- `apps/operator/src/features/governance/AGENTS.md` — feature documentation

## Plan

- [ ] **1. Zod contract + types**: Create `apps/operator/src/features/governance/types.ts` with Zod schemas for `Signal` (dao, chainId, vcs, repoUrl, action, target, resource, nonce, deadline, paramsJson, executor) and `ActionResult` (success, error, txHash)
- [ ] **2. Alchemy webhook normalizer**: Create `AlchemyWebhookNormalizer` implementing `WebhookNormalizer` — `verify()` uses HMAC-SHA256 of raw body, `normalize()` extracts tx hashes from Alchemy `ADDRESS_ACTIVITY` payloads → `ActivityEvent[]`
- [ ] **3. Register normalizer**: Add `"alchemy"` to `getWebhookRegistrations()` in `bootstrap/container.ts`, add `case "alchemy"` to `resolveWebhookSecret()` in webhook route, add `ALCHEMY_WEBHOOK_SECRET` to server env schema
- [ ] **4. Signal parser**: Port `parseCogniAction()` from cogni-git-admin — decode `CogniAction` event from tx receipt logs using viem `decodeEventLog`. Port `CogniSignal.json` ABI. Parse `extra` field (nonce, deadline, paramsJson). Validate against Zod `Signal` schema
- [ ] **5. Repo-spec DAO config reader**: Read `cogni_dao` section from `.cogni/repo-spec.yaml` at runtime — `dao_contract`, `plugin_contract`, `signal_contract`, `chain_id`, `base_url`. Cache on first read
- [ ] **6. Action handlers**: Port from cogni-git-admin into single `actions.ts` — three exported functions: `mergeChange()`, `grantCollaborator()`, `revokeCollaborator()`. Each uses Octokit from `createOctokitForInstallation()`
- [ ] **7. Signal handler service**: Orchestrator: receive tx hash → fetch receipt via viem RPC → decode CogniAction → validate chain_id + dao_address match repo-spec → check tx hash dedup set → resolve action handler → execute → return ActionResult
- [ ] **8. Dispatch wiring**: Add `dispatchSignalExecution()` in webhook route for `source === "alchemy"` — fire-and-forget, same pattern as `dispatchPrReview()`
- [ ] **9. Deep link URL construction**: Create pure function `buildMergeChangeUrl(daoConfig, prContext)` in `features/governance/`. Update `summary-formatter.ts` to use it. Update `review-handler.ts` to pass full DAO config (not just base_url)
- [ ] **10. Tests**: Unit tests for signal parser (with fixture), action handlers (mocked Octokit), Alchemy normalizer (verify + normalize), deep link URL builder, tx hash dedup
- [ ] **11. AGENTS.md**: Create `features/governance/AGENTS.md`
- [ ] **12. Validate**: `pnpm check` passes

## Validation

**Command:**

```bash
pnpm check
pnpm test apps/operator/tests/unit/features/governance/
```

**Expected:** All lint, type, format checks pass. All unit tests pass.

## Review Checklist

- [ ] **Work Item:** `task.0155` linked in PR body
- [ ] **Spec:** architecture-spec hex boundaries upheld (adapters → ports, features → ports/core)
- [ ] **Spec:** on-chain re-verification — signal handler fetches tx from RPC, never trusts webhook payload
- [ ] **Spec:** repo-spec is source of truth for DAO config (not env vars)
- [ ] **Tests:** signal parser, action handlers, normalizer, deep link builder all have unit tests
- [ ] **Tests:** tx hash dedup tested (same hash rejected on second call)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Design doc: docs/design/governance-integration-crawl.md
- Source: cogni-git-admin (signal parser, action handlers)
- Related: proj.web3-gov-mvp (proposal launcher pages — separate PR)
- Handoff: [handoff](../handoffs/task.0161.handoff.md)

## Attribution

-
