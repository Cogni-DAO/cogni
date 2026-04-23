---
id: guide.new-node-formation
type: guide
title: New Node Formation — End-to-End
status: draft
trust: draft
summary: End-to-end checklist for creating a new sovereign node in the monorepo. Covers source tree, CI registration, k8s base + overlays, catalog, DNS, DAO formation, and validation. Complements node-formation-guide.md (which covers only the DAO wizard).
read_when: Adding a brand new node to `nodes/<name>/`, not just porting an existing service. Read once end-to-end before starting, then use as a checklist.
owner: derekg1729
created: 2026-04-20
verified:
tags: [nodes, setup, dao, ci-cd, k8s, infrastructure]
---

# New Node Formation — End-to-End

> This guide consolidates what gets scattered across `node-formation-guide.md` (DAO wizard), `create-service.md` (service packaging), `multi-node-deploy.md` (deploy mechanics), and the `devops-expert` skill. Use this when you're creating a new node. Use the others as deep-dives for specific steps.

## When to Use

You are adding a **brand new node** to `nodes/<name>/` — a sovereign AI-run tenant with its own:

- Next.js app (reusing the node-template shape)
- LangGraph graphs under `nodes/<name>/graphs/`
- DAO + governance charters
- Operator wallet + payment rails
- Dedicated subdomain and NodePort
- k8s namespace + overlays
- Node-scoped database (`cogni_<name>`)

Do NOT use this guide for:

- A new utility service without a DAO — use [create-service.md](./create-service.md) instead
- A new LangGraph graph inside an existing node — use [new-attribution-pipeline.md](./new-attribution-pipeline.md) as a template
- Porting an existing node between orgs — fork-level change, handled by `node-setup` skill

## Preconditions

- [ ] A name chosen — referred to below as `<name>` (lowercase, 3-10 chars, no hyphens). Examples: `canary`, `poly`, `resy`.
- [ ] A node UUID generated: `uuidgen | tr A-Z a-z`. This becomes `node_id` forever; never changes.
- [ ] A next free NodePort chosen in the 304xx range (operator=30000, poly=30100, resy=30300, node-template=30200 reserved).
- [ ] Next free app port chosen in the 34xx range (operator=3000, poly=3100, resy=3300, node-template=3200 reserved).
- [ ] A target DAO chain decided (Base mainnet = 8453 for production, Sepolia = 11155111 for dev).
- [ ] `@cogni/repo-spec` and `@cogni/node-app` understood (see `packages/repo-spec/AGENTS.md`).

## Phases

```
Phase 0: Source port           → nodes/<name>/ directory exists, builds locally
Phase 1: Catalog + CI          → pr-build.yml can build the node target
Phase 2: k8s base + overlays   → Argo discovers and deploys the node
Phase 3: Compose + DNS + Caddy → Traffic routes to the node's pods
Phase 4: DB + secrets          → The node's DB exists and pods have credentials
Phase 5: DAO formation         → On-chain DAO + operator wallet + repo-spec populated
Phase 6: Governance charters   → Scheduled workloads run
Phase 7: Validation            → `/readyz` green, Loki shows traffic, DAO visible in Aragon
```

Every phase is required. Skipping any one silently green-lights earlier phases without getting the node into production.

## Phase 0: Source port

Scaffold by copying an existing node. The closest model depends on what the new node needs:

- **Pure LLM chat + graphs** → copy `nodes/node-template/` (no Doltgres, no copy-trade tables)
- **LangGraph + per-node DB tables** → copy `nodes/poly/` and strip poly-specific features
- **LangGraph + Doltgres knowledge store** → copy `nodes/poly/` including `poly-doltgres` base

```bash
cp -R nodes/node-template nodes/<name>
```

### Rename

- [ ] `nodes/<name>/app/package.json` — `name: "@cogni/<name>-app"`, dev/start ports → `34xx`
- [ ] `nodes/<name>/.cogni/repo-spec.yaml` — `node_id: <new-uuid>`, `node_name: "Cogni <Name>"`, stub TODOs for DAO addresses (filled in Phase 5)
- [ ] Any internal imports from `@cogni/node-template-app` → `@cogni/<name>-app` (grep for stragglers)
- [ ] `nodes/<name>/app/src/app/layout.tsx` — page title, favicon

