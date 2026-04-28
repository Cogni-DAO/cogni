---
id: task.0409
type: task
title: "Multi-tenant git-review routing — operator selects target repo (test vs prod) via per-tenant GitHub App"
status: needs_implement
priority: 0
rank: 1
estimate: 5
branch: feat/task-0409-multi-tenant-git-review-routing
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
revision: 2
blocked_by: []
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [vcs, multi-tenant, github-app, review, test-infra, operator]
external_refs:
  - work/items/task.0403.reviewer-per-node-routing.md
  - work/items/task.0407.review-modelref-from-repo-spec.md
  - work/items/task.0408.split-temporal-workflows-per-node.md
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

- Per-node Temporal workflow split (task.0408) — adjacent architectural concern, can land independently.
- Per-rule modelRef in repo-spec (task.0407) — orthogonal.
- Reviewer per-node routing (task.0403) — already in flight; this task does not change the routing semantics, only the tenant identity used to authenticate the GitHub App calls.
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
- [task.0403](task.0403.reviewer-per-node-routing.md) — concurrent reviewer-side routing work; this task is the auth/tenancy layer beneath it
- [task.0408](task.0408.split-temporal-workflows-per-node.md) — adjacent packaging concern; orthogonal

## Design

### Outcome

Two GitHub App identities (prod, test) coexist on the operator codebase. A delivery to `/api/internal/webhooks/github` is verified against each tenant's secret in turn — first match becomes the active `tenantId` for the rest of the call chain. `tenantId` flows through `dispatchPrReview → PrReviewWorkflow → fetchPrContextActivity` so every Octokit call uses the matched tenant's App creds. `pnpm test:external` becomes safe to run because the test tenant only ever touches `Cogni-DAO/test-repo` and the prod App never wakes up for it.

### Approach

**Solution.** Generalize the existing single-tenant config + dispatch path into a tenant-resolution layer. No new dependencies. No new services. The whole change is config-shape + a try-each-secret loop + a `tenantId` field threaded through the existing workflow input schema.

**Reuses.**

