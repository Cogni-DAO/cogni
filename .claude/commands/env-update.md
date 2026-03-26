---
description: Guide for propagating environment variables across the stack
---

You've just added a new environment variable. The propagation path depends on **which service consumes it**.

Two runtimes exist on the same VM:
- **Compose infrastructure** (app, postgres, temporal, litellm, caddy) — env vars via deploy.sh + SSH
- **k3s services** (scheduler-worker, sandbox-openclaw) — env vars via Kustomize ConfigMap or SOPS Secret

Use this checklist to verify you haven't missed anything.

## 1. Validation & Types (Source of Truth)

- [ ] **`src/shared/env/server.ts`** (or `client.ts`): Add to Zod schema (app).
- [ ] **`services/{service}/src/bootstrap/env.ts`**: Add to Zod schema (k3s services have separate schemas).

## 2. Local Development

- [ ] **`.env.local`**: Add with real local value.
- [ ] **`.env.test`**: Add with mock/test value.
- [ ] **`.env.(local|test).example`**: Add with placeholder — public documentation for required vars.

## 3. Docker Compose (Local Dev + CI)

- [ ] **`infra/compose/runtime/docker-compose.dev.yml`**: Add to `environment` of the relevant service. This is used by `pnpm dev:stack` and CI stack tests.

> **Note:** `docker-compose.yml` (production Compose) only has infrastructure services. Services in `services/` are on k3s — see section 5B.

## 4. CI Pipeline

- [ ] **`.github/workflows/ci.yaml`**: Add to **every** `env:` block (static, unit, component, stack-test). Missing one block → `serverEnv()` validation failure in that job.

## 5. Deployment

### Which runtime?

**If the variable is for the app or Compose infrastructure** (app, litellm, postgres, temporal, caddy):

### 5A. Compose Deploy Path (SSH)

- [ ] **`.github/workflows/deploy-production.yml`**: Map secret to `env` block.
- [ ] **`.github/workflows/staging-preview.yml`**: Map secret to `env` block.
- [ ] **`scripts/ci/deploy.sh`** — 3 places:
  1. Add to `REQUIRED_SECRETS` / `OPTIONAL_SECRETS` / `REQUIRED_ENV_VARS`
  2. Add to the `.env` heredoc (required) or `append_env_if_set` (optional)
  3. Add to the `ssh ... bash /tmp/deploy-remote.sh` env passthrough at bottom

**If the variable is for a k3s service** (scheduler-worker, sandbox-openclaw, or new services):

### 5B. k3s / Argo CD Deploy Path (GitOps)

Non-secret config:
- [ ] **`infra/cd/base/{service}/configmap.yaml`**: Add key+value to ConfigMap data.
- [ ] **`infra/cd/overlays/{env}/{service}/kustomization.yaml`**: Add overlay patch if value differs per environment.

Secret values:
- [ ] **`infra/cd/secrets/{env}/{service}.enc.yaml.example`**: Add key with `REPLACE_WITH_{ENV}_{SECRET_NAME}` placeholder to the template.
- [ ] **`infra/cd/secrets/{env}/{service}.enc.yaml`**: Fill real value, re-encrypt with `sops --config infra/cd/secrets/.sops.yaml --encrypt --in-place <file>`.
- [ ] **`scripts/setup-secrets.ts`**: If it's an agent-generated secret, add to the SECRETS catalog so `setup:secrets` auto-generates and populates it. If human-provided, add with `source: "human"`.

> After changing any `infra/cd/` file, Argo CD auto-syncs on next commit to staging/main. No deploy.sh changes needed.

## 6. Setup Documentation

- [ ] **`scripts/setup-secrets.ts`**: Add to SECRETS catalog if it's a new secret (agent or human).
- [ ] **`scripts/setup/SETUP_DESIGN.md`**: Add to relevant secrets list for fresh-clone provisioning.

## 7. Validation

```bash
pnpm check:gitops:coverage   # services/ ↔ catalog ↔ manifests in sync
pnpm check:gitops:manifests  # overlays render cleanly
pnpm check:fast              # typecheck + lint + tests
```

## Reference

- [SETUP_DESIGN.md](scripts/setup/SETUP_DESIGN.md): Full setup design
- [infra/cd/AGENTS.md](infra/cd/AGENTS.md): GitOps manifest structure
- [Deployment Architecture](docs/runbooks/DEPLOYMENT_ARCHITECTURE.md): Compose vs k3s runtime split
