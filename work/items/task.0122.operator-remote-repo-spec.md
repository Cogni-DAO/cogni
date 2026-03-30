---
id: task.0122
type: task
title: "Operator: node registration lifecycle — discovery, repo-spec fetch, scope reconciliation"
status: needs_implement
priority: 1
rank: 2
estimate: 5
summary: "Implement the operator-side node registration lifecycle: core port abstraction (VCS-agnostic), GitHub adapter for discovery via installation webhooks, remote repo-spec fetching, operator DB persistence (node + scope tables), and scope reconciliation with Temporal schedule management."
outcome: "When an external project installs the Cogni GitHub App, the operator automatically discovers the node, fetches and parses its repo-spec, persists the registration, and creates epoch schedules for each declared scope. Config changes (push to .cogni/) trigger re-sync with scope reconciliation. The core registration port is VCS-agnostic — GitHub is one adapter."
spec_refs: vcs-integration, node-operator-contract-spec, identity-model-spec
assignees: derekg1729
credit:
project: proj.node-formation-ui
branch:
pr:
reviewer:
revision: 1
blocked_by: task.0120
deploy_verified: false
created: 2026-03-01
updated: 2026-03-02
labels: [operator, github-app, config, multi-tenant, registration]
external_refs:
---

# Operator: Node Registration Lifecycle

## Context

When an external project installs the Cogni GitHub App (or connects via any future VCS platform), the Operator needs to discover the node, read its configuration, and start running epoch schedules. Today, repo configuration is entirely env-var-driven (`GITHUB_REPOS`, hardcoded `node_id`/`scope_id` constants). This task replaces that static configuration with a dynamic, event-driven registration lifecycle.

