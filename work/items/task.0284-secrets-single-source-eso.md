---
id: task.0284
type: task
status: needs_design
priority: 1
rank: 3
estimate: 8
title: "Secrets single source of truth — External Secrets Operator + secret store"
summary: Replace the current split-brain (GitHub env secrets + laptop .env + VM .env + half-wired SOPS) with one authoritative secret store. Kubernetes pulls secrets via External Secrets Operator. Compose infra derives from the same source.
outcome: "One secret store (Vault, Doppler, or 1Password Connect). K8s secrets synced via ESO. Compose .env derived from same store at deploy time. No laptop .env files. No GitHub env secrets for app secrets (only CI infra like GITHUB_TOKEN). SOPS used only as bootstrap/interim for non-k8s consumers, not as Argo repo-server decryption."
initiative: proj.cicd-services-gitops
assignees: []
labels: [ci-cd, infra, secrets, security, p1]
created: 2026-04-04
updated: 2026-04-04
---

# task.0284 — Secrets single source of truth

## Problem

Five places hold secrets today:

| Source | Used by | Reconstructable? |
|---|---|---|
| GitHub env secrets | CI deploy-infra.sh | No (write-only API) |
| `.env.{env}` on laptop | provision-test-vm.sh | No (gitignored) |
| VM `/opt/cogni-template-runtime/.env` | Compose services | Overwritten each deploy |
| k8s Secrets (kubectl create) | App pods | Recreated on provision |
| SOPS `.enc.yaml` in git | Unused by Argo (ksops not wired) | Yes (git) |

If a developer's laptop dies, secrets are unrecoverable. Rotation requires touching multiple systems. No audit trail for secret changes.

## Architecture decision

**Use External Secrets Operator (ESO)** with a real secret store, NOT SOPS/ksops for Argo.

Rationale (per Argo CD docs): destination-cluster secret management is more secure than decrypting during manifest generation. It decouples secret changes from app syncs and avoids giving Argo repo-server access to decrypt all secrets.

**Secret store options (evaluate in design phase):**
- **1Password Connect** — team already uses 1Password, lowest friction
- **Doppler** — purpose-built for this, good DX, free tier
- **HashiCorp Vault** — most capable, most operational overhead
- **AWS Secrets Manager** — if/when infra moves to AWS

## Target architecture

```
Secret Store (source of truth)
    ├── ESO SecretStore → ExternalSecret CRDs → k8s Secrets (auto-synced)
    ├── deploy-infra.sh → reads from store API → writes compose .env
    └── provision.sh → reads from store API → bootstraps VM
```

- One write path: secret store UI/CLI/API
- Three read paths: ESO (k8s), deploy-infra (compose), provision (bootstrap)
- Rotation: update in store → ESO auto-syncs k8s → next deploy-infra syncs compose
- Audit: secret store provides access logs

## Phases

### Phase 1: ESO + secret store for k8s secrets
- Install ESO on k3s cluster
- Configure SecretStore pointing to chosen provider
- Create ExternalSecret CRDs for each app (operator, poly, resy, scheduler-worker)
- Remove `kubectl create secret` from provision script
- Verify Argo syncs apps with ESO-managed secrets

### Phase 2: Compose .env from secret store
- deploy-infra.sh reads from secret store API (not GitHub env secrets)
- provision.sh reads from secret store API (not .env file)
- Delete `.env.{env}` workflow entirely
- Migrate GitHub env secrets to secret store (keep only CI infra secrets in GitHub)

### Phase 3: Cleanup
- Remove SOPS encrypted files from git (no longer needed)
- Remove setup-secrets.ts (replaced by store UI/CLI)
- Document rotation runbook

## Design constraints

- SOPS may remain as interim for non-k8s consumers during migration
- Do not use SOPS as the long-term Argo secret model (ksops = wrong direction)
- GitHub env secrets remain for CI-only concerns (GITHUB_TOKEN, GHCR auth)
- task.0283 (provision-as-GitHub-Action) is the near-term bridge; this task is the permanent fix
- Backups (etcd snapshots, Velero, Postgres PITR) are a separate but related concern — secret store itself needs backup strategy

## Dependencies

- task.0283 (provision as GH Action) — bridges the gap until this is done
- Backup strategy (etcd + Velero + Postgres PITR) — should be designed in parallel
