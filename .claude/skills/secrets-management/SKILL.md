---
name: secrets-management
description: "Secrets management for Cogni environments. Provision, rotate, and audit GitHub Actions secrets via pnpm setup:secrets. Use when: adding secrets to environments, rotating credentials, auditing missing secrets, or debugging auth failures caused by missing env vars. Maturity: early (C+ security score). Known gaps in CI/CD secret reconciliation."
---

# Secrets Management

You are a secrets operations agent. Your job: ensure all environments have the secrets they need, using the project's existing tooling. This capability is still infantile — proceed carefully.

## Primary Tool

**Always use `pnpm setup:secrets`.** Never set GitHub secrets directly via `gh secret set` — that bypasses the catalog, validation, and audit trail.

```bash
# Walk all missing secrets (all envs)
pnpm setup:secrets

# Target a specific environment
pnpm setup:secrets --env canary
pnpm setup:secrets --env preview
pnpm setup:secrets --env production

# Target specific secret(s) by name pattern
pnpm setup:secrets --only CONNECTIONS_ENCRYPTION_KEY
pnpm setup:secrets --only DISCORD,GOOGLE          # comma-separated patterns

# Combine: specific secret + specific env
pnpm setup:secrets --env canary --only CONNECTIONS_ENCRYPTION_KEY

# Auto-generate agent-rotatable secrets (skips human-provided)
pnpm setup:secrets --env canary --auto

# Only required secrets (skip optional)
pnpm setup:secrets --required

# Re-walk everything including already-set
pnpm setup:secrets --env canary --all
```

The tool knows which secrets are agent-rotatable (auto-generated via `openssl rand`) vs human-provided (requires dashboard URLs). It will guide you.

## Anti-Patterns

- **`gh secret set` directly** — bypasses the secret catalog, no validation, no audit trail, easy to typo names. Always use `pnpm setup:secrets --only <NAME>` instead.
- **`kubectl patch secret` via SSH** — emergency-only. Secrets set this way are overwritten on next `deploy-infra.sh` run if the GitHub secret is empty. File a bug if you're forced to do this.
- **Batch-rotating production secrets** — rotate one at a time, verify after each.

## Environment Guards

- **canary**: safe to iterate. Use `--env canary` freely.
- **preview**: shared test environment. Confirm with team before rotating secrets that affect running tests.
- **production**: **STOP AND CONFIRM** before any secret change. Verify the secret exists and is correct before rotating. Never auto-generate production secrets without explicit user approval.

## References

- [Secret Rotation Runbook](../../../docs/runbooks/SECRET_ROTATION.md) — full inventory of 40+ secrets, rotation status
- [setup-secrets.ts](../../../scripts/setup-secrets.ts) — the tool source, secret catalog, generators
- [deploy-infra.sh](../../../scripts/ci/deploy-infra.sh) — how secrets flow from GitHub → k8s pods
- [provision-test-vm.sh](../../../scripts/setup/provision-test-vm.sh) — Phase 6 creates k8s secrets

## Current Security Score: C+

### Known Top Bugs

1. **bug.0296: k8s secret reconciliation gap** — `deploy-infra.sh` now writes all vars to k8s secrets (PR #801), but `provision-test-vm.sh` Phase 6 still has a hardcoded ~14-var subset. Fresh provisions create incomplete secrets until next `deploy-infra.sh` run.
   - **Confirmed broken**: Canary + Preview missing `CONNECTIONS_ENCRYPTION_KEY` (2026-04-06)
   - **Root cause**: secrets present in GitHub but `deploy-infra.sh` wasn't writing them to k8s. Fixed in PR #801. Canary also missing secrets from GitHub env entirely.

2. **Secret drift** — no automated audit catches secrets present in `.env.local.example` but missing from GitHub environments

3. **No secret rotation automation** — rotation is manual per runbook, no scheduled rotation or expiry alerting

## Rules

- **Always use `pnpm setup:secrets`** — never raw `gh secret set`
- **Never batch-rotate production secrets** — one at a time, verify after each
- **SSH keys**: add server-side pubkey FIRST, then rotate the private key
- **Grep all workflows** before deleting any secret — something may depend on it
- **Confirm destructive ops** even when told "do it all"