- `@octokit/webhooks-methods` (already a deps in both `nodes/operator/app` and `services/scheduler-worker`) — provides the HMAC `verify(secret, payload, signature)` primitive needed for the try-each-tenant loop.
- Existing `receiveWebhook(deps, params)` ingestion service (`features/ingestion/services/webhook-receiver.ts:43`) — keep its signature untouched; the route resolves the tenant first, then passes the matched secret through unchanged.
- Existing `dispatchPrReview` facade — extend with one new field, no structural change.
- Existing `PrReviewWorkflow` input — extend the workflow's input schema with `tenantId: string`. Per the modelRef-shape lesson (PR #1067), every workflow input field MUST be defined in a single Zod schema in `packages/temporal-workflows/` and consumed via `z.infer<>` at every call site. This task adds that schema if it doesn't already exist (it doesn't today — input is a plain TS interface).
- Existing `ReviewActivityDeps` — generalize from `{ ghAppId, ghPrivateKey }` to `{ tenants: ReadonlyMap<TenantId, TenantCreds> }`. Activity resolves creds per-call by `tenantId`.

**Rejected.**

- **Path-based routing** (`/api/internal/webhooks/github/test`, `/api/internal/webhooks/github/prod`). Requires updating GitHub App webhook URL config every time you add a tenant + breaks the existing `[source]` dynamic route convention. The HMAC try-each-secret pattern is the standard from `octokit/webhooks` docs and survives any future tenant change without GitHub-side reconfiguration.
- **Single GitHub App with installation-id allowlist.** Conflates identity with scope. Test-tenant feature-validation work might intentionally trigger different reviewer behavior, post different comments, use different bot accounts — that requires actual identity separation, not just installation filtering.
- **JSON-blob env (`GH_TENANTS_CONFIG=[...]`).** Forces JSON-string-in-env quoting hell that breaks `gh secret set` ergonomics. Per-tenant prefixed env vars (`GH_REVIEW_APP_ID`, `GH_TEST_REVIEW_APP_ID`) are easier to rotate and visually inspect.
- **Generic N-tenant loader on day 1.** v0 only has two tenants (prod + test). A loader pattern that extracts tenant IDs from a `GH_TENANTS=prod,test` list is over-engineered for the scope; build the two-tenant version with a clean abstraction (`loadTenants(env): Map<TenantId, TenantConfig>`) and generalize when N > 2.

### Resolutions to design questions

The work item enumerated 7 design questions. Each resolved:

1. **Tenant identification — try-each-secret HMAC.** Webhook handler iterates the configured tenants; for each one, calls `verify(tenant.webhookSecret, body, headers["x-hub-signature-256"])` from `@octokit/webhooks-methods`. First success → that tenant. No success → 401. No header inspection, no path tricks. Pure crypto.
2. **Tenant config shape — per-tenant prefixed env vars, backward-compatible.** Existing `GH_REVIEW_APP_ID` / `GH_REVIEW_APP_PRIVATE_KEY_BASE64` / `GH_WEBHOOK_SECRET` / `GH_REPOS` become the **prod** tenant's config (zero-migration for existing deploys). New optional vars `GH_TEST_REVIEW_APP_ID` / `GH_TEST_REVIEW_APP_PRIVATE_KEY_BASE64` / `GH_TEST_WEBHOOK_SECRET` / `GH_TEST_REPOS` define the **test** tenant. A `loadTenants(env): Map<"prod"|"test", TenantConfig>` helper assembles both at boot — only includes a tenant if its complete cred set is present. Worker-side: a parallel JSON env (`GH_TENANTS_CONFIG_JSON`) for the worker's structured-env conventions, populated by deploy infra from the same upstream secrets — same logical config, different transport because workers don't read individual env vars at runtime as ergonomically.
3. **Workflow input plumbing — single Zod schema, contract-tested.** Add `PrReviewWorkflowInputSchema` to `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` (or sibling `schemas.ts`). Both `dispatch.server.ts` and `fetchPrContextActivity` import the schema and use `z.infer<>` for their types. Add a unit test in `tests/unit/packages/temporal-workflows/` that round-trips a fixture through `z.parse()` to catch any future drift — directly addresses the modelRef-shape regression class. `tenantId: z.enum(["prod", "test"])` for v0 (zod refinement makes invalid values fail loudly at the boundary, not silently downstream).
4. **Allowlist enforcement per tenant — webhook router rejects pre-dispatch.** After tenant resolution, the route reads `payload.repository.full_name` and verifies it's in `tenant.allowlist`. Mismatch → log + drop (200 to GitHub, dispatch skipped — secret could leak, allowlist is the second moat). Activity-side also re-checks before any Octokit call as defense-in-depth.
5. **Test-environment deploy — separate operator pod, same code, different env.** `test.cognidao.org` is a sibling deployment of the operator container, env-loaded with **only** the `test` tenant's vars (no `GH_REVIEW_APP_ID` at all). All Pino logs in that pod include `tenantId` from the request context (already mostly there via webhook-route's child logger; just add the field). Loki labels: `namespace="cogni-test"` for the pod, `tenantId="test"` from the structured log payload. Cross-tenant leak detection = any log line in `cogni-test` namespace with `tenantId !== "test"`.
6. **`Cogni-DAO/test-repo` migration — ports the existing scaffolding from `derekg1729/test-repo`.** Re-create the multi-node directory structure (`nodes/{gizmo,sprocket,bertius,operator}/`, `infra/`, `packages/`, root `package.json` + `pnpm-lock.yaml` + ci.yaml) on `Cogni-DAO/test-repo` via a single bootstrap PR — the same shape PR #920 lands on `derekg1729/test-repo` today. Install the test-tenant App on it. Update `nodes/operator/app/tests/external/AGENTS.md` and the `E2E_GITHUB_REPO` defaults in all `.external.test.ts` files to `Cogni-DAO/test-repo`. Retire `derekg1729/test-repo` from code defaults in this PR.
7. **Agentic-API validation flow — uses existing `/api/v1/ai/chat`.** No new endpoint. Flow: (a) authed shell hits `https://test.cognidao.org/.well-known/agent.json` to discover endpoints; (b) registers via `POST /api/v1/agent/register` to get an API key (existing flow per `docs/guides/agent-api-validation.md`); (c) opens a chat session via `/api/v1/ai/chat` with prompt `"flight PR #N on Cogni-DAO/test-repo"`. (d) The operator agent calls `core__vcs_flight_candidate` against the test tenant's installation. (e) Agent returns the flight workflow URL. The only new piece is wiring the agent's `core__vcs_*` tools to honor the tenant context resolved from the request's auth chain — system tenant resolution defaults to `prod`, but a request to `test.cognidao.org` overrides via env (only `test` tenant configured in that pod).

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **TENANT_VERIFY_FIRST**: Webhook signature must be HMAC-validated against a tenant's secret BEFORE any tenant context is established. Match-first-secret is the only acceptable pattern — no header parsing, no payload inspection, no path-based routing. (spec: github-app-webhook-setup)
- [ ] **TENANT_ALLOWLIST_ENFORCED**: After tenant match, `payload.repository.full_name` must be present in the matched tenant's `allowlist` before any dispatch. Mismatch → log + drop. Activity layer re-checks defense-in-depth.
- [ ] **TENANT_ID_IN_WORKFLOW_INPUT**: `tenantId: z.enum([...])` is a required field on `PrReviewWorkflowInputSchema`. Defined exactly once in `packages/temporal-workflows/`. Both dispatch and activities consume via `z.infer<>` — no manual typedefs duplicating the shape.
- [ ] **TENANT_ID_IN_WORKFLOW_KEY**: `workflowId = pr-review:tenant=<tenantId>:<owner>/<repo>/<pr>/<sha>`. Test + prod can run review on the same SHA simultaneously without Temporal collision.
- [ ] **NO_DEFAULT_TENANT_FALLBACK**: If no tenant matches the signature, return 401. No fallback to "first configured" or "prod by default." Silent fallback masks misconfiguration.
- [ ] **PROD_BACKWARD_COMPAT**: Existing prod deploys with only `GH_REVIEW_APP_*` set continue to work unchanged — `loadTenants` produces a single-entry map with `tenantId="prod"`. No env migration required.
- [ ] **SIMPLE_SOLUTION**: No new dependencies; reuses `@octokit/webhooks-methods` already installed. (spec: SIMPLICITY_WINS)
- [ ] **ARCHITECTURE_ALIGNMENT**: Hexagonal — tenant config is a runtime-wiring concern (lives in app/service `bootstrap/`, not in shared packages). The workflow-input schema is pure domain (lives in `packages/temporal-workflows/`). (spec: architecture, packages-architecture)

