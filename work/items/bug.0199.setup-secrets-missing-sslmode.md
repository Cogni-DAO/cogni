---
id: bug.0199
type: bug
title: "setup-secrets buildDSNs() omits ?sslmode=disable — app rejects generated DATABASE_URLs at boot"
status: done
priority: 0
rank: 1
estimate: 1
summary: "`buildDSNs()` in `scripts/setup-secrets.ts` constructs DATABASE_URL without `?sslmode=disable`. The app's Zod validation (SSL_REQUIRED_NON_LOCAL) rejects non-localhost DSNs missing sslmode, causing boot failure on every fresh deploy."
outcome: "`buildDSNs()` appends `?sslmode=disable` to all constructed DATABASE_URLs. Generated secrets pass app boot validation."
spec_refs:
  - database-rls-spec
assignees: derekg1729
credit:
project: proj.database-ops
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [secrets, deploy, database, p0]
external_refs:
  - pm.secret-regen-cascade.2026-03-25
---

# setup-secrets buildDSNs() omits ?sslmode=disable

## Bug

`scripts/setup-secrets.ts` `buildDSNs()` constructs DATABASE_URL as:

```
postgresql://app_user:${pw}@postgres:5432/cogni_template
```

Missing `?sslmode=disable`. The app's Zod boot validation (`apps/web/src/shared/env/server-env.ts:284`) enforces `SSL_REQUIRED_NON_LOCAL` from the database RLS spec: any DATABASE_URL pointing to a non-localhost host must include `sslmode=`. Docker-internal `postgres:5432` is non-localhost but doesn't use SSL.

The runbook (`docs/runbooks/INFRASTRUCTURE_SETUP.md:206`) documents this requirement but the automated script doesn't implement it.

## Fix

In `scripts/setup-secrets.ts`, `buildDSNs()`:

```typescript
// Before:
const url = `postgresql://${appUser}:${appPw}@${host}:5432/${dbName}`;

// After:
const url = `postgresql://${appUser}:${appPw}@${host}:5432/${dbName}?sslmode=disable`;
```

Same for the service URL construction.

## Validation

```bash
pnpm setup:secrets --all --dry-run  # if dry-run exists
# Otherwise: manually verify generated DATABASE_URL contains ?sslmode=disable
# Then: trigger a fresh deploy and confirm app boots
```

## Allowed Changes

- `scripts/setup-secrets.ts` — `buildDSNs()` function only
