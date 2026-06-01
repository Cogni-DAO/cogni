---
id: proj.secrets-substrate
type: project
primary_charter:
title: Multi-Node Secrets Substrate — per-node isolation, owner-scoped, identity-not-shared
state: Active
priority: 1
estimate: 8
summary: OpenBao+ESO per-node secret isolation; migrate the `_shared` bucket to owner-scoped paths + read-grants; replace shared caller-identity bearers with per-node identity.
outcome: Every node runs on its own distinct secrets; no shared caller-identity credential exists; a compromised pod cannot impersonate another node to any internal service.
assignees: derekg1729
created: 2026-05-31
updated: 2026-05-31
labels: [secrets, openbao, eso, security, multi-node]
---

# Multi-Node Secrets Substrate

## Goal

Each node deploys on its **own** secrets (`cogni/<env>/<node>/<KEY>` → `<node>-env-secrets` → pod `envFrom`), with **no shared caller-identity credential** anywhere. Blast radius of one compromised pod is bounded to that node.

**Spec:** [`docs/spec/secrets-classification.md`](../../docs/spec/secrets-classification.md) (`authRole` + owner-scoped) · [`docs/spec/secrets-management.md`](../../docs/spec/secrets-management.md) (invariants) · **Design:** [`docs/design/secrets-catalog-per-node.md`](../../docs/design/secrets-catalog-per-node.md)

## Current state (2026-05-31)