### Files

<!-- High-level scope. PR #1098 changes the line numbers cited here; rebase first. -->

**Create**:

- `nodes/operator/app/src/bootstrap/tenants/load-tenants.ts` — `loadTenants(env): ReadonlyMap<TenantId, TenantConfig>`. Pure function over env. Reads `GH_REVIEW_APP_*` for prod (back-compat) + `GH_TEST_REVIEW_APP_*` for test. Returns map; only includes a tenant if its complete cred set is present.
- `nodes/operator/app/src/bootstrap/tenants/types.ts` — `TenantId`, `TenantConfig` (`appId, privateKey, webhookSecret, allowlist: ReadonlyArray<string>`).
- `nodes/operator/app/src/bootstrap/tenants/AGENTS.md` — module contract.
- `tests/unit/nodes/operator/bootstrap/load-tenants.test.ts` — happy paths + missing-cred + back-compat fixture.
- `tests/unit/packages/temporal-workflows/pr-review-input-contract.test.ts` — round-trip `z.parse` of a fixture; asserts dispatch and activities both produce/consume schemata that pass.
- `services/scheduler-worker/src/bootstrap/tenants.ts` — JSON-env loader that produces the same `Map<TenantId, TenantConfig>` shape from `GH_TENANTS_CONFIG_JSON`.

