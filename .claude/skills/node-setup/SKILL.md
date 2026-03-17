---
name: node-setup
description: "Agentic node setup for Cogni forks. Guides a fresh fork from clone to successful preview + production deployments. Handles: repo identity, DAO formation, SSH keys, Cherry VM provisioning, GitHub secrets, DNS, and deploy verification. Prompts user only for API keys with clickable URLs."
---

# Node Setup — Agentic Fork Onboarding

You are an infrastructure setup agent. Your job is to take a fresh Cogni fork from clone to **successful preview and production deployments**. You own the entire process — only prompt the user when you need credentials that require their browser (API keys, tokens, DNS records).

## Architecture References

- [Node Formation Guide](../../../docs/guides/node-formation-guide.md) — DAO deployment + repo-spec generation (Phase 0)
- [SETUP_DESIGN.md](../../../scripts/setup/SETUP_DESIGN.md) — canonical secret list and setup flow
- [INFRASTRUCTURE_SETUP.md](../../../docs/runbooks/INFRASTRUCTURE_SETUP.md) — VM provisioning runbook
- [server-env.ts](../../../apps/web/src/shared/env/server-env.ts) — app's required env vars (source of truth for what the app needs)
- [deploy.sh](../../../scripts/ci/deploy.sh) — deploy script required secrets list

## Pre-flight

Before starting, verify:

1. `gh auth status` — GitHub CLI authenticated
2. `tofu --version` — OpenTofu installed (if not: `brew install opentofu`)
3. `pnpm --version` — pnpm available
4. Git remote points to the fork (not cogni-template)
5. Branch is clean or on a setup branch

Detect the repo name from `git remote get-url origin` (e.g., `Cogni-DAO/cogni-resy-helper` → `cogni-resy-helper`). Use this throughout for naming.

## Phase 0: DAO Formation & Repo Identity

**Pre-requisite for everything else.** See [Node Formation Guide](../../../docs/guides/node-formation-guide.md) for details.

1. Ask the user: "Have you deployed a DAO for this node yet?"
   - If **no**: Direct them to https://cognidao.org/setup/dao to deploy a DAO and generate a repo-spec. They copy the generated YAML into `.cogni/repo-spec.yaml`. This is a **blocker** — do not proceed without a valid repo-spec.
   - If **yes**: Verify `.cogni/repo-spec.yaml` has valid `node_id`, `scope_id`, `cogni_dao.chain_id`, `operator_wallet.address`, and `payments_in.credits_topup` fields. None of these should be zero addresses or empty objects.

2. Verify repo identity is updated (not template defaults). Derive `REPO_SLUG` from repo name (e.g., `cogni-resy-helper`) and `REPO_SNAKE` with underscores (e.g., `cogni_resy_helper`):
   - `package.json` → `name` field = `REPO_SLUG`
   - `.cogni/repo-spec.yaml` → `intent.name` = `REPO_SLUG`
   - `.cogni/repo-spec.yaml` → `activity_sources.github.source_refs` points to `Org/REPO_SLUG`
   - `sonar-project.properties` → `sonar.projectKey` and `sonar.projectName` = `REPO_SLUG`
   - `.github/workflows/ci.yaml` → DB names use `REPO_SNAKE_test` (e.g., `cogni_resy_helper_test`)
   - `.env.local.example` → DB names use `REPO_SNAKE_dev`
   - `.env.test.example` → DB names use `REPO_SNAKE_test`

3. Run `pnpm check` to verify schema validation passes. If `repo-spec.yaml` fails Zod validation, the stubs are wrong — fix them.

## Phase 1: Local Environment

1. Copy `.env.local.example` → `.env.local` if it doesn't exist
2. Update `.env.local` with repo-specific values:
   - DB names: replace `cogni_template` with repo-specific name (e.g., `cogni_resy_helper`)
   - `COGNI_REPO_URL`: point to this repo's git URL
   - `CHERRY_AUTH_TOKEN`: rename from `CHERRY_AUTH_KEY` if needed

