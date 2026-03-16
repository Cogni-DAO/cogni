---
id: bug.0027.handoff
type: handoff
work_item_id: bug.0027
status: active
created: 2026-02-11
updated: 2026-02-11
branch: fix/openclaw-billing-hack
last_commit: 568b391e
---

# Handoff: Gateway Billing — Replace Docker Exec with Shared Volume

## Context

- Production OpenClaw chat is 100% broken — every request returns "Stream finalization failed: internal"
- Root cause: `ProxyBillingReader` uses `docker exec grep` via dockerode to read billing data from the `llm-proxy-openclaw` nginx container, but the production app container correctly does not mount `/var/run/docker.sock`
- Decision: `APP_MUST_NOT_MOUNT_DOCKER_SOCK` — replace dockerode billing reads with a shared named volume between proxy and app containers
- Fix approach: nginx writes JSONL audit log to `/billing/audit.jsonl` on a shared volume; app reads directly from filesystem (tail-read last 2MB)

## Current State

- **Committed (2 commits on branch):**
  - `8cbebdfc` — Core fix: nginx JSONL format, shared volume mounts (prod + dev compose), `ProxyBillingReader` rewritten to tail-read from file, factory requires `OPENCLAW_BILLING_DIR`
  - `568b391e` — Reviewer hardened billing misconfiguration in `SandboxGraphProvider` to throw instead of warn-and-continue
- **Uncommitted (in progress):**
  - `src/shared/env/server.ts` — `OPENCLAW_BILLING_DIR` changed from `.optional()` to `.default("/tmp/cogni-openclaw-billing")` (matches `OPENCLAW_GATEWAY_URL` default pattern)
  - `tests/setup.ts` — Added `OPENCLAW_BILLING_DIR` to test env setup (line ~36)
  - `tests/stack/sandbox/sandbox-openclaw.stack.test.ts` — Partially updated: `extractModelId` rewritten for JSONL, model override tests read from shared volume instead of docker exec, `billingReader` constructor updated
- **Blocking issue — test config DRY violation:**
  - The billing dir path `/tmp/cogni-openclaw-billing` is currently duplicated across: `server.ts` default, `tests/setup.ts`, and the test file constant `BILLING_DIR`
  - User requirement: define this path **once** at the vitest stack config level, not via `process.env` reads in test files
  - This needs resolution before commit — likely via `vitest.stack.config.mts` or a shared test constants module

## Decisions Made

- `NO_DOCKER_SOCK_IN_APP` — app container never mounts docker.sock (security invariant)
- `NO_DOCKERODE_IN_BILLING_PATH` — `ProxyBillingReader` uses filesystem reads, not Docker exec
- `BILLING_FAILURE_STILL_BLOCKS` — empty billing entries still abort the run (no silent swallowing) — hardened in `568b391e`
- Tail-read (last 2MB) instead of `fs.readFile` whole file — prevents unbounded memory on long-running proxy
- JSONL format over key=value — structured parsing via `JSON.parse` instead of regex
- Bounded retry (500ms → 1s → 2s) in reader for nginx flush latency

## Next Actions

- [ ] Resolve DRY violation: define `/tmp/cogni-openclaw-billing` once (vitest stack config or shared constants) — user explicitly rejected `process.env` reads in test files
- [ ] Commit the uncommitted test + env changes
- [ ] Run full stack test suite: `pnpm test:stack:dev` — expect 0 unhandled rejections (the `OPENCLAW_BILLING_DIR` default fixes the 11 that were firing)
- [ ] Verify the 2 model-override tests pass (the `extractModelId` JSONL rewrite + shared volume path)
- [ ] Add `OPENCLAW_BILLING_DIR=/tmp/cogni-openclaw-billing` to `.env.local.example` for new dev onboarding
- [ ] Create PR against `staging`

## Risks / Gotchas

- The gateway proxy audit log grows unbounded (long-running container, no rotation) — not in scope, follow-up task needed
- Ephemeral sandbox billing path (`LlmProxyManager.stop()`) also uses dockerode — works in dev (host mode) but would break in containerized app — not active in production, separate fix
- Dev compose uses bind mount (`/tmp/cogni-openclaw-billing:/billing`) — directory must exist on host before proxy starts or nginx will fail to write
- The `extractModelId` helper in the test file uses `require("node:fs")` sync reads — acceptable for tests but review for lint compliance

## Pointers

| File / Resource                                       | Why it matters                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `src/adapters/server/sandbox/proxy-billing-reader.ts` | Core rewrite — tail-read JSONL, no dockerode                       |
| `src/bootstrap/graph-executor.factory.ts`             | Factory wiring — `OPENCLAW_BILLING_DIR` required                   |
| `src/shared/env/server.ts`                            | Env schema — default path for host mode                            |
| `infra/compose/nginx-gateway.conf.template`           | Nginx JSONL log format + `/billing/` path                          |
| `infra/compose/docker-compose.yml`                    | Prod: named volume `openclaw_billing`                              |
| `infra/compose/docker-compose.dev.yml`                | Dev: bind mount with `OPENCLAW_BILLING_HOST_DIR`                   |
| `tests/stack/sandbox/sandbox-openclaw.stack.test.ts`  | Stack tests — billing + model override assertions                  |
| `tests/setup.ts`                                      | Global test env setup                                              |
| `vitest.stack.config.mts`                             | Stack test config — where billing dir constant should live         |
| `docs/spec/unified-graph-launch.md`                   | Spec context — dual billing path is the deeper architectural issue |
