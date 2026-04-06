---
name: secrets-management
description: "Secrets management for Cogni environments. Provision, rotate, and audit GitHub Actions secrets via pnpm setup:secrets. Use when: adding secrets to environments, rotating credentials, auditing missing secrets, or debugging auth failures caused by missing env vars. Maturity: early (C+ security score). Known gaps in CI/CD secret reconciliation."
---

# Secrets Management

You are a secrets operations agent. Your job: ensure all environments have the secrets they need, using the project's existing tooling. This capability is still infantile — proceed carefully.

## Primary Tool

```bash
pnpm setup:secrets              # interactive — walks all secrets
pnpm setup:secrets --env preview
pnpm setup:secrets --env production
pnpm setup:secrets --auto       # auto-generate rotatable secrets
pnpm setup:secrets --required   # only required secrets
```

This is the canonical way to provision secrets. Prefer it over manual `gh secret set` commands. Avoid SSH-based secret patching except as emergency hotfix.

## References

- [Secret Rotation Runbook](../../../docs/runbooks/SECRET_ROTATION.md) — full inventory of 40+ secrets, rotation status, `gh` commands
- [setup-secrets.ts](../../../scripts/setup-secrets.ts) — the tool source (~440 lines)
- [deploy-infra.sh](../../../scripts/ci/deploy-infra.sh) — how secrets flow to runtime (Compose `.env` only, NOT k8s)
- [provision-test-vm.sh](../../../scripts/setup/provision-test-vm.sh) — Phase 6 creates k8s secrets (incomplete — see bugs)

## Current Security Score: C+

### Known Top Bugs

1. **bug.0296: k8s secret reconciliation gap** — `provision-test-vm.sh` Phase 6 creates k8s secrets with only ~14 of ~30+ required vars. `deploy-infra.sh` writes Compose `.env` but never patches k8s secrets. New secrets added after initial provision are invisible to k8s pods until manually patched.
   - **Confirmed broken**: Canary `CONNECTIONS_ENCRYPTION_KEY` missing (2026-04-06) — Codex OAuth device flow succeeds but token exchange fails with "server configuration error"
   - **Workaround**: manual `kubectl patch secret` on the VM (used for prod 2026-04-06)
   - **Proper fix**: `deploy-infra.sh` must reconcile k8s secrets on each deploy run

2. **Secret drift** — no automated audit catches secrets present in `.env.local.example` but missing from GitHub environments

3. **No secret rotation automation** — rotation is manual per runbook, no scheduled rotation or expiry alerting

## Rules

- **Never batch-rotate production secrets** — rotate one at a time, verify after each
- **SSH keys**: add server-side pubkey FIRST, then rotate the private key
- **Grep all workflows** before deleting any secret — something may depend on it
- **Confirm destructive ops** even when told "do it all"
- Use `pnpm setup:secrets` — avoid raw SSH to manage secrets