| Surface | State |
| --- | --- |
| Per-node seed fan-out (`appliesTo`/`shared`, distinct value/node) | 🟢 built (#1414) — **substrate-proven on candidate-b**: distinct `AUTH_SECRET` per node in OpenBao + ESO-materialized k8s Secrets; per-node derive-env (`NEXTAUTH_URL`) + per-node DB (`cogni_<node>`) |
| 5 hub/laptop provisioner fixes | 🟢 committed (candidate-b-proof branch) — tofu-import idempotency, gh-404 parse, optional `_template`, argocd `--enable-helm`, SSH ControlMaster mux |
| candidate-b apps serving (`/readyz`, agent API, Loki) | 🔴 **not yet** — provision in progress; placeholder image digests; Phase 5e Grafana mint + node appset unexercised |
| `_shared` = no-owner bug class | 🔴 surfaced the silent-drop bug; **decided** to migrate to owner-scoped (below) |
| Shared **caller-identity** creds (LiteLLM/scheduler/billing) | 🔴 lateral-movement multipliers; targeted for per-node identity |

## Decided direction (2 independent security reviews, task.5094)

1. **`_shared` is the wrong abstraction** — secrets need an **owner**, not a shared bucket. Owner-scoped path `cogni/<env>/<owner>/<KEY>`, owner generates-once, consumers get explicit read grants. "Shared" = derived (N granted read). Kills the pass-through-from-`.env` silent-drop bug + replaces over-broad dual-extract with least-privilege.
2. **`shared:` conflates two axes** — value-distinctness vs identity-boundary. New catalog dimension **`authRole: caller-identity | resource-unlock`** + CI gate: `caller-identity` ⇒ `shared:true` FORBIDDEN (generalizes the `PRIVY_SIGNING_KEY` custody carve-out).
3. **caller-identity creds → per-node identity** (LiteLLM virtual keys; k8s projected-SA JWTs); master/signing keys stay in the provisioner only.
4. **resource-unlock creds → egress-proxy injection + scoped per-node sub-keys** (pods stop holding upstream account keys).

## Roadmap

### Crawl — do now (high risk-reduction-per-effort)

| # | Task | Why | Notes |
| - | --- | --- | --- |
| C1 | **Finish candidate-b → serving** | the PoC isn't real until `/readyz`+agent-API+Loki answer | fix `.env` gaps (done), real images (promote/bootstrap-tag), Phase 5e Grafana, node appset → ONE `/validate-candidate` scorecard |
| C2 | **fail-loud on required-EMPTY for agent/owned keys** | silent-skip shipped an incomplete vault | reconcile w/ TRANSITION_SAFE: `source:agent`+required+empty ⇒ hard-stop (generation bug); `source:human`+required+empty ⇒ warn (entered post-bootstrap). Currently warns for all — tighten. |
| C3 | `GH_REVIEW_APP_PRIVATE_KEY_BASE64` **out of node pods** | mis-classed signing key → cross-repo write for all nodes | keep only in review service; verify node pods don't need it |
| C4 | `LITELLM_MASTER_KEY` → **per-node LiteLLM virtual key** | admin master key in every pod = total proxy control | mint `sk-node-<node>` at provision via `/key/generate` (budget+model allowlist); master key in provisioner only — highest leverage |
| C5 | `SCHEDULER_API_TOKEN` + `BILLING_INGEST_TOKEN` → **per-node** | shared = submit/read/forge as any node | crawl: distinct token + server `token→node` map (walk: projected-SA JWT) |
| C6 | **Delete `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`** from substrate | `NEXT_PUBLIC_*` ships to browser — not a secret | trivial |
| C7 | **Confirm/downscope `GRAFANA_SERVICE_ACCOUNT_TOKEN`** | write scope = edit all nodes' dashboards | per-node SA, Viewer + folder; if read-only, keep |
| C8 | **`authRole` dimension + CI lint** | enforce "no shared caller-identity" structurally | catalog field + gate mirroring custody:signing |

### Walk — platform stage

- C5 → **k8s projected-ServiceAccount JWTs** (`aud=scheduler|billing-ingest`, node = `sub`) — removes static bearers, free rotation.
- `_shared` bucket → **owner-scoped paths + read-grants** (policy templating); per-node ExternalSecret extracts only its owner-granted paths, not all of `_shared/*`.
- resource-unlock (`POSTHOG_*`, `LANGFUSE_*`) → **per-project sub-keys** per node.
- Egress-proxy injection for `OPENROUTER_API_KEY` (drop from node env) → extend to Tavily/EVM-RPC.

### Run — only if multi-cluster / untrusted co-tenancy

- SPIFFE/SPIRE + mTLS. **Deferred** — overkill at 1-cluster MVP; projected-SA JWTs get ~80% of the benefit.

## Per-secret decision table (security review, 2026-05-31)

🔴 do now · 🟡 platform-stage

| Secret | Disposition | Control | When |
| --- | --- | --- | --- |
| `LITELLM_MASTER_KEY` | proxy-injected + per-node identity | per-node LiteLLM virtual key; master key in provisioner only | 🔴 |
| `GH_REVIEW_APP_PRIVATE_KEY_BASE64` | remove from data plane | review service only; custody rule | 🔴 |
| `SCHEDULER_API_TOKEN` | per-node now → identity | distinct token + `token→node` map → projected-SA JWT | 🔴→🟡 |
| `BILLING_INGEST_TOKEN` | per-node now → identity | distinct token + map → projected-SA JWT | 🔴→🟡 |
| `OPENROUTER_API_KEY` | proxy-injected | route via LiteLLM; drop from node env | 🔴 |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | remove — not a secret | move to public config | 🔴 (trivial) |
| `GRAFANA_SERVICE_ACCOUNT_TOKEN` | downscope; per-node if write | per-node SA, Viewer+folder | 🔴 (check scope) |
| `POSTHOG_API_KEY` / `_HOST` | per-node project key | per-project PostHog key | 🟡 |
| `LANGFUSE_*` | per-node project keys | per-project Langfuse keys | 🟡 |
| `PROMETHEUS_READ_*` | keep-shared, least-scope | confirm read-only | 🟡 |
| `EVM_RPC_URL` | keep-shared / per-node provider key | proxy later | 🟡 |
| `TAVILY_API_KEY` | keep-shared → proxy later | egress-proxy attribution | 🟡 |

**Assumption to confirm (30s, gates C4):** that `LITELLM_MASTER_KEY` is the actual LiteLLM admin master key (name implies). If already a scoped virtual key, C4 drops 🔴→🟡.

## Related

- `task.5094` — per-node seed fan-out + candidate-b proof (this project's seed) · PR **#1414**
- `task.5071` / `task.5081` — catalog refactor + OpenBao-on-hub landing
- `#1411` — per-wallet owner-keys (custody precedent)
- Security reviews (2 independent, 2026-05-31): `_shared`→owner+grant; `authRole` two-axis + decision table
