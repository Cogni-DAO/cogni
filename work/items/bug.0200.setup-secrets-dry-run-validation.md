---
id: bug.0200
type: bug
title: "setup-secrets has no validation that generated secrets are deploy-safe"
status: needs_design
priority: 1
rank: 5
estimate: 2
summary: "`pnpm setup:secrets --all` can generate secrets that fail at deploy time with no pre-validation. Three separate bugs (URL-unsafe chars, missing sslmode, password desync) were only discoverable after ~30 min deploy cycles each."
outcome: "`setup:secrets` validates all generated secrets before writing to GitHub: DSNs are URL-parseable, sslmode is present, passwords embedded in DSNs match component password secrets."
spec_refs: []
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
labels: [secrets, deploy, reliability, p1]
external_refs:
  - pm.secret-regen-cascade.2026-03-25
---

# setup-secrets has no validation that generated secrets are deploy-safe

## Bug

`pnpm setup:secrets --all` generates and sets GitHub secrets with no validation that the results will actually work in a deploy pipeline. Three bugs discovered in pm.secret-regen-cascade.2026-03-25 were only findable after sequential ~30 min deploy cycles:

1. `rand64()` passwords containing `+`/`/` break URL parsing (fixed: `d22f8b00`)
2. `DATABASE_URL` missing `?sslmode=disable` breaks Zod boot validation (bug.0199)
3. `APP_DB_PASSWORD` and `DATABASE_URL` can hold different password values during manual remediation

## Requirements

- After generating all secrets, validate before writing to GitHub:
  - All DATABASE\_\*\_URL values are parseable by `new URL()`
  - All DATABASE\_\*\_URL values include `sslmode=` parameter
  - Password in `DATABASE_URL` matches `APP_DB_PASSWORD`
  - Password in `DATABASE_SERVICE_URL` matches `APP_DB_SERVICE_PASSWORD`
- `--dry-run` flag: generate and validate without writing to GitHub
- Clear error messages identifying which validation failed

## Validation

```bash
# Generate secrets in dry-run mode — should report all validations passing
pnpm setup:secrets --all --dry-run
```

**Expected:** All generated DATABASE_URLs are URL-parseable, contain `sslmode=`, and passwords match component secrets.

## Allowed Changes

- `scripts/setup-secrets.ts`
