---
id: proj.vcs-integration
type: project
primary_charter:
title: VCS Integration — Auth Backend + Git Services
state: Active
priority: 1
estimate: 5
summary: Shared GitHub/GitLab auth package, unified git-daemon service, and absorption of cogni-git-review, cogni-git-admin, and cogni-proposal-launcher into the Node template.
outcome: A single `services/git-daemon/` handles PR review, DAO admin actions, and ingestion token provisioning — backed by `packages/github-core/` auth primitives. Proposal launcher absorbed into the Node's Next.js UI. Sister repos archived.
assignees: [derekg1729]
created: 2026-02-22
updated: 2026-03-11
labels: [infra, github, auth]
---

# VCS Integration — Auth Backend + Git Services

## Goal

Consolidate all VCS integration into this repo: a shared auth package (`packages/github-core/`), a single webhook service (`services/git-daemon/`) replacing `cogni-git-review` and `cogni-git-admin`, and the proposal launcher UI from `cogni-proposal-launcher` absorbed into the Node's Next.js app. Two GitHub Apps with separate permission tiers, one backend. PAT fallback for self-hosted Nodes. GitLab adapter stubbed for Run phase.

## Roadmap

### Crawl (P0) — App Auth for Ingestion (in-process, no new service)

**Goal:** Create Review GitHub App, wire `InstallationTokenProvider` directly into `scheduler-worker`, and swap the adapter to use App tokens by default. No `git-daemon` service yet — just auth primitives in a package consumed in-process.

| Deliverable                                                                             | Status      | Est | Work Item |
| --------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Create Review GitHub App (contents:read, PRs:read, issues:read) + install on test-repo  | Not Started | 0.5 | task.0097 |
| `InstallationTokenProvider` — sign JWT → POST /installations/{id}/access_tokens → cache | Not Started | 1   | task.0097 |
| Wire provider into scheduler-worker, gate PAT behind explicit `GITHUB_AUTH=pat` flag    | Not Started | 0.5 | task.0097 |
| GitHub App creation guide (review app setup, env vars)                                  | Not Started | 0.5 | —         |

### Walk (P1) — Shared Auth Package + git-daemon Service

**Goal:** Extract auth into `packages/github-core/`, resolve installation IDs dynamically (drop `REVIEW_INSTALLATION_ID`), stand up `services/git-daemon/` with webhook routing, and absorb review + admin + proposal-launcher logic.

| Deliverable                                                                           | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| `packages/github-core/` — JWT, token cache, webhook verify, client factory            | Not Started | 2   | (create at P1 start) |
| Dynamic installation ID resolution via `GET /repos/{owner}/{repo}/installation`       | Not Started | 0.5 | (create at P1 start) |
| Token cache keyed by (app, installationId) with early-expiry refresh                  | Not Started | 0.5 | (create at P1 start) |
| Node registration lifecycle — core port, webhook handler, scope reconciliation        | Not Started | 5   | task.0122            |
| `services/git-daemon/` scaffold — main, config, health, Fastify, per-app webhook URLs | Not Started | 1   | (create at P1 start) |
| Create Admin GitHub App (contents:write, admin:write, members:write)                  | Not Started | 0.5 | (create at P1 start) |
| Review handler — PR review via graphExecutor                                          | In Review   | 3   | task.0153            |
| Reviewer adapter-boundary contract test — lock ReviewHandlerDeps                      | Done        | 1   | task.0368            |
| `extractNodePath` accessor + `@cogni/repo-spec/testing` fixtures                      | In Review   | 1   | task.0380            |
| `extractOwningNode` resolver — paths → owning nodeId (P0)                             | Done        | 1   | task.0382            |
| Reviewer per-node routing — wire `extractOwningNode` into `PrReviewWorkflow`          | In Review   | 2   | task.0410            |
| `PrReviewWorkflowInputSchema` Zod contract — close modelRef-shape regression class    | In Review   | 1   | task.0419            |
| Admin handler — merge PR, grant/revoke collaborator (on-chain authorized)             | Not Started | 2   | (create at P1 start) |
| Onchain webhook — Alchemy HMAC verify + CogniAction parse                             | Not Started | 1   | (create at P1 start) |
| Authorization policy — DAO allowlist enforcement                                      | Not Started | 1   | (create at P1 start) |
| Proposal launcher — absorb cogni-proposal-launcher into Node UI                       | Not Started | 2   | (create at P1 start) |
| Docker Compose entry for git-daemon                                                   | Not Started | 0.5 | (create at P1 start) |
| E2E test — webhook → handler → GitHub API roundtrip                                   | Not Started | 2   | (create at P1 start) |
| Archive `cogni-git-review`, `cogni-git-admin`, and `cogni-proposal-launcher` repos    | Not Started | 0.5 | (create at P1 start) |