**Modify**:

- `nodes/operator/app/src/shared/env/server-env.ts` — add `GH_TEST_REVIEW_APP_ID`, `GH_TEST_REVIEW_APP_PRIVATE_KEY_BASE64`, `GH_TEST_WEBHOOK_SECRET`, `GH_TEST_REPOS` (all optional).
- `nodes/operator/app/src/app/api/internal/webhooks/[source]/route.ts` — replace `resolveWebhookSecret` with `resolveTenant(tenants, source, headers, body): {tenantId, secret} | null`; pass `tenantId` to `dispatchPrReview`. The existing `receiveWebhook` call gets the matched secret unchanged.
- `nodes/operator/app/src/app/_facades/review/dispatch.server.ts` — accept `tenantId` from caller; include in workflow input + `workflowId` template; fail-fast if tenantId not in configured tenants map.
- `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` — add `PrReviewWorkflowInputSchema` (Zod) with `tenantId: z.enum(["prod", "test"])`. Existing TS interface becomes `z.infer<typeof PrReviewWorkflowInputSchema>`. NB: PR #1098 currently in flight modifies this file; rebase clean.
- `packages/temporal-workflows/src/activity-types.ts` — add `tenantId: string` to `fetchPrContextActivity` input + `postReviewResultActivity` input.
- `services/scheduler-worker/src/bootstrap/env.ts` — add `GH_TENANTS_CONFIG_JSON` (optional JSON string, validated by Zod schema matching tenant config shape).
- `services/scheduler-worker/src/worker.ts` — pass tenant map to `createReviewActivities`.
- `services/scheduler-worker/src/activities/review.ts` — `ReviewActivityDeps.tenants: ReadonlyMap<TenantId, TenantCreds>`. Octokit factory takes `tenantId` and resolves creds; activity signatures accept `tenantId` from workflow input.
- `nodes/operator/app/tests/external/review/pr-review-e2e.external.test.ts` (and 3 sibling per-node copies) — flip `E2E_GITHUB_REPO` default to `Cogni-DAO/test-repo`; suite skips unless test-tenant App creds available.
- `nodes/operator/app/tests/external/AGENTS.md` — update test-repo guidance.
- `docs/guides/github-app-webhook-setup.md` — add a "Multi-tenant" section explaining the prefix convention + try-each-secret semantics.
- `docs/guides/agent-api-validation.md` — append a worked example of the `test.cognidao.org` flight DM flow.

**New (separate bootstrap PR on `Cogni-DAO/test-repo`)**:

- Multi-node directory scaffolding mirroring PR #920's structure (no production code in this repo's PR).

### Implementation slicing — recommended PR breakdown (separate from this PR, pure execution)

Implementer's call. Suggested slices, in order:

1. **PR-A — Workflow input schema + contract test** (smallest blast radius). Add `PrReviewWorkflowInputSchema` Zod; convert existing usages to `z.infer<>`. No tenant changes yet. Cleans up the modelRef-shape lesson at the type level. ~150 lines.
2. **PR-B — `tenantId` plumbing through dispatch + workflow + activity** (no actual multi-tenant config yet — `tenantId` always defaults to `"prod"`). Adds the field, the schema enum, the workflowId prefix. ~250 lines.
3. **PR-C — `loadTenants` helper + per-tenant prefixed env vars + worker tenant map**. Webhook route still uses single-tenant logic but reads from the map. ~300 lines.
4. **PR-D — Try-each-secret webhook resolution + per-tenant allowlist enforcement**. The actual multi-tenant routing. ~200 lines.
5. **PR-E — `Cogni-DAO/test-repo` bootstrap + test-tenant App install + retire `derekg1729/test-repo` defaults in external tests + docs**. The migration. ~400 lines + ops work.
6. **PR-F — `test.cognidao.org` deploy + Loki labels + agentic-API DM validation**. The deploy_verified gate. Mostly ops + a runbook.

PR-A and PR-B are unblocked by PR #1098 merging (they touch the same files). PR-C through PR-F depend on PR-A + PR-B landing first.
