---
id: task.0409
type: task
title: "Multi-tenant git-review routing — operator selects target repo (test vs prod) via per-tenant GitHub App"
status: needs_design
priority: 0
rank: 1
estimate: 5
branch:
summary: "Operator review pipeline currently has a single GitHub App identity and a single `GH_REPOS` allowlist. To run `pnpm test:external` safely, the operator must support a tenant model: at least two distinct GitHub Apps (one prod, one test) each scoped to its own repo set, routed deterministically per webhook delivery so a production App never reviews a test-repo PR and a test App never touches production. Unblocks the post-#1067 test:external flow + sets up the test-environment Cogni-DAO/test-repo as a permanent fixture rather than a default-drifted afterthought."
outcome: "(1) Operator boots with N tenant configurations (e.g. `prod`, `test`), each carrying its own `GH_REVIEW_APP_ID`, private key, webhook secret, and `GH_REPOS` allowlist. (2) Webhook handler picks the tenant by validating the webhook signature against each tenant's secret in turn — only the matching tenant's App responds. (3) `dispatch.server.ts` and downstream Temporal workflow inputs carry a `tenantId` field; activities resolve App creds + Octokit per-tenant. (4) `pnpm test:external` (operator + others) targets `Cogni-DAO/test-repo` via the `test` tenant — no env-default drift between code (`derekg1729/test-repo`) and AGENTS.md (`Cogni-DAO/test-repo`). (5) `test.cognidao.org` agent (test-environment operator deploy) accepts an authed agentic-API DM, picks a real PR on `Cogni-DAO/test-repo`, and selectively flights it via `vcs/flight`. That round-trip is the first deploy_verified for this work."
spec_refs:
  - vcs-integration
  - github-app-webhook-setup
assignees: derekg1729
credit:
project: proj.vcs-integration
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [vcs, multi-tenant, github-app, review, test-infra, operator]
external_refs:
  - work/items/task.0410.reviewer-per-node-routing.md
  - work/items/task.0407.review-modelref-from-repo-spec.md
  - work/items/task.0411.split-temporal-workflows-per-node.md
  - docs/guides/github-app-webhook-setup.md
  - docs/guides/agent-api-validation.md
---

## Problem

Today the operator's review pipeline knows one GitHub App. `.env.local` carries a single `GH_REVIEW_APP_ID` + `GH_WEBHOOK_SECRET` + `GH_REPOS`. The webhook handler trusts that secret, the activity reads that App ID, the dispatcher uses that installation. There is no notion of "this delivery belongs to the test tenant." Concrete consequences right now:

- `pnpm test:external` cannot be run safely against the production App, because the operator's prod webhook would receive PR events for any test-repo activity.
- The `single-node-scope-e2e.external.test.ts` test added by PR #1067 default-targets **`Cogni-DAO/node-template`** (production). User policy is "test-repo only." So that suite is currently un-runnable as-shipped.
- The reviewer e2e (`pr-review-e2e.external.test.ts`) has the same drift pattern: code default `derekg1729/test-repo`, AGENTS.md canonical `Cogni-DAO/test-repo` — neither is wired through a separate App identity, so the safety story is "trust the env override and don't share credentials."
- There is no path for a deployed `test.cognidao.org` operator instance to coexist with the production operator on the same source code without risk of cross-routing.

## Symptoms / blocking impact

- 🔴 `pnpm test:external` post-#1067 is blocked. Test default points at production repo; flipping it to test-repo without separate App identity is just hiding the routing problem.
- 🔴 `Cogni-DAO/test-repo` exists but has no fixture App installed — the bootstrap PR #920 currently exercises the dev App by way of `derekg1729/test-repo`. Test-repo cannot become canonical until there's a tenant-routed App for it.
- 🔴 No agentic-API validation flow exists for "DM the test agent → it flights a real test-repo PR." Required as the deploy_verified gate for this entire VCS-integration project.

## Design questions to resolve