3. Prompt user for required API keys they must create:

   | Secret                                 | URL to create                                                                                                    |
   | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
   | `CHERRY_AUTH_TOKEN`                    | https://portal.cherryservers.com/settings/api-keys → Create → copy token                                         |
   | `OPENROUTER_API_KEY`                   | https://openrouter.ai/settings/keys                                                                              |
   | `EVM_RPC_URL`                          | https://dashboard.alchemy.com/apps → Create app → Chain: Base, Network: Mainnet → copy HTTPS URL                 |
   | `GHCR_DEPLOY_TOKEN`                    | https://github.com/settings/tokens/new → **Classic PAT** (not fine-grained) → scope: `read:packages` only        |
   | `GIT_READ_TOKEN`                       | https://github.com/settings/personal-access-tokens/new → Fine-grained PAT → select this repo → `Contents: Read`  |
   | `OPENCLAW_GITHUB_RW_TOKEN`             | https://github.com/settings/tokens/new → Classic PAT → scopes: `repo` (Contents:Write + Pull requests:Write)     |
   | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | https://cloud.walletconnect.com → Create project → copy Project ID (optional — skip if not using wallet connect) |

   For each: give the user the URL, tell them exactly what to click, and wait for them to paste the value. Set it in `.env.local`.

4. Auto-generate values that don't need user input:
   - `LITELLM_MASTER_KEY`: `sk-$(openssl rand -hex 24)`
   - `AUTH_SECRET`: `openssl rand -base64 32`
   - `OPENCLAW_GATEWAY_TOKEN`: `openssl rand -base64 32`

5. Run `pnpm check` — must pass before proceeding.

## Phase 2: SSH Keys

For each environment (preview, production):

```bash
REPO_NAME=<detected-repo-name>  # e.g., cogni_resy_helper
ENV=<preview|production>
ssh-keygen -t ed25519 -f ~/.ssh/${REPO_NAME}_${ENV}_deploy -C "${REPO_NAME}-${ENV}" -N ""
cp ~/.ssh/${REPO_NAME}_${ENV}_deploy.pub infra/tofu/cherry/base/keys/
```

Remove any old template keys from `infra/tofu/cherry/base/keys/` (e.g., `cogni_template_*`).

Commit the public keys:

```bash
git add infra/tofu/cherry/base/keys/*.pub
git commit -m "chore(infra): add SSH deploy keys for ${REPO_NAME}"
```

## Phase 3: VM Provisioning (Preview first, then Production)

### Critical: Cherry auth

**NEVER `source .env.local`** — it silently corrupts env vars due to unquoted special characters. Always extract individual values:

```bash
export CHERRY_AUTH_TOKEN=$(grep '^CHERRY_AUTH_TOKEN=' .env.local | cut -d= -f2-)
```

Verify auth works before proceeding:

```bash
curl -s -H "Authorization: Bearer $CHERRY_AUTH_TOKEN" "https://api.cherryservers.com/v1/teams" | head -c 100
```

Must return JSON team data, not 401.

### Discover project ID

```bash
# List teams to find project
curl -s -H "Authorization: Bearer $CHERRY_AUTH_TOKEN" "https://api.cherryservers.com/v1/teams" | python3 -c "import sys,json; teams=json.load(sys.stdin); [print(f'Team: {t[\"name\"]}, ID: {t[\"id\"]}') for t in teams]"
```

Then list projects for the team:

```bash
curl -s -H "Authorization: Bearer $CHERRY_AUTH_TOKEN" "https://api.cherryservers.com/v1/teams/<TEAM_ID>/projects" | python3 -c "import sys,json; [print(f'Project: {p[\"name\"]}, ID: {p[\"id\"]}') for p in json.load(sys.stdin)]"
```

### Create tfvars

For each environment, create `terraform.<env>.tfvars`:

```hcl
environment     = "<env>"
vm_name_prefix  = "<repo-name>"           # e.g., "cogni-resy-helper"
project_id      = "<cherry-project-id>"
plan            = "B1-4-4gb-80s-shared"   # MUST be 4GB minimum — 2GB OOMs
region          = "LT-Siauliai"
public_key_path = "keys/<repo_name>_<env>_deploy.pub"
```

### Provision

```bash
cd infra/tofu/cherry/base
tofu init
tofu workspace new <env> || tofu workspace select <env>
tofu apply -var-file=terraform.<env>.tfvars -auto-approve
```

Capture the IP:

```bash
export VM_IP=$(tofu output -raw vm_host)
```

### Wait for cloud-init

The VM needs ~3 minutes for cloud-init to install Docker. Verify:

