# Infrastructure Setup

Provisioning guide for the two-VM architecture: **Compose VM** (app, postgres, temporal, litellm) and **k3s VM** (scheduler-worker via Argo CD + GitOps).

**When to use:** First-time setup, disaster recovery, adding an environment.

## Prerequisites

- Cherry Servers account with API token ([portal.cherryservers.com](https://portal.cherryservers.com))
- GitHub CLI authenticated (`gh auth login`)
- OpenTofu installed (`scripts/bootstrap/install/install-tofu.sh`)
- `age` installed (`brew install age` or [github.com/FiloSottile/age](https://github.com/FiloSottile/age))
- `sops` installed (`brew install sops` or [github.com/getsops/sops](https://github.com/getsops/sops))
- Domain access (Namecheap or your registrar)

## Quick Reference

| VM         | Module        | Runs                                   | Managed By     |
| ---------- | ------------- | -------------------------------------- | -------------- |
| Compose VM | `cherry/base` | app, postgres, temporal, litellm, edge | Docker Compose |
| k3s VM     | `cherry/k3s`  | scheduler-worker                       | Argo CD        |

| Environment | Domain               | SSH Key                                     | GitHub Environment |
| ----------- | -------------------- | ------------------------------------------- | ------------------ |
| Preview     | preview.cognidao.org | `keys/cogni_template_preview_deploy.pub`    | `preview`          |
| Production  | cognidao.org         | `keys/cogni_template_production_deploy.pub` | `production`       |

---

## Step 1: Generate SSH Deploy Keys

```bash
# Generate keypairs (no passphrase for CI automation)
ssh-keygen -t ed25519 -f ~/.ssh/cogni_template_preview_deploy -C "cogni-template-preview" -N ""
ssh-keygen -t ed25519 -f ~/.ssh/cogni_template_production_deploy -C "cogni-template-production" -N ""

# Copy public keys to repo (used by both cherry/base and cherry/k3s)
cp ~/.ssh/cogni_template_preview_deploy.pub infra/tofu/cherry/base/keys/
cp ~/.ssh/cogni_template_production_deploy.pub infra/tofu/cherry/base/keys/

# Upload private keys to GitHub Secrets
gh secret set SSH_DEPLOY_KEY --env preview --body "$(cat ~/.ssh/cogni_template_preview_deploy)"
gh secret set SSH_DEPLOY_KEY --env production --body "$(cat ~/.ssh/cogni_template_production_deploy)"

# Commit public keys
git add infra/tofu/cherry/base/keys/*.pub
git commit -m "chore(infra): add SSH deploy keys"
git push
```

---

## Step 2: Set Credentials

```bash
export CHERRY_AUTH_TOKEN="<cherry-api-token>"
export CHERRY_PROJECT_ID="<cherry-project-id>"
```

---

## Step 3: Provision VMs

> **Important**: `TF_VAR_ssh_private_key` must match the public key in your tfvars. Mismatch → health check fails with "SSH authentication failed".

### 3a: Compose VM (`cherry/base`)

```bash
cd infra/tofu/cherry/base
export TF_VAR_ssh_private_key="$(cat ~/.ssh/cogni_template_preview_deploy)"

cat > terraform.preview.tfvars << EOF
environment     = "preview"
vm_name_prefix  = "cogni-template"
project_id      = "${CHERRY_PROJECT_ID}"
plan            = "B1-4-4gb-80s-shared"
region          = "LT-Siauliai"
public_key_path = "keys/cogni_template_preview_deploy.pub"
EOF

tofu init
tofu workspace new preview || tofu workspace select preview
tofu plan -var-file=terraform.preview.tfvars
tofu apply -var-file=terraform.preview.tfvars

export COMPOSE_VM_IP=$(tofu output -raw vm_host)
echo "Compose VM IP: $COMPOSE_VM_IP"
```

### 3b: k3s VM (`cherry/k3s`)

```bash
cd infra/tofu/cherry/k3s
export TF_VAR_ssh_private_key="$(cat ~/.ssh/cogni_template_preview_deploy)"

cat > terraform.preview.tfvars << EOF
environment       = "preview"
project_id        = "${CHERRY_PROJECT_ID}"
plan              = "B1-4-4gb-80s-shared"
region            = "LT-Siauliai"
public_key_path   = "../base/keys/cogni_template_preview_deploy.pub"
ghcr_deploy_token = "<github-pat-with-read-packages>"
EOF

tofu init
tofu workspace new preview || tofu workspace select preview
tofu plan -var-file=terraform.preview.tfvars
tofu apply -var-file=terraform.preview.tfvars

export K3S_VM_IP=$(tofu output -raw vm_host)
echo "k3s VM IP: $K3S_VM_IP"
```

Cloud-init installs k3s, generates an age keypair, installs Argo CD with ksops, and applies the app-of-apps Application. Takes ~5 minutes. Argo CD sync stays degraded until Step 4 completes.

---

## Step 4: Bootstrap k3s Secrets

After cloud-init finishes, Argo CD is running but cannot decrypt secrets (placeholder age key in `.sops.yaml`). This step wires the real age public key, encrypts secrets, and fills overlay placeholders.

```bash
# Wait for cloud-init
ssh root@$K3S_VM_IP cloud-init status --wait

# Verify bootstrap
ssh root@$K3S_VM_IP cat /var/lib/cogni/bootstrap.ok

# Get the age public key generated on the VM
AGE_PUBLIC_KEY=$(ssh root@$K3S_VM_IP cat /var/lib/cogni/age-public-key.txt)
echo "Age public key: $AGE_PUBLIC_KEY"
```

### 4a: Update `.sops.yaml` with real age key

```bash
cd infra/cd/secrets
# Replace the placeholder with the real public key
sed -i '' "s/age1staging_placeholder_replace_with_real_public_key/$AGE_PUBLIC_KEY/" .sops.yaml
```

### 4b: Encrypt secrets

```bash
# Create plaintext secrets file, then encrypt
cat > staging/scheduler-worker.enc.yaml << EOF
apiVersion: v1
kind: Secret
metadata:
  name: scheduler-worker-secrets
  namespace: cogni-staging
type: Opaque
stringData:
  DATABASE_URL: "postgresql://<app_user>:<app_pass>@postgres:5432/<db_name>?sslmode=disable"
  SCHEDULER_API_TOKEN: "<scheduler-api-token>"
EOF

sops --encrypt --in-place staging/scheduler-worker.enc.yaml
```

### 4c: Fill overlay placeholders

Edit `infra/cd/overlays/staging/kustomization.yaml`:

- Replace `10.0.0.1` (4 occurrences) with `$COMPOSE_VM_IP`
- Replace `staging-placeholder-scheduler-worker` with the real image digest (`@sha256:...` from GHCR)

### 4d: Allow k3s traffic on Compose VM firewall

```bash
ssh root@$COMPOSE_VM_IP bash -c "
  ufw allow from $K3S_VM_IP to any port 7233 comment 'k3s→temporal'
  ufw allow from $K3S_VM_IP to any port 5432 comment 'k3s→postgres'
  ufw allow from $K3S_VM_IP to any port 3000 comment 'k3s→app'
"
```

### 4e: Commit and push

```bash
git add infra/cd/secrets/.sops.yaml infra/cd/secrets/staging/ infra/cd/overlays/staging/
git commit -m "chore(infra): wire k3s secrets + overlay for staging"
git push
```

Argo CD auto-syncs within 3 minutes. Verify:

```bash
ssh root@$K3S_VM_IP kubectl -n argocd get app
ssh root@$K3S_VM_IP kubectl -n cogni-staging get pods
```

---

## Step 5: Configure DNS

Update A records at your domain registrar:

| Host      | Type | Value            | TTL       |
| --------- | ---- | ---------------- | --------- |
| `preview` | A    | `$COMPOSE_VM_IP` | Automatic |
| `@`       | A    | `$COMPOSE_VM_IP` | Automatic |
| `www`     | A    | `$COMPOSE_VM_IP` | Automatic |

> k3s VM has no public DNS — scheduler-worker is internal only.

```bash
dig +short preview.cognidao.org
```

---

## Step 6: Update GitHub Secrets

### VM Host IPs

```bash
gh secret set VM_HOST --env preview --body "$COMPOSE_VM_IP"
gh secret set VM_HOST --env production --body "$PROD_IP"
```

### Required Secrets Per Environment

```bash
ENV="preview"  # run twice: preview, production

# Database credentials — generate ALL in one session
POSTGRES_ROOT_PASS=$(openssl rand -hex 32)
APP_USER="cogni_app_${ENV}"
APP_PASS=$(openssl rand -hex 32)
SVC_USER="cogni_app_${ENV}_service"
SVC_PASS=$(openssl rand -hex 32)
DB_NAME="cogni_template_${ENV}"

gh secret set POSTGRES_ROOT_USER --env $ENV --body "postgres"
gh secret set POSTGRES_ROOT_PASSWORD --env $ENV --body "$POSTGRES_ROOT_PASS"
gh secret set APP_DB_USER --env $ENV --body "$APP_USER"
gh secret set APP_DB_PASSWORD --env $ENV --body "$APP_PASS"
gh secret set APP_DB_SERVICE_USER --env $ENV --body "$SVC_USER"
gh secret set APP_DB_SERVICE_PASSWORD --env $ENV --body "$SVC_PASS"
gh secret set APP_DB_NAME --env $ENV --body "$DB_NAME"

# DSNs (authoritative for runtime, constructed from above)
gh secret set DATABASE_URL --env $ENV --body "postgresql://${APP_USER}:${APP_PASS}@postgres:5432/${DB_NAME}?sslmode=disable"
gh secret set DATABASE_SERVICE_URL --env $ENV --body "postgresql://${SVC_USER}:${SVC_PASS}@postgres:5432/${DB_NAME}?sslmode=disable"

# Service secrets
gh secret set AUTH_SECRET --env $ENV --body "$(openssl rand -hex 32)"
gh secret set LITELLM_MASTER_KEY --env $ENV --body "sk-$(openssl rand -hex 24)"
gh secret set METRICS_TOKEN --env $ENV --body "$(openssl rand -base64 32)"
gh secret set DOMAIN --env $ENV --body "preview.cognidao.org"  # or "cognidao.org"
gh secret set OPENROUTER_API_KEY --env $ENV --body "<your-openrouter-key>"
gh secret set EVM_RPC_URL --env $ENV --body "<your-rpc-url>"
```

### Repository Secrets (Shared)

```bash
gh secret set CHERRY_AUTH_TOKEN --body "<cherry-api-token>"
gh secret set GHCR_DEPLOY_TOKEN --body "<github-pat-with-packages-read>"
gh secret set SONAR_TOKEN --body "<sonarcloud-token>"
gh secret set ACTIONS_AUTOMATION_BOT_PAT --body "<bot-pat>"
gh secret set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID --body "<walletconnect-project-id>"
```

### Optional: Grafana Cloud

```bash
gh secret set GRAFANA_CLOUD_LOKI_URL --env $ENV --body "<loki-push-url>"
gh secret set GRAFANA_CLOUD_LOKI_USER --env $ENV --body "<loki-user-id>"
gh secret set GRAFANA_CLOUD_LOKI_API_KEY --env $ENV --body "<loki-api-key>"
gh secret set PROMETHEUS_REMOTE_WRITE_URL --env $ENV --body "<prometheus-url>"
gh secret set PROMETHEUS_USERNAME --env $ENV --body "<prometheus-user>"
gh secret set PROMETHEUS_PASSWORD --env $ENV --body "<prometheus-password>"
```

---

## Step 7: Verify

```bash
# Compose VM — HTTPS health
curl -I https://preview.cognidao.org/readyz

# k3s VM — cluster + pods
ssh root@$K3S_VM_IP kubectl get nodes
ssh root@$K3S_VM_IP kubectl -n argocd get app
ssh root@$K3S_VM_IP kubectl -n cogni-staging get pods

# Argo CD UI (via port-forward)
ssh root@$K3S_VM_IP -L 8080:localhost:443
# Then: https://localhost:8080
```

---

## SSH Reference

```bash
# Compose VM
ssh -i ~/.ssh/cogni_template_preview_deploy root@<COMPOSE_VM_IP>

# k3s VM
ssh -i ~/.ssh/cogni_template_preview_deploy root@<K3S_VM_IP>

# Get IPs from tofu
cd infra/tofu/cherry/base && tofu workspace select preview && tofu output -raw vm_host
cd infra/tofu/cherry/k3s && tofu workspace select preview && tofu output -raw vm_host
```

### Service Locations

| Service          | VM         | Access                                                  |
| ---------------- | ---------- | ------------------------------------------------------- |
| App (Next.js)    | Compose VM | `https://<domain>/readyz`                               |
| Postgres         | Compose VM | port 5432 (internal)                                    |
| Temporal         | Compose VM | port 7233 (gRPC), 8233 (UI)                             |
| LiteLLM          | Compose VM | port 4000 (internal)                                    |
| scheduler-worker | k3s VM     | `kubectl -n cogni-staging logs deploy/scheduler-worker` |
| Argo CD          | k3s VM     | `ssh -L 8080:localhost:443` then https://localhost:8080 |

---

## Troubleshooting

### Health Check Fails: "SSH authentication failed"

`TF_VAR_ssh_private_key` doesn't match the public key on the VM. Set the correct key and re-apply:

```bash
export TF_VAR_ssh_private_key="$(cat ~/.ssh/cogni_template_preview_deploy)"
tofu apply -var-file=terraform.preview.tfvars
```

### Argo CD Sync Degraded

SOPS decryption failing — age key mismatch. Verify Step 4 completed:

```bash
# Check the age public key on the VM matches .sops.yaml
ssh root@$K3S_VM_IP cat /var/lib/cogni/age-public-key.txt
grep age infra/cd/secrets/.sops.yaml
```

### Certificate Errors (SSL mismatch)

VM terminated and IP reassigned, or Caddy failed to obtain cert. Re-provision VM, update DNS, update GitHub secrets.

### DNS Not Propagating

```bash
dig +trace preview.cognidao.org
# macOS: sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

---

## Reference: Secrets Checklist

### Per-Environment

| Secret                    | Description                    | Source                                   |
| ------------------------- | ------------------------------ | ---------------------------------------- |
| `VM_HOST`                 | Compose VM IP                  | `tofu output` (cherry/base)              |
| `DOMAIN`                  | Environment domain             | `preview.cognidao.org` or `cognidao.org` |
| `SSH_DEPLOY_KEY`          | Private SSH key                | Step 1                                   |
| `POSTGRES_ROOT_USER`      | DB root user                   | `postgres`                               |
| `POSTGRES_ROOT_PASSWORD`  | DB root password               | `openssl rand -hex 32`                   |
| `APP_DB_USER`             | App DB user (RLS enforced)     | `cogni_app_<env>`                        |
| `APP_DB_PASSWORD`         | App DB password                | `openssl rand -hex 32`                   |
| `APP_DB_SERVICE_USER`     | Service DB user (BYPASSRLS)    | `cogni_app_<env>_service`                |
| `APP_DB_SERVICE_PASSWORD` | Service DB password            | `openssl rand -hex 32`                   |
| `APP_DB_NAME`             | Database name                  | `cogni_template_<env>`                   |
| `DATABASE_URL`            | App connection string (RLS)    | Derived from above                       |
| `DATABASE_SERVICE_URL`    | Service connection (BYPASSRLS) | Derived from above                       |
| `AUTH_SECRET`             | NextAuth secret                | `openssl rand -hex 32`                   |
| `LITELLM_MASTER_KEY`      | LiteLLM API key                | `sk-$(openssl rand -hex 24)`             |
| `METRICS_TOKEN`           | Metrics auth token             | `openssl rand -base64 32`                |
| `OPENROUTER_API_KEY`      | OpenRouter API key             | openrouter.ai                            |
| `EVM_RPC_URL`             | Ethereum RPC URL               | Alchemy/Infura                           |

> **Two Config Surfaces:** DSNs (`DATABASE_URL`, `DATABASE_SERVICE_URL`) are authoritative for runtime. Component secrets (`POSTGRES_ROOT_*`, `APP_DB_*`) are for provisioning only. See `docs/spec/database-url-alignment.md`.

### Repository Secrets

| Secret                                 | Description                     |
| -------------------------------------- | ------------------------------- |
| `CHERRY_AUTH_TOKEN`                    | Cherry Servers API token        |
| `GHCR_DEPLOY_TOKEN`                    | GitHub PAT with `read:packages` |
| `SONAR_TOKEN`                          | SonarCloud token                |
| `ACTIONS_AUTOMATION_BOT_PAT`           | Bot PAT for automation          |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID        |
