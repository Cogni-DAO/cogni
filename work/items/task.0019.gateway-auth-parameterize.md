---
id: task.0019
type: task
title: Parameterize gateway auth token — replace hardcoded secret with env substitution
status: done
priority: 0
estimate: 1
summary: Replace the hardcoded "openclaw-internal-token" in openclaw-gateway.json with OpenClaw's native ${VAR} substitution; pass the real token via compose environment; prevent config writeback from expanding secrets
outcome: Gateway auth token is never committed in plaintext — sourced from compose .env per environment, expanded at runtime by OpenClaw's config loader
spec_refs: openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch: task/0019-gateway-auth-parameterize
pr:
reviewer:
created: 2026-02-10
updated: 2026-02-11
labels: [security, openclaw]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 10
---

# Parameterize gateway auth token — replace hardcoded secret with env substitution

## Context

The gateway config `services/sandbox-openclaw/openclaw-gateway.json` has `gateway.auth.token` hardcoded to `"openclaw-internal-token"`. The server env schema (`src/shared/env/server.ts`) defaults to the same value. This means every environment (dev, preview, prod) shares the same predictable token — a credential that gates access to run arbitrary AI agents.

OpenClaw supports `${VAR}` substitution at config load time (verified in OpenClaw source). The fix is to use this native mechanism rather than building custom config render scripts.

**Risk**: OpenClaw's gateway can write config back to disk (e.g., after onboarding or session state changes). If the config file is writable, writeback will expand `${...}` placeholders into plaintext, which could then be accidentally committed. The config volume mount is already `:ro` in both compose files — this must remain enforced.

## Requirements

- `openclaw-gateway.json` contains `"token": "${OPENCLAW_GATEWAY_TOKEN}"` instead of a plaintext secret
- Compose services pass `OPENCLAW_GATEWAY_TOKEN` into the `openclaw-gateway` container environment (both prod `docker-compose.yml` and dev `docker-compose.dev.yml`)
- The compose env var uses the required-var syntax `${OPENCLAW_GATEWAY_TOKEN?...}` (fail-fast if missing)
- `server.ts` Zod schema removes the default value from `OPENCLAW_GATEWAY_TOKEN` — requires explicit provisioning (`.min(1)`)
- Config volume mount remains `:ro` — no regression allowing writeback (invariant check, not new work)
- Stack test `sandbox-openclaw.stack.test.ts` still passes — token read from env, fallback updated or removed
- Diagnostic script `scripts/diag-openclaw-gateway.mjs` fallback updated to read env only (no hardcoded fallback)
- No other code changes — the `OpenClawGatewayClient` already reads from `env.OPENCLAW_GATEWAY_TOKEN`

## Allowed Changes

- `services/sandbox-openclaw/openclaw-gateway.json` — replace token value
- `platform/infra/services/runtime/docker-compose.yml` — add env var to `openclaw-gateway` service
- `platform/infra/services/runtime/docker-compose.dev.yml` — add env var to `openclaw-gateway` service
- `src/shared/env/server.ts` — remove default, add `.min(1)`
- `tests/stack/sandbox/sandbox-openclaw.stack.test.ts` — remove hardcoded fallback
- `scripts/diag-openclaw-gateway.mjs` — remove hardcoded fallback
- `.env.local` / compose `.env` documentation (if any `.env.example` exists in `platform/infra/services/runtime/`)

## Plan

- [ ] **1. Config**: In `services/sandbox-openclaw/openclaw-gateway.json`, change `"token": "openclaw-internal-token"` to `"token": "${OPENCLAW_GATEWAY_TOKEN}"`
- [ ] **2. Compose (prod)**: In `platform/infra/services/runtime/docker-compose.yml`, add `OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN?OPENCLAW_GATEWAY_TOKEN is required}` to the `openclaw-gateway` service environment block
- [ ] **3. Compose (dev)**: Same change in `platform/infra/services/runtime/docker-compose.dev.yml`
- [ ] **4. Server env**: In `src/shared/env/server.ts`, change `OPENCLAW_GATEWAY_TOKEN: z.string().default("openclaw-internal-token")` to `OPENCLAW_GATEWAY_TOKEN: z.string().min(1)` — comment: must match `openclaw-gateway.json gateway.auth.token`
- [ ] **5. Stack test**: In `tests/stack/sandbox/sandbox-openclaw.stack.test.ts`, remove `?? "openclaw-internal-token"` fallback — test must read from env (set by compose)
- [ ] **6. Diag script**: In `scripts/diag-openclaw-gateway.mjs`, remove `|| "openclaw-internal-token"` fallback — require env var
- [ ] **7. Verify `:ro` mount**: Confirm both compose files mount `openclaw-gateway.json` as `:ro` — this prevents writeback expansion. Add a comment in compose if not already documented
- [ ] **8. Dev env**: Ensure `.env.local` template or developer-setup guide mentions `OPENCLAW_GATEWAY_TOKEN` as required for sandbox-openclaw profile

## Validation

**Command:**

```bash
# Type check (env schema change may surface missing defaults)
pnpm check

# Stack test (requires sandbox-openclaw profile running)
pnpm test:stack:dev -- tests/stack/sandbox/sandbox-openclaw.stack.test.ts
```

**Expected:** `pnpm check` passes. Stack test connects to gateway with env-sourced token. No hardcoded `"openclaw-internal-token"` remains in any non-`.worktrees` file (verify with `grep -r "openclaw-internal-token" --include="*.ts" --include="*.json" --include="*.mjs" . | grep -v .worktrees`).

## Review Checklist

- [ ] **Work Item:** `task.0019` linked in PR body
- [ ] **Spec:** GATEWAY_ON_INTERNAL_ONLY (invariant 21) upheld — token auth still enforced, just parameterized
- [ ] **Spec:** Config volume `:ro` mount verified in both compose files (writeback prevention)
- [ ] **Tests:** Stack test passes with env-sourced token
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