### Run (P2+) — GitLab Adapter + Multi-Tenant

**Goal:** GitLab OAuth adapter in `packages/gitlab-core/`. git-daemon handles GitLab webhooks. Operator-scale token management.

| Deliverable                                                        | Status      | Est | Work Item            |
| ------------------------------------------------------------------ | ----------- | --- | -------------------- |
| `packages/gitlab-core/` — OAuth 2.0, token refresh, webhook verify | Not Started | 2   | (create at P2 start) |
| GitLab webhook route + handler dispatch                            | Not Started | 1   | (create at P2 start) |
| GitLab review adapter (VcsProvider interface)                      | Not Started | 2   | (create at P2 start) |
| Multi-installation token rotation for rate limits                  | Not Started | 1   | (create at P2 start) |

## Constraints

- Review and admin must use separate GitHub App credentials — never a single combined app
- git-daemon must not depend on Probot — direct GitHub API via github-core
- git-daemon must satisfy all service contracts (health endpoints, graceful shutdown, Zod env, import isolation)
- Admin app env vars are optional — the service must boot with review app only
- PAT-based auth must remain a valid path for self-hosted Nodes that skip App installation
- No direct DB access from git-daemon to Node DB (per node-operator-contract DATA_SOVEREIGNTY)

## Dependencies

- [x] `packages/ingestion-core/` — SourceAdapter port (exists on current branch)
- [x] `services/scheduler-worker/` — GitHubSourceAdapter (exists on current branch)
- [ ] graphExecutor available for review handler invocation (see proj.graph-execution)
- [ ] GitHub App registrations created (review + admin) with correct permission sets

## As-Built Specs

- [VCS Integration Architecture](../../docs/spec/vcs-integration.md) — auth, routing, service design

## Design Notes

- **Why not Probot?** CJS-only (v7), bundles Express (we use Fastify), hides auth flow needed for token-provider pattern. The auth primitives are ~200 lines — no framework needed.
- **Why two apps?** Principle of least privilege, progressive adoption, separate blast radii. GitHub grants all requested permissions at install time — no partial install. See spec for full rationale.
- **Sister repo absorption strategy:** Extract handler functions only — strip Probot, Express, standalone server infra. The VcsProvider interface from cogni-git-review carries forward as handler-level abstraction.
- **Token provisioning decision:** Crawl: `InstallationTokenProvider` lives in scheduler-worker directly (~50 lines). Walk: extract into `packages/github-core/` when git-daemon needs it too. Run: optional internal HTTP endpoint if services need cross-process token sharing.
- **Installation ID resolution:** Crawl uses explicit `REVIEW_INSTALLATION_ID` env var (one repo, one install). Walk resolves dynamically via `GET /repos/{owner}/{repo}/installation` and memoizes — drops the env var.
- **Proposal launcher absorption:** `cogni-proposal-launcher` is a RainbowKit+wagmi Next.js app that converts deep link URLs into Aragon proposals. It's the UI counterpart to git-admin (admin executes DAO votes → GitHub actions; proposal launcher creates the votes). Absorb into `src/features/governance/` or `src/app/proposals/` — reuse existing wagmi/RainbowKit setup already in the Node template.