### Test locally

```bash
pnpm install
pnpm --filter @cogni/<name>-app build
pnpm --filter @cogni/<name>-app typecheck
```

Both must exit 0 before moving to Phase 1.

### Update `.cogni/repo-spec.yaml` (repo root)

Append to `nodes:` list:

```yaml
- node_id: "<new-uuid>"
  node_name: "Cogni <Name>"
  path: "nodes/<name>"
  endpoint: "http://<name>:34xx/api/internal/billing/ingest"
```

This is the **single source of truth** for node discovery. Argo, CI, and LiteLLM all read it.

## Phase 1: Catalog + CI

### Catalog entry

Create `infra/catalog/<name>.yaml`:

```yaml
name: <name>
type: node
port: 34xx
node_id: "<new-uuid>"
dockerfile: nodes/<name>/app/Dockerfile
```

Argo's per-env ApplicationSets template off this file at runtime. Without it, Argo won't create an Application, and the node will never deploy — even if every other piece is in place.

### CI wiring (4 scripts, all in `scripts/ci/`)

1. **`detect-affected.sh`**: Append `<name>` to `ALL_TARGETS=(...)`; add a case:
   ```bash
   nodes/<name>/*)
     add_target <name>
     ;;
   ```
2. **`build-and-push-images.sh`**: Add `resolve_tag` + `build_target` cases for `<name>` (mirror operator/poly).
3. **`resolve-pr-build-images.sh`**: Mirror the `resolve_tag` case so candidate-flight can find the pushed image.
4. **`wait-for-argocd.sh`**: Add `<name>` to `APPS=(...)` if the node is **critical** (flights fail when it can't reach Healthy). Mark as optional only if you intentionally want broken-canary-doesn't-block behavior.

### Dispatch fallback

Add `<name>` to `.github/workflows/build-multi-node.yml` `build-nodes` matrix. This is the manual-fallback path when affected-only detection misses something; required for operability.

### Verify locally

```bash
TURBO_SCM_BASE=origin/main TURBO_SCM_HEAD=HEAD bash scripts/ci/detect-affected.sh
# Touch a file under nodes/<name>/; re-run. Your node should appear in the emitted targets CSV.
```

## Phase 2: k8s base + overlays

Most nodes don't need a new base directory — they reuse `infra/k8s/base/node-app` and just patch via the overlay's `namePrefix`. Create a new base only if the node has resources no other node has (like poly's Doltgres pod).

### Overlays

For each environment you plan to deploy into — `candidate-a`, `preview`, `production` — create `infra/k8s/overlays/<env>/<name>/kustomization.yaml`. Crib from `infra/k8s/overlays/preview/operator/kustomization.yaml`. Key values to change:

| Patch target                             | Value                                                |
| ---------------------------------------- | ---------------------------------------------------- |
| `namePrefix`                             | `<name>-`                                            |
| ConfigMap `NODE_NAME`                    | `"<name>"`                                           |
| ConfigMap `NEXTAUTH_URL`                 | `https://<name>-<env>.cognidao.org`                  |
| Service `nodePort`                       | `304xx`                                              |
| Service `targetPort`                     | `34xx`                                               |
| Deployment `containerPort`               | `34xx`                                               |
| Deployment `envFrom` secret ref          | `<name>-node-app-secrets`                            |
| `app.kubernetes.io/instance` label       | `<name>` (on Service, Deployment selector, pod template) |
| EndpointSlice `kubernetes.io/service-name` labels | prefix all with `<name>-`                   |

> **INFRA_K8S_MAIN_DERIVED invariant** — never hand-edit overlays on `deploy/*` branches. They are rsync'd from main (see bug.0334). Edit on main; the promote-and-deploy workflow propagates.

### Production is gated

Do NOT add a production overlay until the node has proven itself in candidate-a + preview. For the canary specifically this is explicitly gated on revenue-per-month ≥ operating cost for 3 consecutive months (see `proj.cogni-canary.md` CP5).

## Phase 3: Compose + DNS + Caddy

### Compose services

Add the node as a container to both:

- `infra/compose/runtime/docker-compose.yml` (VM edge, used by `deploy-infra.sh`)
- `infra/compose/runtime/docker-compose.dev.yml` (local dev stack)

Copy the operator/poly entry and rename `image:`, `container_name:`, `ports:`, depends_on.

### Caddy

`infra/compose/edge/configs/Caddyfile.tmpl`:

```caddy
{$<NAME>_DOMAIN} {
    reverse_proxy host.docker.internal:304xx
    log { ... }
}
```

`<NAME>_DOMAIN` flows in via the env file written by `provision-test-vm.sh`. Add the var to that script's env plumbing too (look for `POLY_DOMAIN`/`RESY_DOMAIN` handling and mirror).

### DNS

Cloudflare A record: `<name>-<env>.cognidao.org` → VM IP. The provision script handles this via the Cloudflare API IF `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` are set. Otherwise create manually.

> **ACME rate limit** — Caddy attempts Let's Encrypt HTTP-01 challenge immediately on startup. If DNS hasn't propagated, ACME fails and the per-hostname hourly limit eats 5 attempts. Confirm `dig +short <name>-<env>.cognidao.org` returns the VM IP **before** restarting Caddy.

## Phase 4: DB + secrets

### Database

Add `cogni_<name>` to `COGNI_NODE_DBS` in `scripts/setup/provision-test-vm.sh` (phase 2 derived values). The Compose `db-provision` container picks up the new DB name on next deploy.

### k8s secrets

Add a new block in `scripts/setup/provision-test-vm.sh` Phase 6 that creates `<name>-node-app-secrets` in the target namespace. Mirror the operator/poly/resy block; the secret must contain:

- `DATABASE_URL`, `DATABASE_SERVICE_URL` (pointing at `cogni_<name>`)
- `AUTH_SECRET`, `LITELLM_MASTER_KEY`, `OPENROUTER_API_KEY`
- Any node-specific keys (e.g. `POLYGON_RPC_URL` for poly-style nodes)

### setup-secrets.ts

If the node has env-file-persisted secrets (`.env.{env}`), extend `scripts/setup/setup-secrets.ts` to generate/persist them per environment.

## Phase 5: DAO formation (Derek-executed)

This is the only phase an AI cannot do — it requires a browser wallet sign-off.

### Prerequisites

- [ ] Derek's wallet funded with ~$5 ETH on Base for gas
- [ ] Canary's **own Privy-managed operator wallet** provisioned (if this node is AI-run; otherwise operator wallet = Derek's)
- [ ] Dev server running (`pnpm dev`) or preview URL available

### Steps

1. Navigate to `/setup/dao` on the running app. See [Node Formation Guide](./node-formation-guide.md) for field-by-field wizard instructions.
2. Sign TX 1 (creates DAO + GovernanceERC20 + TokenVoting plugin).
3. Sign TX 2 (deploys CogniSignal bound to DAO address).
4. Server verification returns a `repoSpecYaml` block.
5. Paste the block into `nodes/<name>/.cogni/repo-spec.yaml` under `cogni_dao:`.
6. (If 2-signer DAO) Manually call `PluginSetupProcessor.applyUpdate` to add the second signer. The wizard does not do this for v0.
7. Navigate to `/setup/dao/payments` and deploy a Split contract. Paste `payments_in.credits_topup.receiving_address` into the repo-spec.
8. Fund the operator wallet with an operating cushion (USDC on Base; amount depends on projected monthly model spend).
9. Commit updated `nodes/<name>/.cogni/repo-spec.yaml` as a follow-up PR.

### What you paste back

After the wizard:

```yaml
cogni_dao:
  dao_contract: "0x..."
  plugin_contract: "0x..."
  signal_contract: "0x..."
  chain_id: "8453"
  base_url: "https://proposal.cognidao.org"

operator_wallet:
  address: "0x..." # Privy-managed EOA

payments_in:
  credits_topup:
    provider: cogni-usdc-backend-v1
    receiving_address: "0x..." # Split contract
    allowed_chains: [Base]
    allowed_tokens: [USDC]
```

## Phase 6: Governance charters

Declare scheduled workloads in `nodes/<name>/.cogni/repo-spec.yaml` `governance.schedules`:

```yaml
governance:
  schedules:
    - charter: HEARTBEAT
      cron: "0 * * * *"
      timezone: UTC
      entrypoint: HEARTBEAT
```

Each charter triggers an OpenClaw gateway run with the matching entrypoint name. Define entrypoints in `nodes/<name>/graphs/` alongside the graph code.

For an AI-run node like the canary, charters are the _only_ way the brain is scheduled. Derek-run nodes (operator, poly, resy) can add charters anytime; AI-run nodes get their scope-fenced self-authoring loop (see `task.0341`).

## Phase 7: Validation

### Code gate

- [ ] `pnpm check` green on the PR that contains Phases 0–4
- [ ] `pnpm check:full` green in CI
- [ ] PR reviewed + merged (or auto-merged if `ai-only-repo-policy` is active for this node's PRs)

### Flight gate

- [ ] Candidate-flight to `candidate-a` promotes the node's image
- [ ] Argo shows `<name>` Application at `sync.revision == deploy-branch-SHA && health.status == Healthy`
- [ ] `/readyz.version` at the deployed subdomain matches the source SHA

### Feature gate (by your own hand)

- [ ] `curl https://<name>-candidate-a.cognidao.org/readyz` returns 200
- [ ] Loki query `{app="<name>"}` shows the node's structured logs at the deployed SHA
- [ ] DAO visible in Aragon app for the target chain
- [ ] Operator wallet balance confirmed on Basescan
- [ ] Update the work item with `deploy_verified: true`

## Common Pitfalls

- **Forgetting the catalog entry.** Everything else lands green; Argo silently doesn't create the Application; the subdomain 404s.
- **NodePort collision.** Two nodes on `30400` = both services break on `kubectl apply`. Keep a table in this doc as you add nodes.
- **Secret ref mismatch.** Overlay patches the deployment's `envFrom` to `<name>-node-app-secrets`, but the provision script creates `<name>-app-secrets`. Pods CrashLoopBackOff with "secret not found."
- **Production overlay before proof.** Adding the production overlay before the node has proven candidate-a + preview stable means a broken node can block promote-and-deploy.
- **DAO wizard on wrong chain.** The wizard reads `chainId` from your wallet. Switch to Base mainnet / Sepolia in RainbowKit before clicking Deploy.
- **Two-signer DAO not actually two-signer.** The wizard creates a 1-signer DAO (initialHolder gets 1e18, majority threshold). You must manually call `PluginSetupProcessor.applyUpdate` to add the second member. Aragon app is the verification source.
- **Caddy ACME rate limit.** See Phase 3 warning. 5 failures per hostname per hour, then wait an hour.

## Reference Inventory

| Item                            | Where                                            |
| ------------------------------- | ------------------------------------------------ |
| Repo-spec schema                | `packages/repo-spec/src/schema.ts`               |
| Catalog format                  | `infra/catalog/*.yaml` (all existing entries)    |
| k8s base reference              | `infra/k8s/base/node-app/`                       |
| Overlay reference               | `infra/k8s/overlays/preview/operator/`           |
| Provision script                | `scripts/setup/provision-test-vm.sh`             |
| CI detect                       | `scripts/ci/detect-affected.sh`                  |
| CI build                        | `scripts/ci/build-and-push-images.sh`            |
| Flight app list                 | `scripts/ci/wait-for-argocd.sh`                  |
| DAO wizard                      | `src/app/(app)/setup/dao/page.tsx`               |
| Formation spec                  | `docs/spec/node-formation.md`                    |
| Node identity model             | `docs/spec/identity-model.md`                    |

## Related

- [Node Formation Guide](./node-formation-guide.md) — wizard-only walkthrough
- [Create Service Guide](./create-service.md) — for services without DAOs
- [Multi-Node Deploy](./multi-node-deploy.md) — VM + pipeline mechanics
- [New Node Styling](./new-node-styling.md) — visual branding for the node's UI
- [Create Service Review](./create-service-review.md) — accuracy audit of the service guide