**Key insight from the identity model:** The registration entity is the **node** (identified by `node_id`), not individual scopes. A node's scopes are 1:N and mutable over time — the operator discovers them by syncing the node's `.cogni/repo-spec.yaml` and `.cogni/projects/*.yaml` manifests. See [vcs-integration.md §Node Registration Lifecycle](../../docs/spec/vcs-integration.md#node-registration-lifecycle).

**Core design principle:** GitHub App installation is an **adapter**, not core. The registration port is VCS-agnostic. GitHub translates `installation_repositories.added` into a `NodeDiscoveryEvent`. Future GitLab, manual API, or on-chain triggers use the same core port.

Per **REPO_SPEC_AUTHORITY**: "Node authors `.cogni/repo-spec.yml`; Operator consumes snapshot+hash; Operator never invents policy."

## Requirements

### Core registration port (VCS-agnostic)

- [ ] `CapabilityRole` type — `"review" | "admin" | "contributor"`
- [ ] `NodeDiscoveryEvent` type — trigger (including `vcs_app_removed`), platform, platformInstallationId, capabilityRole, repoRef
- [ ] `NodeRegistration` type — nodeId, repoRef, repoSpecHash, scopes[]
- [ ] `NodeCapability` type — nodeId, capabilityRole, platform, platformInstallationId, status
- [ ] `NodeScopeConfig` type — scopeId, scopeKey, activitySources, approvers, poolConfig
- [ ] `NodeRegistryPort` interface — upsertNode, getNode, getNodeByRepoRef, listActiveNodes, suspendNode, removeNode, upsertCapability, getCapability, listCapabilities, removeCapability
- [ ] `RemoteRepoSpecFetcher` port interface — fetchRepoSpec(repoRef, auth?) → raw YAML string (VCS-agnostic: callers provide platform-specific auth)
- [ ] All types live in a package (`packages/repo-spec/` or `packages/ingestion-core/`), not in a service

### GitHub adapter (discovery + fetch)

- [ ] Verify the GitHub App has `contents: read` permission. Document finding.
- [ ] `GitHubRepoSpecFetcher` — implements `RemoteRepoSpecFetcher` using `octokit.repos.getContent({ path: ".cogni/repo-spec.yaml" })`
- [ ] Uses existing `VcsTokenProvider` / `GitHubAppTokenProvider` — requests `capability: "review"` (least privilege for a read)
- [ ] Decodes base64 content, passes raw YAML to `parseRepoSpec()` from `@cogni/repo-spec` (task.0120)
- [ ] Error handling: 404 → "No .cogni/repo-spec.yaml found", 403 → "App lacks contents:read", invalid YAML → surfaces Zod errors

### Webhook handlers (MVP: Next.js API routes)

- [ ] `POST /api/v1/webhooks/github/review` — Review App webhook route
- [ ] `POST /api/v1/webhooks/github/admin` — Admin App webhook route
- [ ] Each route verifies signature with its own `WEBHOOK_SECRET` (APP_ROUTE_BY_URL invariant)
- [ ] Webhook URL determines `capabilityRole`: `/review` → `"review"`, `/admin` → `"admin"`
- [ ] Handle `installation_repositories.added` → upsert capability + trigger registration flow (if first app for this node)
- [ ] Handle `installation.deleted` → remove capability + check if any capabilities remain → suspend node if none
- [ ] Handle `push` events (review route only) → check if `.cogni/**` files changed → trigger re-sync
- [ ] Other event types: log and ignore (future handlers)

### Operator DB persistence

- [ ] Migration: `operator_node_registrations` table (node_id PK, repo_ref, repo_spec_hash, status, installed_at, last_synced_at)
- [ ] Migration: `operator_node_capabilities` table (node_id + capability_role composite PK, platform, platform_install_id, status, installed_at)
- [ ] Migration: `operator_node_scopes` table (node_id + scope_id composite PK, scope_key, config_snapshot JSONB, temporal_schedule_id, status, last_synced_at)
- [ ] `DrizzleNodeRegistryAdapter` implementing `NodeRegistryPort` (including capability CRUD)
- [ ] Soft-delete only — no purging of registration, capability, or scope rows

### Scope reconciliation

- [ ] On every sync: diff fetched scopes vs. cached `operator_node_scopes`
- [ ] New scope → insert row, create Temporal schedule (CollectEpochWorkflow with scope's config)
- [ ] Changed scope (config_snapshot differs) → update row, update Temporal schedule input
- [ ] Removed scope (in DB but not in fetched spec) → mark 'removed', pause Temporal schedule
- [ ] Unchanged (same repo_spec_hash) → no-op (SYNC_IDEMPOTENT)

### Tests

- [ ] Unit: `GitHubRepoSpecFetcher` with mocked Octokit — happy path, 404, 403, invalid YAML
- [ ] Unit: Scope reconciliation logic — new scope, changed scope, removed scope, no-op
- [ ] Unit: Webhook signature verification (both review and admin routes)
- [ ] Unit: `DrizzleNodeRegistryAdapter` — node upsert/get/suspend, capability upsert/get/remove, scope CRUD
- [ ] Unit: Multi-app lifecycle — second app install doesn't duplicate node, uninstall one app doesn't affect other, last app removal suspends node
- [ ] Unit: Capability-scoped token selection — requesting unavailable capability rejects (never escalates)

## Allowed Changes

- `packages/repo-spec/src/` (or `packages/ingestion-core/src/`) — core types: NodeDiscoveryEvent, NodeRegistration, NodeCapability, NodeScopeConfig, NodeRegistryPort, RemoteRepoSpecFetcher, CapabilityRole
- `services/scheduler-worker/src/adapters/` — GitHubRepoSpecFetcher implementation
- `src/app/api/v1/webhooks/github/review/route.ts` — **new** Review App webhook handler
- `src/app/api/v1/webhooks/github/admin/route.ts` — **new** Admin App webhook handler
- `packages/db-schema/src/operator.ts` — **new** operator registry tables (registrations, capabilities, scopes)
- `packages/db-client/src/adapters/` — DrizzleNodeRegistryAdapter
- `src/adapters/server/db/migrations/` — new migration for operator tables
- `services/scheduler-worker/package.json` — add `@cogni/repo-spec` dep (if not already from task.0120)
- GitHub App settings (external, documented only) — verify `contents: read`

## Plan

- [ ] Step 1: Core types — Define `CapabilityRole`, `NodeDiscoveryEvent`, `NodeRegistration`, `NodeCapability`, `NodeScopeConfig`, `NodeRegistryPort`, `RemoteRepoSpecFetcher` in packages. Pure types, no implementations.
- [ ] Step 2: GitHub fetcher — `GitHubRepoSpecFetcher` using Octokit + existing token provider (requests `capability: "review"`). Unit tests with mocked responses.
- [ ] Step 3: Operator DB tables — Migration for `operator_node_registrations` + `operator_node_capabilities` + `operator_node_scopes`. Drizzle schema in `packages/db-schema/src/operator.ts`.
- [ ] Step 4: Registry adapter — `DrizzleNodeRegistryAdapter` implementing `NodeRegistryPort` (including capability CRUD). Unit tests for node, capability, and scope operations.
- [ ] Step 5: Scope reconciliation — Pure function that diffs fetched vs. cached scopes, returns a list of actions (create/update/remove). Unit tests for all cases.
- [ ] Step 6: Webhook handlers — Two routes (`/webhooks/github/review` + `/webhooks/github/admin`). Each verifies its own signature. URL determines capabilityRole. Event dispatch: install → upsert capability + register node if first app, push → re-sync, uninstall → remove capability + check remaining. Unit tests including multi-app lifecycle.
- [ ] Step 7: Temporal schedule wiring — On scope create/update/remove, create/update/pause the corresponding `CollectEpochWorkflow` schedule.
- [ ] Step 8: `pnpm check`, file headers, AGENTS.md, update work item status.

## Design Notes

### Why core types are VCS-agnostic

The `NodeRegistryPort` and `RemoteRepoSpecFetcher` interfaces have no GitHub/Octokit types. GitHub is one adapter. Future adapters:

- **GitLab:** OAuth token + `RepositoryFiles.show()` API
- **Manual:** `POST /api/v1/operator/nodes/register` with YAML body
- **On-chain:** DAO formation event triggers discovery via event listener

The adapter translates a platform-specific event into a `NodeDiscoveryEvent`, then the core registration flow is identical.

### Multiple GitHub Apps per node

A node may install the Review App (read/review), the Admin App (write/admin), or both. Each is a separate GitHub App with a separate `installation_id`, separate webhook URL, and separate token. The registration model separates identity (registrations) from auth credentials (capabilities):

- **Identity is upserted once** — the first app install triggers node registration via repo-spec fetch
- **Capabilities are tracked per-app** — each install/uninstall updates `operator_node_capabilities`
- **Token selection is capability-scoped** — workflows declare which `capabilityRole` they need; the token provider resolves to the exact installation_id. CAPABILITY_SCOPED_AUTH ensures a workflow designed for read-only access never accidentally gets a write token.

### Why webhook lives in Next.js (not git-daemon)

`services/git-daemon/` doesn't exist yet (P1 in proj.vcs-integration). The webhook handler needs DB access (operator tables) and the scheduler API. The Next.js app already has both. When git-daemon is built, the handler migrates there — the core types and registry adapter don't change.

### Why `repos.getContent` and not a git clone

- We need one file, not a full checkout
- `getContent` returns base64-encoded file contents for files up to 1MB — sufficient for YAML config
- Uses the same installation token we already have — no additional auth
- No disk I/O on the operator side

### Relationship to task.0099

task.0099 covers the **node's own** DB tables (`node_meta`, scope_id columns on epochs). That's a node knowing itself. This task covers the **operator's** tables for tracking other nodes. Different databases, different concerns, no overlap.

### Scopes change over time

Per identity-model.md: `scope_id` is 1:N per node, declared in `.cogni/scopes/*.yaml` (pending rename from `.cogni/projects/`). A node may add scopes, remove scopes, or change config (approvers, pool size). The operator must track these changes via periodic or event-driven re-sync.

### Alignment with `@cogni/repo-spec` package (task.0120)

The landed `@cogni/repo-spec` package provides exactly what the `GitHubRepoSpecFetcher` needs:

- `parseRepoSpec(string | unknown)` — accepts raw YAML string (from GitHub API base64 decode)
- `extractNodeId(spec)` → `node_id` UUID for registration primary key
- `extractLedgerConfig(spec)` → `{ activitySources, approvers, pool }` maps to `NodeScopeConfig`

**Default scope model:** V0 repos declare a single scope at the top level of `repo-spec.yaml` (`scope_id` + `scope_key` fields). The `@cogni/repo-spec` parser treats these as optional — `extractLedgerConfig()` returns `null` when absent. A node with no scope config is valid: "registered, zero scopes to schedule" (e.g., gateway-only billing).

**Multi-scope extension:** The parser currently handles one `repo-spec.yaml` → one scope. Multi-scope (`.cogni/scopes/*.yaml`) will require extending the parser to fetch and merge N manifests. The reconciliation logic in this task already assumes N scopes — no redesign needed, just an additive parser extension.

## Validation

**Command:**

```bash
pnpm check && pnpm test -- --grep "registration\|repo-spec-fetch\|webhook"
```

**Expected:** All tests pass. Registration flow works end-to-end from webhook → fetch → persist → schedule.

## Review Checklist

- [ ] **Work Item:** `task.0122` linked in PR body
- [ ] **Spec:** REPO_SPEC_AUTHORITY, REGISTRATION_NODE_KEYED, REGISTRATION_VCS_AGNOSTIC, CAPABILITY_SCOPED_AUTH, CAPABILITY_INDEPENDENT, SCOPE_RECONCILIATION, SYNC_IDEMPOTENT upheld
- [ ] **Tests:** fetcher, reconciliation, webhook signature (both routes), registry adapter, multi-app lifecycle, capability-scoped token rejection
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
