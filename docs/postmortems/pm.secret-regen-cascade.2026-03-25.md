---
id: pm.secret-regen-cascade.2026-03-25
type: postmortem
title: "Secret Regeneration Cascade — setup:secrets --all breaks both deployments"
status: draft
trust: draft
severity: SEV2
duration: "~6 hours (and counting for production)"
services_affected: [preview, production, db-provision, db-migrate, app, scheduler-worker]
summary: "Running `pnpm setup:secrets --all` regenerated DB passwords with URL-unsafe characters and missing sslmode param, breaking both preview and production deploys across 3 independent failure modes."
read_when: "Modifying setup-secrets.ts, regenerating secrets, provisioning new VMs, debugging deploy failures"
owner: derekg1729
created: 2026-03-26
verified: 2026-03-26
tags: [incident, secrets, deploy, database]
---

# Postmortem: Secret Regeneration Cascade

**Date**: 2026-03-25 through 2026-03-26
**Severity**: SEV2 (both environments down, no data loss)
**Status**: Preview resolved, production pending
**Duration**: ~6 hours active investigation

---

## Summary

During GitOps migration work (PR #628), `pnpm setup:secrets --all` was run, regenerating all GitHub Actions secrets for both preview and production environments. New VMs were provisioned via `tofu apply`. Both deployments entered a failure cascade with **three independent bugs** that had to be discovered and fixed sequentially:

1. **URL-unsafe passwords**: `rand64()` generated base64 passwords containing `+`, `/`, `=` which break URL parsing in PostgreSQL DSN strings.
2. **Password desync**: `APP_DB_PASSWORD` and `DATABASE_URL` are independent GitHub secrets. Manual remediation set them to different values, so `db-provision` created roles with one password while `db-migrate` tried to connect with another.
3. **Missing sslmode**: `setup-secrets.ts` constructs `DATABASE_URL` without `?sslmode=disable`. The app's Zod boot validation rejects non-localhost DSNs missing this parameter.

No data was lost (VMs were fresh). Preview is now deploying successfully. Production deploy pending.

## Timeline

| Time (UTC) | Event |
| --- | --- |
| ~2026-03-25 19:00 | `pnpm setup:secrets --all` run during PR #628 work — regenerates all secrets |
| ~2026-03-25 19:30 | Old VMs destroyed, new VMs provisioned via `tofu apply` |
| 2026-03-25 21:53 | Production deploy (`23566056549`) fails: `password authentication failed` + `ERR_INVALID_URL` on `BW+65+lgnbu6xN+tUd3itu+BJbp68pn/` |
| 2026-03-25 ~22:00 | Root cause #1 identified: base64 `+`/`/` in passwords break URL parser |
| 2026-03-25 ~22:00 | Fix committed: `d22f8b00` — `setup-secrets.ts` changed from `rand64()` to `randHex()` |
| 2026-03-26 01:10 | Manual remediation: hex passwords set via `gh secret set` — but `APP_DB_PASSWORD` and `DATABASE_URL` set independently with different values |
| 2026-03-26 01:35 | Preview deploy fails: `password authentication failed` at `db-provision` — passwords desynced |
| 2026-03-26 01:50 | Root cause #2 identified: `APP_DB_PASSWORD` != password embedded in `DATABASE_URL` |
| 2026-03-26 01:50 | Fix: regenerate synced passwords — single hex value used in both `APP_DB_PASSWORD` and `DATABASE_URL` |
| 2026-03-26 01:52 | VMs wiped (`docker compose down -v`) but Postgres volume survives (edge containers hold references) |
| 2026-03-26 02:03 | Re-run of old production workflow still shows old base64 password — likely because `docker compose up -d` doesn't restart containers when only `.env` values change |
| 2026-03-26 02:16 | Preview deploy fails: Postgres volume retained old password baked into data dir |
| 2026-03-26 02:20 | Full nuclear wipe: `docker stop + rm -f + volume rm` on both VMs |
| 2026-03-26 02:40 | Preview deploy: DB provision OK, migration OK, scheduler-worker OK |
| 2026-03-26 02:44 | Preview deploy fails: `DATABASE_URL points to non-localhost host but is missing sslmode= parameter` |
| 2026-03-26 02:45 | Root cause #3 identified: `buildDSNs()` in `setup-secrets.ts` omits `?sslmode=disable` |
| 2026-03-26 02:50 | Fix: manually append `?sslmode=disable` to `DATABASE_URL` and `DATABASE_SERVICE_URL` secrets for both envs |
| 2026-03-26 ~03:15 | Preview deploy succeeds |
| 2026-03-26 ~03:15 | Production deploy pending — needs fresh workflow trigger on `main` |

## Root Cause

### What Happened

`pnpm setup:secrets --all` regenerated all secrets. The `setup-secrets.ts` script had three bugs that combined into a cascade:

1. **`rand64(24)` generates URL-unsafe characters.** Base64 encoding produces `+`, `/`, `=` which are reserved characters in URI syntax. When embedded in `postgresql://user:pass@host/db`, the Node.js `URL` constructor throws `ERR_INVALID_URL`. The scheduler-worker and db-migrate both crashed on boot. Fix: `d22f8b00` switched to `randHex()`.

2. **`DATABASE_URL` is stored as a separate GitHub secret from `APP_DB_PASSWORD`.** The script's `buildDSNs()` function correctly constructs DSNs from component passwords — but only during `setup:secrets` execution. Manual remediation (setting secrets individually via `gh secret set`) creates an opportunity for the password in `APP_DB_PASSWORD` to diverge from the password embedded in `DATABASE_URL`. `db-provision` uses `APP_DB_PASSWORD`; `db-migrate` and the app use `DATABASE_URL`. Different passwords = auth failure.

3. **`buildDSNs()` omits `?sslmode=disable`.** The app's Zod validation (`apps/web/src/shared/env/server-env.ts:284`) enforces `SSL_REQUIRED_NON_LOCAL` from the database RLS spec: any `DATABASE_URL` pointing to a non-localhost host must include `sslmode=`. Docker-internal `postgres:5432` is non-localhost but doesn't use SSL. The runbook (`INFRASTRUCTURE_SETUP.md:206`) documents `?sslmode=disable` but the automated script doesn't implement it.

### Contributing Factors

1. **Proximate cause**: `rand64()` producing URL-unsafe passwords, and `buildDSNs()` missing `?sslmode=disable`
2. **Contributing factor**: Dual-secret architecture (`APP_DB_PASSWORD` + `DATABASE_URL` as independent secrets) creates a sync invariant that is easy to violate during manual remediation
3. **Contributing factor**: Postgres only reads `POSTGRES_PASSWORD` on first data directory initialization. Changing the env var after a volume exists has no effect — the volume must be destroyed for the new password to take hold
4. **Contributing factor**: Re-running a failed deploy after updating secrets did not produce the expected result. `docker compose up -d` does not restart already-running containers when only `.env` values change — the containers continued running with stale environment variables. This made it appear that secret updates weren't taking effect
5. **Systemic factor**: `setup-secrets.ts` has no validation that generated secrets would actually work in a deploy pipeline. The runbook documents requirements (`?sslmode=disable`) that the automated script doesn't enforce

### 5 Whys

1. **Why did the deploy fail?** The app crashed with `ERR_INVALID_URL` on the database password
2. **Why did the password contain `+`?** `rand64()` uses base64 encoding which includes `+`, `/`, `=`
3. **Why wasn't this caught before?** `setup:secrets --all` had never been run end-to-end against a fresh environment; prior deploys used manually set hex passwords
4. **Why did manual remediation also fail?** `APP_DB_PASSWORD` and `DATABASE_URL` are independent secrets that can hold different password values, and the script constructs DSNs without `?sslmode=disable`
5. **Why are there two secrets for the same password?** Historical design predates the `buildDSNs()` function; the structural fix is tracked as `proj.database-ops` P3 (DSN-only provisioning)

## Detection & Response

### What Worked

- The handoff from the previous developer clearly identified the `rand64()` issue and the password mismatch hypothesis
- `deploy.sh` error handling (`on_fail` trap) provided diagnostic container health dumps and app logs
- SSH access to both VMs was working, enabling direct `.env` and Docker state inspection
- The `randHex()` fix was already committed to staging before the second developer started

### What Didn't Work

- **No deploy smoke test for generated secrets**: `setup:secrets` produces secrets that may fail at deploy time with no pre-validation
- **Sequential bug discovery**: Each of the 3 bugs was only discoverable after fixing the previous one. ~30 min build cycle per attempt = hours of wall clock
- **Workflow re-run confusion**: Re-running failed workflows did not pick up updated secrets in already-running containers (`docker compose up -d` is a no-op for running services unless image/config changes), wasting deploy cycles
- **Postgres volume persistence**: `docker compose down -v` didn't fully remove volumes when other compose projects (edge) held references. Required `docker stop + rm -f + volume rm` nuclear sequence

## Impact

### Customer Impact

- No user-facing impact — no production users yet. Preview used for internal testing only.

### Technical Impact

- Both preview and production environments completely down for ~6 hours
- ~8 failed deploy cycles across both environments (~30 min each = ~4 hours of CI time)
- Manual secret remediation required direct VM SSH access
- Developer time: ~3 hours for original developer + ~2 hours for second developer

## Lessons Learned

### What Went Well

1. The `randHex()` fix was already committed before the second developer started investigating
2. The runbook (`INFRASTRUCTURE_SETUP.md`) correctly documented `?sslmode=disable` — the knowledge existed, just wasn't in code
3. No data was at risk (fresh VMs, no production users)
4. `buildDSNs()` architecture is correct — it constructs DSNs from component passwords. Just incomplete.

### What Went Wrong

1. `setup:secrets --all` was run without a deployment validation loop — secrets were set but never tested before old VMs were destroyed
2. Three independent bugs stacked: URL-unsafe chars, password desync, missing sslmode — each required a full deploy cycle (~30 min) to discover
3. The dual-secret architecture (`APP_DB_PASSWORD` + `DATABASE_URL`) is a foot-gun for manual remediation
4. No alerting or monitoring on deploy health — discovery was entirely manual

### Where We Got Lucky

1. Fresh VMs with no user data — with real users this would have been SEV1 with data loss risk
2. SSH keys worked on first try — if those had been wrong too, recovery would have required Cherry Servers console access
3. The `sslmode` validation is a boot-time Zod check, not a runtime crash — it fails fast with a clear error message

## Action Items

| Pri | Action | Owner | Work Item |
| --- | ------ | ----- | --------- |
| P0 | `buildDSNs()` must append `?sslmode=disable` to constructed DATABASE_URLs | derekg1729 | bug.0199 |
| P1 | Add `setup:secrets --dry-run` validation: URL-parseable, sslmode present, passwords match DSNs | derekg1729 | bug.0200 |
| P1 | Eliminate `APP_DB_*` component secrets — DSN-only provisioning | derekg1729 | (proj.database-ops P3) |
| P2 | Document: after secret changes, containers must be recreated (not just restarted) for new `.env` values to take effect. Trigger fresh deploys, not re-runs. | derekg1729 | bug.0201 |

## Related

- [Production VM Loss (2026-02-07)](./2026-02-07-production-vm-loss.md) — prior Cherry Servers incident, same environment
- [Database Operations Project](../../work/projects/proj.database-ops.md) — P3 DSN-only provisioning eliminates the dual-secret problem
- [Infrastructure Setup Runbook](../runbooks/INFRASTRUCTURE_SETUP.md) — documents `?sslmode=disable` requirement (line 206)
- [Database RLS Spec](../spec/database-rls.md) — `SSL_REQUIRED_NON_LOCAL` invariant (line 45)
- [task.0055](../../work/items/task.0055.dedicated-migrator-role.md) — dedicated migrator role (related credential management)
- PR #628 — GitOps migration work that triggered the incident
- Commit `d22f8b00` — `randHex()` fix for URL-unsafe passwords
