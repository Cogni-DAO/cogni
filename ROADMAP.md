# Cogni Technical Roadmap

> [!CRITICAL]
> Node sovereignty is non-negotiable. All architecture decisions preserve fork freedom and DAO wallet custody.

## Mission

Cogni is a DAO-first "org factory." This repo ships the **Node** — a sovereign DAO+app that any organization can fork and run independently.

**Operator** services (git-review, git-admin) are value-add. Nodes can consume them, self-host OSS versions, or skip entirely.

→ See: [Node vs Operator Contract](docs/spec/node-operator-contract.md)

---

## Phase Checklist

- [ ] **Phase 0**: Node Formation MVP (manual steps remain)
- [ ] **Phase 0.5**: Freeze Node Template
- [ ] **Phase 1**: First LangGraph Graph + Evals Foundation
- [ ] **Phase 2**: Operator Services Scaffold
- [ ] **Phase 3**: git-review-daemon Live
- [ ] **Phase 4**: git-admin-daemon Live
- [ ] **Phase 5**: Operational Readiness
- [ ] **Phase 6**: Operator Repo Extraction

→ See: [MVP Deliverables](docs/archive/MVP_DELIVERABLES.md) for scope lock

---

## Repository Structures

| Repo         | Key Directories                                                         | Purpose                               |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------- |
| **Node**     | `src/`, `packages/`, `smart-contracts/`, `infra/`, `scripts/`, `evals/` | Sovereign DAO+app                     |
| **Operator** | `apps/operator/`, `services/*`, `packages/*`, `infra/k8s/`              | Meta-Node: control plane + data plane |

**Design Principle — Mirror Rails, Not Features:**
Operator shares CI/CD, observability, deploy invariants, and hex architecture with Node. Only domain logic differs.

**Self-Host Note:** Operator data plane services (git-review-daemon, git-admin-daemon) will be open-sourced as standalone deployables. Sovereign Nodes can run their own instances without any Cogni Operator account.