```bash
ssh -i ~/.ssh/${REPO_NAME}_${ENV}_deploy -o StrictHostKeyChecking=no root@${VM_IP} "cloud-init status --wait && docker version"
```

## Phase 4: GitHub Secrets

### Environment secrets (per env — run for preview, then production)

**Auto-generated (create fresh per environment):**

```bash
ENV="preview"  # or "production"
REPO_NAME="<repo-name>"

# Database
POSTGRES_ROOT_PASS=$(openssl rand -hex 32)
APP_USER="${REPO_NAME//-/_}_app_${ENV}"
APP_PASS=$(openssl rand -hex 32)
SVC_USER="${REPO_NAME//-/_}_app_${ENV}_service"
SVC_PASS=$(openssl rand -hex 32)
DB_NAME="${REPO_NAME//-/_}_${ENV}"

gh secret set POSTGRES_ROOT_USER --env $ENV --body "postgres"
gh secret set POSTGRES_ROOT_PASSWORD --env $ENV --body "$POSTGRES_ROOT_PASS"
gh secret set APP_DB_USER --env $ENV --body "$APP_USER"
gh secret set APP_DB_PASSWORD --env $ENV --body "$APP_PASS"
gh secret set APP_DB_SERVICE_USER --env $ENV --body "$SVC_USER"
gh secret set APP_DB_SERVICE_PASSWORD --env $ENV --body "$SVC_PASS"
gh secret set APP_DB_NAME --env $ENV --body "$DB_NAME"
gh secret set DATABASE_URL --env $ENV --body "postgresql://${APP_USER}:${APP_PASS}@postgres:5432/${DB_NAME}?sslmode=disable"
gh secret set DATABASE_SERVICE_URL --env $ENV --body "postgresql://${SVC_USER}:${SVC_PASS}@postgres:5432/${DB_NAME}?sslmode=disable"

# Temporal
gh secret set TEMPORAL_DB_USER --env $ENV --body "temporal"
gh secret set TEMPORAL_DB_PASSWORD --env $ENV --body "$(openssl rand -hex 32)"

# Service tokens
gh secret set AUTH_SECRET --env $ENV --body "$(openssl rand -hex 32)"
gh secret set LITELLM_MASTER_KEY --env $ENV --body "sk-$(openssl rand -hex 24)"
gh secret set METRICS_TOKEN --env $ENV --body "$(openssl rand -base64 32)"
gh secret set SCHEDULER_API_TOKEN --env $ENV --body "$(openssl rand -base64 32)"
gh secret set BILLING_INGEST_TOKEN --env $ENV --body "$(openssl rand -base64 32)"
gh secret set INTERNAL_OPS_TOKEN --env $ENV --body "$(openssl rand -base64 32)"
gh secret set OPENCLAW_GATEWAY_TOKEN --env $ENV --body "$(openssl rand -base64 32)"

# Deploy infra
gh secret set SSH_DEPLOY_KEY --env $ENV --body "$(cat ~/.ssh/${REPO_NAME//-/_}_${ENV}_deploy)"
gh secret set VM_HOST --env $ENV --body "$VM_IP"
```

**From .env.local (shared credentials — same value both envs):**

```bash
gh secret set OPENROUTER_API_KEY --env $ENV --body "$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2-)"
gh secret set EVM_RPC_URL --env $ENV --body "$(grep '^EVM_RPC_URL=' .env.local | cut -d= -f2-)"
gh secret set OPENCLAW_GITHUB_RW_TOKEN --env $ENV --body "$(grep '^OPENCLAW_GITHUB_RW_TOKEN=' .env.local | cut -d= -f2-)"
gh secret set POSTHOG_API_KEY --env $ENV --body "$(grep '^POSTHOG_API_KEY=' .env.local | cut -d= -f2-)"
gh secret set POSTHOG_HOST --env $ENV --body "$(grep '^POSTHOG_HOST=' .env.local | cut -d= -f2-)"
gh secret set POSTHOG_PROJECT_ID --env $ENV --body "$(grep '^POSTHOG_PROJECT_ID=' .env.local | cut -d= -f2-)"
```

**Domain — ask user for their preview and production domains:**

