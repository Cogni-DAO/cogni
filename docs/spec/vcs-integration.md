---
id: vcs-integration
type: spec
title: VCS Integration Architecture
status: draft
spec_state: draft
trust: draft
summary: GitHub App authentication, permission tiering, webhook routing, and VCS adapter contracts for integrating git platform operations (ingestion, code review, admin actions) into the Node template.
read_when: Adding a VCS integration, working on GitHub/GitLab auth, wiring webhook handlers, or understanding the git-daemon service.
implements: proj.vcs-integration
owner: derekg1729
created: 2026-02-22
verified: 2026-02-22
tags: [infra, github, auth, services]
---

# VCS Integration Architecture

> The Node template integrates with GitHub (and future GitLab/Radicle) through **two GitHub Apps** with distinct permission tiers — a read/review app and an admin app — served by a **single backend service** (`services/git-daemon/`). A shared `packages/github-core/` package provides auth primitives. PAT fallback remains for self-hosted Nodes that don't need App-based auth.

### Key References

|                 |                                                                                 |                                        |
| --------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| **Project**     | [proj.vcs-integration](../../work/projects/proj.vcs-integration.md)             | Roadmap and planning                   |
| **Spec**        | [Node vs Operator Contract](./node-operator-contract.md)                        | Node/Operator boundary, data plane     |
| **Spec**        | [Epoch Ledger](./epoch-ledger.md)                                               | Activity ingestion via source adapters |
| **Spec**        | [Services Architecture](./services-architecture.md)                             | Service contracts and boundaries       |
| **Spec**        | [Packages Architecture](./packages-architecture.md)                             | Package contracts and boundaries       |
| **Sister Repo** | [cogni-git-review](https://github.com/cogni-dao/cogni-git-review)               | PR review bot (to be absorbed)         |
| **Sister Repo** | [cogni-git-admin](https://github.com/cogni-dao/cogni-git-admin)                 | DAO admin bot (to be absorbed)         |
| **Sister Repo** | [cogni-proposal-launcher](https://github.com/Cogni-DAO/cogni-proposal-launcher) | Aragon proposal UI (to be absorbed)    |

## Design

### Why Two GitHub Apps

A single GitHub App with all permissions is rejected for three reasons:

1. **Principle of least privilege.** Read/review permissions (contents:read, checks:write, pull_requests:write) and admin permissions (contents:write, administration:write, members:write) are fundamentally different trust decisions. GitHub grants all requested permissions at install time — there is no "install with partial permissions."

2. **Progressive adoption.** A Node installs the review app first. Later, when the DAO wants on-chain governance of repo admin actions, they install the admin app. This mirrors the node-operator-contract's FORK_FREEDOM invariant — adding admin capabilities is an explicit opt-in, not a bundled default.

3. **Blast radius.** A compromised review app key can post comments and set check statuses. A compromised combined app key can also merge arbitrary PRs and grant admin access. Separate keys = separate blast radii.

### System Overview

```
┌────────────────────────────────────────────────────────────┐
│                    GitHub Platform                          │
│                                                            │
│  ┌─────────────────────┐    ┌───────────────────────────┐  │
│  │ Cogni Review App    │    │ Cogni Admin App           │  │
│  │                     │    │                           │  │
│  │ contents:read       │    │ contents:write            │  │
│  │ pull_requests:write │    │ administration:write      │  │
│  │ checks:write        │    │ members:write             │  │
│  │ issues:read         │    │                           │  │
│  └────────┬────────────┘    └─────────────┬─────────────┘  │
│           │ webhooks                      │ webhooks        │
└───────────┼───────────────────────────────┼────────────────┘
            │                               │
            ▼                               ▼
┌────────────────────────────────────────────────────────────┐
│  services/git-daemon/                                      │
│                                                            │
│  POST /api/v1/webhooks/github    ◄── both apps             │
│  POST /api/v1/webhooks/onchain   ◄── Alchemy (admin only)  │
│  GET  /livez, /readyz                                      │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Review       │  │ Admin        │  │ Ingestion        │ │
│  │ Handlers     │  │ Handlers     │  │ Token Provider   │ │
│  │ (graphExec)  │  │ (merge, ACL) │  │ (for scheduler)  │ │
│  └──────────────┘  └──────────────┘  └──────────────────┘ │
│           │                │                   │           │
│           └────────────────┴───────────────────┘           │
│                            │                               │
│                   packages/github-core/                    │
│                   (JWT, tokens, verify)                    │
└────────────────────────────────────────────────────────────┘
            │
            │ installation token (read-only)
            ▼
┌────────────────────────────────────────────────────────────┐
│  services/scheduler-worker/                                │
│                                                            │
│  GitHubSourceAdapter.collect()  ◄── uses review app token  │
│  (epoch activity ingestion)         OR PAT fallback        │
└────────────────────────────────────────────────────────────┘
```

### Auth Flow: GitHub App → Installation Token

```
1. git-daemon starts → loads APP_ID + PRIVATE_KEY for each app
2. Signs JWT (RS256, 10min expiry) per GitHub App spec
3. On webhook receipt:
   a. Verify webhook signature (HMAC-SHA256 with app's WEBHOOK_SECRET)
   b. Extract installation_id from webhook payload
   c. POST /app/installations/{id}/access_tokens → short-lived token
   d. Create Octokit client scoped to that installation
   e. Route to appropriate handler based on event type + app identity
```

For ingestion (no webhook trigger — cron-based):

```
1. scheduler-worker needs a read-only token for GitHub GraphQL
2. V0: scheduler-worker owns an InstallationTokenProvider in-process
   → Reads REVIEW_APP_ID, REVIEW_APP_PRIVATE_KEY, REVIEW_INSTALLATION_ID
   → Signs JWT → POST /app/installations/{id}/access_tokens → caches until expiry
   → Passes token into GitHubSourceAdapter
3. V1: Resolve installation ID per-repo via GET /repos/{owner}/{repo}/installation
   → Remove REVIEW_INSTALLATION_ID env var
4. Fallback: GITHUB_TOKEN env var (PAT) for self-hosted Nodes without App auth
```

### Webhook Routing

Each GitHub App gets its own webhook URL so signature verification implicitly identifies the app. (`X-GitHub-Hook-Installation-Target-ID` is NOT the App ID — it's the target resource ID and must not be used for routing.)

```
POST /api/v1/webhooks/github/review   ← Review App webhook URL
  │
  ├─ Verify X-Hub-Signature-256 with REVIEW_APP_WEBHOOK_SECRET
  ├─ pull_request.opened/synchronize/reopened → reviewHandler
  ├─ check_suite.rerequested                  → rerunHandler
  └─ installation_repositories.added           → welcomeHandler

POST /api/v1/webhooks/github/admin    ← Admin App webhook URL
  │
  ├─ Verify X-Hub-Signature-256 with ADMIN_APP_WEBHOOK_SECRET
  └─ (V0: no direct GitHub webhook triggers — admin via onchain path)

POST /api/v1/webhooks/onchain
  │
  ├─ Verify Alchemy HMAC signature
  ├─ Parse CogniAction events from transaction logs
  ├─ Validate DAO address + chain ID
  └─ Execute: merge PR, grant/revoke collaborator
      └─ Uses admin app installation token
```

### Package: `packages/github-core/`

Pure library. No process lifecycle. Shared by `services/git-daemon/` and `services/scheduler-worker/`.

```
packages/github-core/
├── src/
│   ├── jwt.ts              # signAppJwt(appId, privateKey) → JWT string
│   ├── installation.ts     # getInstallationToken(jwt, installationId) → token
│   ├── webhook-verify.ts   # verifyWebhookSignature(secret, payload, signature)
│   ├── client-factory.ts   # createOctokit(token) → Octokit instance
│   ├── types.ts            # GitHubAppConfig, InstallationToken, WebhookEvent
│   └── index.ts            # Public exports
└── tests/
```

Responsibilities:

- JWT signing (RS256) for GitHub App authentication
- Installation access token acquisition
- Webhook signature verification (HMAC-SHA256, timing-safe)
- Octokit client factory with rate-limit awareness

Does NOT contain:

- Webhook routing logic (that's git-daemon's concern)
- Business logic (review, admin, ingestion)
- Probot (replaced by direct GitHub App API usage)

### Service: `services/git-daemon/`

HTTP service per [services-architecture](./services-architecture.md) contracts.

```
services/git-daemon/
├── src/
│   ├── main.ts                # Entry point, signal handling
│   ├── config.ts              # Zod env: REVIEW_APP_ID, ADMIN_APP_ID, keys, secrets
│   ├── health.ts              # /livez, /readyz
│   ├── server.ts              # Fastify (product HTTP traffic)
│   ├── apps/
│   │   ├── review.ts          # Review app config + Octokit factory
│   │   └── admin.ts           # Admin app config + Octokit factory
│   ├── webhooks/
│   │   ├── github.ts          # Webhook router (signature verify → app dispatch)
│   │   └── onchain.ts         # Alchemy webhook handler (HMAC verify → action exec)
│   ├── handlers/
│   │   ├── review/
│   │   │   ├── pr-review.ts   # PR review via graphExecutor
│   │   │   └── rerun.ts       # Check suite re-request
│   │   └── admin/
│   │       ├── merge.ts       # DAO-authorized PR merge
│   │       ├── collaborator.ts # Grant/revoke collaborator
│   │       └── policy.ts      # Authorization policy (DAO allowlist)
│   └── token-provider.ts      # Internal API: issue installation tokens for scheduler
├── Dockerfile
├── package.json               # @cogni/git-daemon-service
└── AGENTS.md
```

### Dropping Probot

Both sister repos use [Probot](https://probot.github.io/). Probot provides:

- GitHub App JWT ↔ installation token management
- Webhook signature verification
- Express middleware for webhook delivery
- Convenience wrappers around Octokit

We replace Probot with direct GitHub API usage (`packages/github-core/`) because:

- Probot v7 is CJS-only; cogni-git-admin already has a CJS shim hack (`runtime.cjs`)
- Probot bundles Express; we use Fastify
- Probot's magic hides auth flow details needed for the token-provider pattern
- The auth primitives are ~200 lines total — no framework needed

### Ingestion Auth: Token Source Abstraction

The `GitHubSourceAdapter` currently accepts `token: string`. This remains correct — the adapter doesn't care whether the token is a PAT or an installation token. The caller provides it:

```typescript
// Self-hosted Node (PAT):
const adapter = new GitHubSourceAdapter({
  token: process.env.GITHUB_TOKEN,
  repos: ["owner/repo"],
});

// Operator-hosted (App installation token):
const token = await tokenProvider.getInstallationToken({
  app: "review",
  installationId: 12345,
});
const adapter = new GitHubSourceAdapter({
  token,
  repos: ["owner/repo"],
});
```

The `tokenProvider` is an internal API exposed by `git-daemon` (or called in-process if scheduler-worker and git-daemon share a runtime).

### Scope Routing at Ingestion

When activity events are ingested, each event must be assigned a `scope_id` (governance/payout domain). See [Identity Model](./identity-model.md) and [Epoch Ledger §Project Scoping](./epoch-ledger.md#project-scoping).

**Routing rules:**

1. **Single-scope V0:** All events get `scope_id = 'default'`. No manifest needed.
2. **Multi-scope:** Each `.cogni/projects/*.yaml` manifest declares which source repositories or file paths belong to the scope. The adapter assigns `scope_id` at ingestion time based on these rules.

**Routing determinism (when multi-scope is active):**

- **Non-overlapping scopes are the default.** If a repository belongs to exactly one scope, all events from that repository get that `scope_id`.
- **Overlapping scopes** (a single repo serves multiple projects): route by file path using **longest-match-wins**. Each project manifest declares `include` path globs. The most specific matching glob wins.
- **Excluded by default:** lockfiles (`**/pnpm-lock.yaml`, `**/package-lock.json`), generated code (`**/generated/**`), and vendor directories (`**/vendor/**`, `**/node_modules/**`) are excluded from path-based routing. These files do not contribute to any scope's attribution.
- **Renames/moves:** A file rename in a PR is treated as two events — a remove from the old path's scope and an add to the new path's scope. If both resolve to the same scope, it collapses to one event.
- **Unresolvable events:** If an event touches only excluded files, or no scope matches, the event is **rejected** (not silently dropped, not assigned to default). This forces explicit manifest configuration.

**Ingestion scoping in the adapter call:**

```typescript
// CollectEpochWorkflow passes scope_id to the adapter context
const events = await adapter.collect({
  streams: ["pull_requests", "reviews"],
  cursor,
  window: { since, until },
  scopeId: "chat-service", // ← scope for this collection run
});
// Events are inserted with scope_id = 'chat-service' on activity_events
```

### External Event Envelope

For external repositories (not in this monorepo) that feed the same attribution pipeline, the system accepts **signed activity event envelopes** via a standardized contract. This enables a GitHub/GitLab repo to push events to a Node's ledger without sharing the monorepo.

**Envelope schema:**

```typescript
interface ActivityEventEnvelope {
  // Routing
  source_repo: string; // "github:cogni-dao/external-lib"
  scope_id: string; // Must match a declared scope in the receiving node
  node_id: string; // Target node (must match receiving node's node_id)

  // Event (same as ActivityEvent from ingestion-core)
  event: {
    id: string; // Deterministic ID (e.g., "github:pr:owner/repo:42")
    source: string;
    eventType: string;
    platformUserId: string;
    platformLogin?: string;
    artifactUrl: string;
    metadata: Record<string, unknown>;
    payloadHash: string; // SHA-256 of canonical payload
    eventTime: string; // ISO 8601
  };

  // Provenance
  producer: string; // Adapter name (e.g., "github-adapter")
  producer_version: string; // Adapter version
  retrieved_at: string; // ISO 8601

  // Integrity
  idempotency_key: string; // = event.id (deterministic, dedup at receiver)
  signature?: string; // Optional: Ed25519 or HMAC signature over canonical envelope
  signer_id?: string; // Optional: identifies the signing key
}
```

**Invariants for external envelopes:**

| Rule                    | Constraint                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| ENVELOPE_SCOPE_REQUIRED | Every envelope must include a `scope_id` that matches a declared scope in the receiving node.               |
| ENVELOPE_IDEMPOTENT     | `idempotency_key` (= `event.id`) prevents duplicate ingestion. Same semantics as ACTIVITY_IDEMPOTENT.       |
| ENVELOPE_NODE_MATCH     | `node_id` in the envelope must match the receiving node's `node_id`. Rejects cross-node misdirects.         |
| ENVELOPE_SIGNATURE_V1   | V0: signature is optional (trust the transport). V1: signature required, verified against a registered key. |

**Receiving endpoint (future):**

```
POST /api/v1/attribution/events/ingest
Content-Type: application/json
Authorization: Bearer <node-api-key>

Body: ActivityEventEnvelope
```

This endpoint validates the envelope, checks `scope_id` against manifests (SCOPE_VALIDATED), and inserts into `activity_events` with the same idempotency guarantees as adapter-collected events.

### GitLab Support (Future)

The architecture is VCS-agnostic at the handler level:

| Concern              | GitHub                         | GitLab (future)                   |
| -------------------- | ------------------------------ | --------------------------------- |
| Auth                 | GitHub App (JWT + install tok) | OAuth 2.0 + OIDC (token refresh)  |
| Webhook verification | HMAC-SHA256 (X-Hub-Signature)  | Shared secret (X-Gitlab-Token)    |
| API client           | Octokit                        | @gitbeaker/rest                   |
| Webhook endpoint     | `/api/v1/webhooks/github`      | `/api/v1/webhooks/gitlab`         |
| Token storage        | Stateless (short-lived)        | Encrypted DB (2h expiry, refresh) |

The cogni-git-review sister repo already has a `VcsProvider` interface abstracting over GitHub/GitLab. This pattern carries forward into the handlers.

### Permission Matrix

| Capability             | Review App | Admin App | PAT Fallback |
| ---------------------- | ---------- | --------- | ------------ |
| Read repo contents     | Y          | Y         | Y            |
| Read PRs/issues        | Y          | Y         | Y            |
| Post PR comments       | Y          | N         | Y            |
| Create/update checks   | Y          | N         | N            |
| Merge PRs              | N          | Y         | Y (if admin) |
| Grant collaborator     | N          | Y         | Y (if admin) |
| Revoke collaborator    | N          | Y         | Y (if admin) |
| GraphQL search queries | Y          | N         | Y            |

### Relationship to Node-Operator Contract

Per [node-operator-contract](./node-operator-contract.md):

- `git-daemon` is **Operator data plane** (`services/*`)
- Call direction: Operator → Node repo (via VCS API)
- Node installs the GitHub Apps on its repos (Node's trust decision)
- Operator runs the backend (or Node self-hosts it — DEPLOY_INDEPENDENCE)
- Operator never gains wallet/DB custody (WALLET_CUSTODY, DATA_SOVEREIGNTY)

The two-app model maps cleanly to the Boot Seams Matrix:

| Seam            | App Used   | Self-Host Option |
| --------------- | ---------- | ---------------- |
| PR code review  | Review App | OSS standalone   |
| Repo admin      | Admin App  | OSS standalone   |
| Activity ingest | Review App | PAT fallback     |

## Goal

Provide a unified, secure VCS integration layer where: (1) authentication is handled by a shared pure package, (2) all webhook and API traffic routes through a single service with clean handler separation, (3) read/review and admin permissions are isolated into separate GitHub Apps, and (4) the ingestion pipeline can use either App tokens or PAT fallback without code changes.

## Non-Goals

- GitLab implementation (future — architecture supports it, not built yet)
- Radicle/other VCS providers
- GitHub App marketplace listing or OAuth user-facing flows
- Multi-tenant Operator hosting (covered by node-operator-contract)
- Review graph logic or prompt engineering (covered by graph-execution spec)
- On-chain event decoding details (covered by cogni-git-admin's Aragon integration)

## Invariants

| Rule                         | Constraint                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TWO_APPS_SEPARATE_KEYS       | Review and admin GitHub Apps have independent APP_ID + PRIVATE_KEY pairs. A single compromised key cannot escalate to the other's scope.                               |
| WEBHOOK_SIGNATURE_REQUIRED   | Every inbound webhook (GitHub, Alchemy) must pass HMAC-SHA256 signature verification before any handler executes.                                                      |
| APP_ROUTE_BY_URL             | Each GitHub App has a distinct webhook URL (`/github/review`, `/github/admin`). Routing is by URL path + signature verification, not by inspecting payload or headers. |
| TOKEN_SHORT_LIVED            | Installation access tokens expire per GitHub's 1-hour TTL. Never persisted to disk or database.                                                                        |
| PAT_FALLBACK_SUPPORTED       | `GitHubSourceAdapter` accepts any valid token string. Callers may provide a PAT or an installation token — adapter is auth-agnostic.                                   |
| ADMIN_ACTIONS_DAO_AUTHORIZED | Admin app handlers (merge, grant, revoke) execute only after verifying on-chain CogniAction event from an authorized DAO.                                              |
| NO_PROBOT_DEPENDENCY         | Neither `packages/github-core/` nor `services/git-daemon/` depend on Probot. Auth primitives are implemented directly.                                                 |
| SERVICE_ISOLATION            | `services/git-daemon/` imports only from `packages/*`. Never from `src/` or other services. (Inherited from services-architecture.)                                    |
| REVIEW_HANDLER_VIA_GRAPH     | PR review logic executes through the graphExecutor (LangGraph), not inline in the webhook handler.                                                                     |

### Environment Configuration

**`services/git-daemon/src/config.ts`** (Zod-validated, fail-fast):

| Variable                    | Required | Description                              |
| --------------------------- | -------- | ---------------------------------------- |
| `REVIEW_APP_ID`             | Yes      | GitHub App ID for the review app         |
| `REVIEW_APP_PRIVATE_KEY`    | Yes      | Base64-encoded PEM private key (review)  |
| `REVIEW_APP_WEBHOOK_SECRET` | Yes      | Webhook HMAC secret (review)             |
| `ADMIN_APP_ID`              | No       | GitHub App ID for the admin app (opt-in) |
| `ADMIN_APP_PRIVATE_KEY`     | No       | Base64-encoded PEM private key (admin)   |
| `ADMIN_APP_WEBHOOK_SECRET`  | No       | Webhook HMAC secret (admin)              |
| `ALCHEMY_SIGNING_KEY`       | No       | Required if admin app is configured      |
| `PORT`                      | No       | HTTP listen port (default: 3100)         |

Admin app variables are optional — a Node may install only the review app.

### File Pointers

| File                                      | Purpose                                        |
| ----------------------------------------- | ---------------------------------------------- |
| `packages/github-core/src/`               | JWT, installation tokens, webhook verification |
| `services/git-daemon/src/`                | Webhook server, handler dispatch               |
| `services/git-daemon/src/config.ts`       | Zod env schema (both app configs)              |
| `services/git-daemon/src/apps/`           | Per-app Octokit factory                        |
| `services/git-daemon/src/handlers/`       | Business logic (review, admin)                 |
| `services/scheduler-worker/src/adapters/` | GitHubSourceAdapter (token-agnostic)           |
| `packages/ingestion-core/src/port.ts`     | SourceAdapter interface                        |

## Open Questions

- [ ] Should `git-daemon` expose a gRPC or HTTP internal API for token provisioning to `scheduler-worker`, or should they share an in-process factory via a package import?
- [ ] What is the migration path for existing cogni-git-review Probot installations? Do we maintain backward-compatible webhook URLs during transition?
- [ ] Should the admin app's authorization policy (DAO allowlist) live in the Node's DB or in a config file? DB is more dynamic; config file is simpler and auditable.
- [ ] Rate limit strategy: should `github-core` implement token rotation across multiple installation tokens, or is single-installation rate limit (5000 req/hr) sufficient for V0?

## Related

- [Node vs Operator Contract](./node-operator-contract.md) — data plane boundaries, self-host requirements
- [Epoch Ledger](./epoch-ledger.md) — consumes GitHub activity via source adapters
- [Services Architecture](./services-architecture.md) — service contracts git-daemon must satisfy
- [Packages Architecture](./packages-architecture.md) — package contracts github-core must satisfy
- [Graph Execution](./graph-execution.md) — review handler executes via graphExecutor
- [Identity Model](./identity-model.md) — node_id, scope_id, user_id definitions and relationships