→ Full directory trees: [Node vs Operator Contract](docs/spec/node-operator-contract.md#directory-structures)
→ Migration details: [Services Migration Guide](work/projects/proj.cicd-services-gitops.md)

---

## Non-Negotiable Invariants

| Invariant               | Meaning                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| **Wallet Custody**      | Node's DAO wallet keys never touch Operator infrastructure                          |
| **Data Sovereignty**    | Node DB is source of truth; Operator may cache but never requires custody           |
| **Fork Freedom**        | Node repo forkable and runnable without Cogni accounts                              |
| **Repo-Spec Authority** | Node authors policy; Operator consumes snapshot+hash; Operator never invents policy |

→ Full list: [Node vs Operator Contract](docs/spec/node-operator-contract.md)

---

## Guardrails

- No Operator repo extraction until: one paid customer + one real cred-informed payout
- No per-service standalone UIs without paying users
- Every cross-boundary call via explicit, versioned contract
- LLM-facing changes require eval regression gates
- Same deploy path, different config: preview and prod use identical images
- Canonical tenant key is `billing_account_id` in DB and `tenantId` at runtime (same UUID = `billing_accounts.id`). `node_id` is reserved for federation/node-registry (deployed-instance identity). No new synonyms (`org_id`, `account_id`, etc.).

---

## AI Architecture

| Layer         | Technology                            |
| ------------- | ------------------------------------- |
| Orchestration | LangGraph                             |
| Observability | OpenTelemetry (canonical)             |
| AI Platform   | Langfuse (prompt versioning, eval UI) |

→ See: [AI Architecture & Evals](docs/spec/ai-evals.md)

---

## Phases (Summary)

### Phase 0: Node Formation MVP

Enable anyone to create their own Node (DAO + app). Manual steps remain for infra/GitHub setup.

- Create `packages/aragon-osx/` with Aragon OSx encoding + SetupPlan schemas
- Web wizard for DAO formation (wallet-signed, no private key env vars)
- Server-side tx receipt verification
- Export deployment record + repo-spec addresses

→ See: [Node Formation Spec](docs/spec/node-formation.md)

### Phase 0.5: Freeze Node Template

Lock current hex architecture. Document what exists. All code is Node-owned.

### Phase 1: First LangGraph Graph + Evals Foundation

- Create `packages/ai-core/` with shared AI primitives (`AiEvent`, `UsageFact`, `SourceSystem`)
- Create `packages/langgraph-server/` (LangGraph.js service, runs in Docker)
- Create `packages/langgraph-graphs/` with first chat graph (feature-sliced: `graphs/chat/`)
- Create `evals/` with harness skeleton + initial fixtures
- Establish eval CI gate
- Add dependency-cruiser rule: Next.js (`src/**`) cannot import `packages/langgraph-graphs/`

→ See: [AI Setup Spec](docs/spec/ai-setup.md), [LangGraph Server](docs/spec/langgraph-server.md)

### Phase 2: Operator Services Scaffold

- Scaffold `services/git-review-daemon` (hex structure, no logic)
- Scaffold `services/git-admin-daemon` (hex structure, no logic)
- Create `packages/{contracts-public, schemas-internal, clients-internal}`
- Add dependency-cruiser rules for boundaries

### Phase 3: git-review-daemon Live

- Wire GitHub webhooks → LangGraph review workflow → PR comments
- Implement `/livez` + `/readyz` endpoints
- Publish OSS standalone version

### Phase 4: git-admin-daemon Live

- Wire DAO governance → authorized repo actions
- Implement `/livez` + `/readyz` endpoints
- Publish OSS standalone version

### Phase 5: Operational Readiness

- Add `/metrics` endpoints
- Graceful SIGTERM handling
- Migration Jobs per service
- K8s support (Helm charts) is Operator-owned and optional; Nodes use Docker Compose baseline

### Phase 6: Operator Repo Extraction

- Extract services to `cogni-platform` repo
- This repo becomes pure Node template
- Criteria: paid customer + real payout executed

---

## Appendix: K8s Readiness Contract

Every service MUST expose:

- `/livez` — liveness probe (process alive?)
- `/readyz` — readiness probe (can accept traffic?)
- `/metrics` — Prometheus metrics (Phase 5+)

Requirements:

- Graceful SIGTERM: drain in-flight, exit within timeout
- Statelessness: no local filesystem except ephemeral `/tmp`
- Migrations are one-shot Jobs, not startup tasks

---

## Appendix: Tenant Scoping

### Terminology & ID Mapping

| Term                 | Layer             | Value                             | Purpose                                                                                                                    |
| -------------------- | ----------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `billing_account_id` | DB column         | `billing_accounts.id` (UUID)      | Canonical tenant key for all RLS, FK references, data isolation                                                            |
| `tenantId`           | Runtime context   | Same UUID as `billing_account_id` | Canonical name in `ToolInvocationContext`, `ToolPolicyContext`, workflow IDs, authz contexts                               |
| `node_id`            | Deployment        | `.cogni/repo-spec.yaml` (UUID)    | Deployment/instance identity. One node = one DB, one infra. Never governance scoping.                                      |
| `scope_id`           | Governance domain | `.cogni/projects/*.yaml` (UUID)   | Governance/payout domain (project). `uuidv5(node_id, scope_key)`. Each scope has its own DAO, weight policy, epoch stream. |
| `dao_address`        | On-chain          | Contract address                  | Attribute of a scope (project), not a tenant key. Lives in project manifest.                                               |

> See [Identity Model spec](docs/spec/identity-model.md) for the full taxonomy, relationships, and prohibited overloading.

**Rules:**

- `billing_account_id` (DB) and `tenantId` (runtime) are the **same value** — `billing_accounts.id` UUID
- `node_id` is deployment identity only — never used for governance domain, epoch scoping, or RLS
- `scope_id` is governance identity only — never used for deployment routing or DB tenancy
- `dao_address` is an attribute of a scope, not a database key
- Do NOT introduce new synonyms (`org_id`, `account_id`, `tenant_id` DB column, `project_id` DB column, etc.)
- External provider IDs (e.g., WalletConnect project ID) must be namespaced (e.g., `walletconnect_project_id`) to avoid collision with `scope_id`
- V0 default: `scope_id = 'default'` everywhere. Multi-scope activates when `.cogni/projects/*.yaml` manifests are added.

### Transport & Auth

- **Headers**: `X-Tenant-ID` required on internal API calls (value = `billing_accounts.id`)
- **Internal JWTs**: 5-15 min TTL, rotating keys, clock skew tolerance 60-120s

**Known gap — Database-layer isolation:** PostgreSQL RLS policies exist for core tables (`billing_accounts`, `charge_receipts`, `ai_threads`, etc.) using `app.current_user_id`. See [Database RLS Spec](docs/spec/database-rls.md) for remaining coverage.

---

## Related Docs

| Doc                                                                    | Purpose                            |
| ---------------------------------------------------------------------- | ---------------------------------- |
| [Node vs Operator Contract](docs/spec/node-operator-contract.md)       | Boundaries, invariants, boot seams |
| [MVP Deliverables](docs/archive/MVP_DELIVERABLES.md)                   | Scope lock, success criteria       |
| [Node Formation Spec](docs/spec/node-formation.md)                     | DAO formation tooling (Phase 0)    |
| [AI Setup Spec](docs/spec/ai-setup.md)                                 | AI P0/P1/P2 checklists, invariants |
| [LangGraph AI](docs/spec/langgraph-patterns.md)                        | How to create a graph in a feature |
| [AI Architecture & Evals](docs/spec/ai-evals.md)                       | LangGraph, Langfuse, eval gates    |
| [Services Migration Guide](work/projects/proj.cicd-services-gitops.md) | Implementation checklist           |
| [Architecture](docs/spec/architecture.md)                              | Hex architecture details           |
| [Identity Model](docs/spec/identity-model.md)                          | All identity primitives            |

---

**Last Updated**: 2026-02-22
**Status**: Design Approved