1. **Tenant identification.** Each GitHub App webhook delivery carries an `X-Hub-Signature-256` HMAC over the body. Validate against each tenant's secret in turn — first match wins. No header parsing tricks, no path-based routing. This is the standard multi-tenant pattern for GitHub Apps and matches what the `octokit/webhooks` library already supports natively.
2. **Tenant config shape.** Either `.env.local` lists `GH_TENANTS=prod,test` and per-tenant prefixed vars (`GH_REVIEW_APP_ID_PROD`, `GH_REVIEW_APP_ID_TEST`, …), OR a JSON blob `GH_TENANTS_CONFIG=[{...},{...}]`. Recommend the first — env files are the source of truth for secrets in this stack and a flat shape keeps scripts (`gh secret set`) ergonomic.
3. **Workflow input plumbing.** Add `tenantId: string` to `PrReviewWorkflowInput` (and downstream child workflow inputs). `dispatch.server.ts` reads tenant from the matched webhook context and passes it through. Activities resolve App creds via `getAppCredsForTenant(tenantId)` instead of reading global env. `workflowId` keying gains tenant prefix so test + prod can each have a `pr-review:tenant=test:owner/repo/123/sha` without collision.
4. **Allowlist enforcement per tenant.** Each tenant has its own `GH_REPOS` list. The webhook router rejects (logs + drops) any delivery whose payload `repository.full_name` is not in the matched tenant's list — defense in depth in case a webhook secret leaks.
5. **Test-environment deploy.** `test.cognidao.org` is its own operator pod (separate from prod `cognidao.org`) with the `test` tenant config baked in. Both pods can coexist on candidate-a/preview/prod surfaces. Per-tenant Loki labels for forensics.
6. **`Cogni-DAO/test-repo` migration.** Reconcile the AGENTS.md vs code-default drift: pick `Cogni-DAO/test-repo` as canonical, install the test-tenant App on it, port the existing PR #920 scaffolding bootstrap commit, retire `derekg1729/test-repo` defaults from external test code in the same PR.
7. **Agentic-API validation flow.** `test.cognidao.org` exposes `/api/v1/ai/chat` (existing). Authenticate via API key (existing flow per `docs/guides/agent-api-validation.md`), DM the agent: "flight PR #X on Cogni-DAO/test-repo." Agent uses `core__vcs_flight_candidate` against the test tenant's installation, returns the flight URL. This is the deploy_verified gate.

## Out of scope

- Per-node Temporal workflow split (task.0411) — adjacent architectural concern, can land independently.
- Per-rule modelRef in repo-spec (task.0407) — orthogonal.
- Reviewer per-node routing (task.0410) — already in flight; this task does not change the routing semantics, only the tenant identity used to authenticate the GitHub App calls.
- Per-user / BYO-AI tenants — different problem space (this task is system-actor multi-tenancy only).
- Migrating prod review traffic — prod stays single-tenant for now; test tenant is added alongside.

## Files likely to touch

- `nodes/operator/app/src/app/api/internal/webhooks/github/route.ts` — multi-secret HMAC validation
- `nodes/operator/app/src/bootstrap/github-app/` — per-tenant App-creds resolver
- `nodes/operator/app/src/app/_facades/review/dispatch.server.ts` — tenant in workflow input
- `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` — `tenantId` in input + workflowId key (lands on whatever shape PR #1098 leaves)
- `packages/temporal-workflows/src/activity-types.ts` — activity input gains `tenantId`
- `services/scheduler-worker/src/activities/review.ts` — Octokit per-tenant
- `services/scheduler-worker/src/bootstrap/env.ts` — tenant config schema
- `nodes/operator/app/tests/external/**/*.external.test.ts` — switch to `Cogni-DAO/test-repo` via test tenant; retire `derekg1729/test-repo` default
- `docs/guides/github-app-webhook-setup.md` — add multi-tenant section
- `docs/guides/agent-api-validation.md` — add the test-tenant flight DM recipe
- New: a Cogni-DAO/test-repo bootstrap doc (port from PR #920 history)

## Validation

- **exercise:** (1) Configure two tenants in `.env.local` — `prod` against `derekg1729/test-repo` (legacy, kept as parity), `test` against `Cogni-DAO/test-repo` (new). (2) Push a PR to `Cogni-DAO/test-repo` — the test-tenant App posts a review, prod-tenant stays silent. Push a PR to `derekg1729/test-repo` — prod-tenant App posts, test stays silent. (3) Deploy `test.cognidao.org` carrying only the `test` tenant; from a separate authed shell, DM `/api/v1/ai/chat` on `test.cognidao.org` with "flight PR #X on Cogni-DAO/test-repo" — the agent calls `core__vcs_flight_candidate` and returns the flight workflow URL. (4) `pnpm test:external:operator` from a clean checkout points at `Cogni-DAO/test-repo` with no env override.
- **observability:** `scripts/loki-query.sh '{namespace="cogni-test"} | json | component="webhook-route"' 10 50 | jq '.data.result[].values[][1] | fromjson | {tenantId, eventType, repository}'` — every entry must have `tenantId="test"` and a repository in the test tenant's allowlist. Cross-tenant leak = any line on `cogni-test` namespace with `tenantId="prod"` or a non-allowlisted repository → fail.

## Pointers

- [`docs/guides/github-app-webhook-setup.md`](../../docs/guides/github-app-webhook-setup.md) — single-tenant setup; this task generalizes it
- [`docs/guides/agent-api-validation.md`](../../docs/guides/agent-api-validation.md) — discover → register → auth → execute flow this task validates against
- [PR #920 (derekg1729/test-repo)](https://github.com/derekg1729/test-repo/pull/920) — bootstrap scaffolding to port to Cogni-DAO/test-repo
- [task.0410](task.0410.reviewer-per-node-routing.md) — concurrent reviewer-side routing work; this task is the auth/tenancy layer beneath it
- [task.0411](task.0411.split-temporal-workflows-per-node.md) — adjacent packaging concern; orthogonal
