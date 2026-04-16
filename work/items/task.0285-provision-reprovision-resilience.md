---
id: task.0285
type: task
status: needs_implement
priority: 0
rank: 1
estimate: 3
title: "Provision script resilience — credential reset, migrations, complete .env"
summary: "provision-test-vm.sh fails on re-provision with changed secrets. Three bugs: stale postgres volumes reject new creds, no migration run, hardcoded .env subset misses vars. Fix all three so re-provisioning is zero-intervention."
outcome: "Running provision-test-vm.sh against an existing VM with changed secrets produces a fully working environment — no SSH intervention required."
initiative: proj.cicd-services-gitops
assignees: []
labels: [ci-cd, infra, provisioning, p0]
created: 2026-04-04
updated: 2026-04-04
---

# task.0285 — Provision script resilience

## Problem

On 2026-04-04, canary re-provisioning with new secrets (from `setup:secrets`) required 4 manual SSH interventions:

1. `docker volume rm postgres_data` — postgres rejected new root password (old password baked into data volume)
2. `docker volume rm temporal_postgres_data` — same problem, Temporal's dedicated postgres
3. `docker run ... db-migrate` against all 3 node DBs — no tables existed after fresh volume
4. `kubectl rollout restart` — pods cached stale Temporal connection

All four are bugs in `provision-test-vm.sh`. Staging reprovision is next — these must be fixed first.

## Design

### Outcome

`bash provision-test-vm.sh canary --yes` against an existing VM with changed secrets succeeds without SSH intervention. All databases provisioned, migrated, and all pods healthy.

### Approach

Three surgical fixes to Phase 5 of `provision-test-vm.sh`. No new files, no architecture changes.

**Fix 1: Credential mismatch detection + volume reset** (lines 499-515)

After starting postgres, test auth before proceeding. If auth fails, reset the data volume.

```bash
# After "up -d postgres" and health wait:
log_info "Verifying postgres credentials..."
if ! ssh $SSH_OPTS root@"$VM_IP" "PGPASSWORD='${POSTGRES_ROOT_PASSWORD}' docker exec cogni-runtime-postgres-1 psql -U '${POSTGRES_ROOT_USER}' -d postgres -c '\\q'" 2>/dev/null; then
  log_warn "Postgres credential mismatch — resetting data volume..."
  ssh $SSH_OPTS root@"$VM_IP" 'docker compose ... stop postgres && docker compose ... rm -f postgres && docker volume rm postgres_data'
  ssh $SSH_OPTS root@"$VM_IP" 'docker compose ... up -d postgres'
  # re-wait for healthy
fi
```

Same pattern for temporal-postgres after starting it.

**Fix 2: Run migrations after db-provision** (after line 519)

After db-provision succeeds, pull the migrator image and run it against each node DB. The migrator image digest comes from the k8s overlay (same source Argo uses).

```bash
# Resolve migrator digest from k8s overlay
MIGRATOR_DIGEST=$(grep -A2 'cogni-template-migrate' "$REPO_ROOT/infra/k8s/overlays/${OVERLAY_DIR}/operator/kustomization.yaml" | grep digest | cut -d'"' -f2)
MIGRATOR_IMAGE="ghcr.io/cogni-dao/cogni-template@${MIGRATOR_DIGEST}"

# Pull once
ssh $SSH_OPTS root@"$VM_IP" "docker pull $MIGRATOR_IMAGE"

# Migrate each node DB
IFS=',' read -ra DBS <<< "$COGNI_NODE_DBS"
for db_name in "${DBS[@]}"; do
  MIGRATE_URL="postgresql://${APP_DB_USER}:${APP_DB_PASSWORD}@postgres:5432/${db_name}"
  ssh $SSH_OPTS root@"$VM_IP" "docker run --rm --network cogni-runtime_internal -e DATABASE_URL='${MIGRATE_URL}' $MIGRATOR_IMAGE"
  log_info "  Migrated $db_name"
done
```

**Fix 3: SCP the .env file instead of hardcoded heredoc** (lines 436-476)

Replace the hardcoded heredoc with a direct copy of `.env.{env}` plus the derived/placeholder vars appended. This ensures every var from `setup:secrets` reaches the VM.

```bash
# Copy the complete .env.{env} as the base
scp $SSH_OPTS "$ENV_FILE" root@"$VM_IP":/opt/cogni-template-runtime/.env

# Append derived/override vars (VM-specific values not in .env.{env})
ssh $SSH_OPTS root@"$VM_IP" "cat >> /opt/cogni-template-runtime/.env << 'ENVEOF'
DATABASE_URL=${DATABASE_URL}
DATABASE_SERVICE_URL=${DATABASE_SERVICE_URL}
APP_ENV=${APP_ENV}
DEPLOY_ENVIRONMENT=${DEPLOY_ENVIRONMENT}
COGNI_NODE_DBS=${COGNI_NODE_DBS}
COGNI_NODE_ENDPOINTS=${COGNI_NODE_ENDPOINTS}
COGNI_REPO_URL=${COGNI_REPO_URL}
COGNI_REPO_REF=${COGNI_REPO_REF}
APP_BASE_URL=https://${DOMAIN}
APP_IMAGE=placeholder:not-started
MIGRATOR_IMAGE=placeholder:not-started
SCHEDULER_WORKER_IMAGE=placeholder:not-started
OPENCLAW_GITHUB_RW_TOKEN=placeholder-not-started
ENVEOF"
```

Later values override earlier ones in bash `source` — so the derived `DATABASE_URL` (with real VM IP) overrides the one from `.env.canary` (which has `host=postgres`).

**Rejected alternatives:**

- **Full VM destroy + recreate on secret change**: Sledgehammer. Costs 20-30 min and money. The volume reset takes 5 seconds.
- **Store postgres password hash in a sidecar file and compare**: Over-engineered. Just test auth — it's the direct check.
- **Generate `.env` from a template engine**: Adds a dependency. SCP + append is simpler.

**Fix 3: Cherry Servers SSH key name collision** (Phase 3, tofu apply)

Cherry Servers API rejects duplicate SSH key names globally. When a second tofu workspace (e.g. `preview`) tries to create a key with the same name as an existing one (from `test` workspace), it fails with 400. The script has no recovery path — requires manual `tofu import`.

Fix: before `tofu apply`, check if the key name exists via Cherry API. If it does, import it into the current workspace state. Or use a unique name per workspace (include workspace name or hash).

### Invariants

- [ ] IDEMPOTENT_PROVISION: Running provision twice with same secrets produces same result
- [ ] CREDENTIAL_RESET: Changed postgres/temporal creds trigger volume reset, not timeout
- [ ] MIGRATIONS_RUN: All node DBs have schema after provision (not deferred to k8s)
- [ ] SSH_KEY_IDEMPOTENT: Multi-workspace provisioning handles pre-existing Cherry SSH keys
- [ ] NO_NEW_DEPS: No new tools or languages required

### Files

- Modify: `scripts/setup/provision-test-vm.sh` — all three fixes in Phase 5
  - After postgres start: add auth test + volume reset fallback
  - After temporal-postgres start: same auth test pattern
  - After db-provision: add migration run for each node DB
  - Replace .env heredoc with SCP + append
- No new files
- No test files (infra script — validated by running provision)

## Validation

Running `provision-test-vm.sh canary --yes` against an existing VM with changed secrets produces a fully working environment with no SSH intervention.