```bash
# DOMAIN is read as a GitHub Actions variable (not secret)
gh variable set DOMAIN --env $ENV --body "<user-provided-domain>"
# Also set as secret for deploy.sh env file generation
gh secret set DOMAIN --env $ENV --body "<user-provided-domain>"
```

### Repository secrets (set once, shared across envs)

```bash
gh secret set CHERRY_AUTH_TOKEN --body "$(grep '^CHERRY_AUTH_TOKEN=' .env.local | cut -d= -f2-)"
gh secret set GHCR_DEPLOY_TOKEN --body "$(grep '^GHCR_DEPLOY_TOKEN=' .env.local | cut -d= -f2-)"
gh secret set GIT_READ_TOKEN --body "$(grep '^GIT_READ_TOKEN=' .env.local | cut -d= -f2-)"
gh secret set GIT_READ_USERNAME --body "$(grep '^GIT_READ_USERNAME=' .env.local | cut -d= -f2-)"
gh secret set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID --body "$(grep '^NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=' .env.local | cut -d= -f2- | cut -d'#' -f1 | xargs)"
```

**Optional repo secrets — prompt only if user wants them:**

- `SONAR_TOKEN` — https://sonarcloud.io/account/security
- `ACTIONS_AUTOMATION_BOT_PAT` — https://github.com/settings/tokens/new (needs `repo`, `workflow` scopes)

## Phase 5: DNS

Ask the user to create A records at their domain registrar:

| Host                     | Type | Value                | Purpose                |
| ------------------------ | ---- | -------------------- | ---------------------- |
| `<preview-subdomain>`    | A    | `<preview-vm-ip>`    | Preview environment    |
| `<production-subdomain>` | A    | `<production-vm-ip>` | Production environment |

Example: "Go to your DNS provider (e.g., Namecheap → Advanced DNS) and add these A records."

Verify propagation:

```bash
dig +short <preview-domain>
dig +short <production-domain>
```

## Phase 6: Deploy & Verify

### Trigger deploy

Merge setup changes to `staging` branch to trigger the Staging Preview workflow. Or push directly if on staging.

### Monitor deploy

```bash
# Watch the run
gh run list --limit 5
gh run view <run-id> --json status,conclusion,jobs --jq '{status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}'
```

### Common deploy failures and fixes

| Error                                 | Cause                                              | Fix                                                                         |
| ------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `Missing required secret: X`          | Secret not set in GitHub                           | Set it with `gh secret set`                                                 |
| `docker login ghcr.io denied`         | `GHCR_DEPLOY_TOKEN` missing or is fine-grained PAT | Must be **Classic PAT** with `read:packages`                                |
| `no route to host` for registry pulls | Transient VM network issue                         | Rerun: `gh run rerun <id> --failed`                                         |
| Container unhealthy / OOM             | VM too small                                       | Must be `B1-4-4gb-80s-shared` minimum                                       |
| `App did not become ready after 30s`  | First deploy cold start, migrations                | Rerun — second attempt usually succeeds                                     |
| `SSH key label already exists`        | Another repo used same label                       | Fix: `main.tf` should use `${var.vm_name_prefix}-${var.environment}-deploy` |

### Success criteria

The deploy is successful when:

1. Build job: success
2. Deploy job: success
3. E2E job: success (or skipped if no DNS yet)
4. `curl -I https://<domain>/readyz` returns 200

### Checkpoint: Preview success

Once preview deploys successfully, **repeat Phases 3-6 for production** with:

- `ENV=production`
- Production domain
- Production SSH key

## Done

The agent's job is complete when:

- [ ] Preview deployment successful (green CI run)
- [ ] Production deployment successful (green CI run)
- [ ] `pnpm check` passes locally
- [ ] DNS resolves for both environments
- [ ] `/readyz` returns 200 on both domains

## Anti-patterns (things that broke during our first setup)

1. **NEVER `source .env.local`** — use `grep` extraction for individual vars
2. **NEVER use fine-grained PATs for GHCR** — only Classic PATs work
3. **NEVER use 2GB VMs** — the full stack requires 4GB minimum
4. **NEVER hardcode `cogni-template` names** — always derive from repo name
5. **NEVER skip `pnpm check`** before deploying — repo-spec validation catches issues early
6. **NEVER trust that `regions` endpoint auth = real auth** — `/v1/regions` is public, test with `/v1/teams`
