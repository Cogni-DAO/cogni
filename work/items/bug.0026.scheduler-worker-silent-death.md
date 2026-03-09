---
id: bug.0026
type: bug
title: Scheduler worker silently stops polling — schedules enabled but runs cease
status: needs_triage
priority: 0
estimate: 2
summary: Production scheduler-worker health check uses /livez (always 200) instead of /readyz, and worker.run() rejection doesn't exit the process or update health state. The container appears healthy forever even after the Temporal worker stops polling, so schedules stay "enabled" but no runs execute.
outcome: Scheduler worker self-terminates on polling failure; health check detects dead workers; autoheal restarts them automatically.
spec_refs:
  - scheduler
  - temporal-patterns
assignees: []
credit:
project: proj.reliability
branch:
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [temporal, scheduling, reliability, silent-failure]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 13
---

# Scheduler worker silently stops polling — schedules enabled but runs cease

## Requirements

### Observed

Temporal schedules show as "enabled" with a valid next run time, but runs stop executing after hours or days of initially consistent behavior. The Temporal UI shows the schedule is active and not paused, but no workflow executions are being triggered. Docker reports the `scheduler-worker` container as healthy throughout.

Three compounding root causes:

**1. Production health check uses `/livez` instead of `/readyz`**

`platform/infra/services/runtime/docker-compose.yml:363`:

```yaml
test: ["CMD-SHELL", "wget -qO- http://localhost:9000/livez || exit 1"]
```

`/livez` **always returns 200** (`services/scheduler-worker/src/health.ts:33-35`):

```typescript
if (req.url === "/livez") {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
}
```

Compare with dev compose (`docker-compose.dev.yml:461-464`) which correctly uses `/readyz`:

```yaml
test:
  [
    "CMD-SHELL",
    'node -e "require(''http'').get(''http://localhost:9000/readyz'',...)',
  ]
```

**2. `worker.run()` rejection doesn't exit the process or update health state**

`services/scheduler-worker/src/worker.ts:126-131`:

```typescript
const runPromise = worker.run();
runPromise.catch((err) => {
  logger.error({ err }, "Worker run failed");
});
```

If the Temporal worker disconnects or stops polling, `worker.run()` rejects. The `.catch()` logs the error but:

- Does **not** call `process.exit(1)`
- Does **not** set `healthState.ready = false`
- The process stays alive (the health HTTP server keeps the event loop running)
- `/readyz` would still return 200 (since `healthState.ready` was set to `true` in `main.ts:51` and never cleared)

So even fixing the health check endpoint alone is insufficient — the health state itself is never updated on worker failure.

**3. No `autoheal` label on `scheduler-worker` in production**

`docker-compose.yml:333-367` — the `scheduler-worker` service has no `labels: ["autoheal=true"]`. The `app` service (line 20) does. Even if the health check were fixed, autoheal would not restart a failed scheduler-worker.

### Expected

- When the Temporal worker stops polling (connection lost, `worker.run()` rejects), the process should either exit or mark itself not-ready
- The production health check should detect this state (use `/readyz`, not `/livez`)
- Autoheal should restart the container when it becomes unhealthy
- Missed runs should at minimum be logged/alerted (with `catchupWindow: "0s"`, they are permanently lost by design)

### Reproduction

1. Deploy the stack and create a schedule (e.g., every 5 minutes)
2. Observe initial runs execute correctly
3. Simulate worker disconnection: `docker exec temporal iptables -A OUTPUT -p tcp --dport 7233 -j DROP` (or just wait — the failure happens naturally over time)
4. Observe: Docker reports `scheduler-worker` as healthy, but no new workflow executions appear in Temporal UI
5. The schedule shows "enabled" with a next run time, but the timer fires into the void

### Impact

**P0 — Silent data loss.** All scheduled graph executions stop without any alert or visible failure signal. Users see schedules as "enabled" but no runs happen. Combined with `catchupWindow: "0s"`, all missed runs are permanently lost. This defeats the core purpose of the scheduling feature.

## Allowed Changes

- `services/scheduler-worker/src/worker.ts` — propagate `worker.run()` failure to health state and/or process exit
- `services/scheduler-worker/src/main.ts` — wire health state to worker lifecycle
- `platform/infra/services/runtime/docker-compose.yml` — fix health check endpoint, add autoheal label, add mem_limit
- `platform/infra/services/runtime/docker-compose.dev.yml` — add autoheal label if missing
- `services/scheduler-worker/src/health.ts` — (optional) if health state logic needs changes

## Plan

- [ ] Fix `worker.run()` failure propagation in `worker.ts` — return health state handle so `main.ts` can wire `runPromise.catch` to set `healthState.ready = false` and `process.exit(1)`
- [ ] Fix production health check in `docker-compose.yml` — change `/livez` to `/readyz`
- [ ] Add `autoheal=true` label to `scheduler-worker` in `docker-compose.yml`
- [ ] Add `mem_limit` to `scheduler-worker` and `temporal` in `docker-compose.yml`
- [ ] Verify dev compose already uses `/readyz` (it does — no change needed)
- [ ] Consider adding autoheal label to `temporal` and `temporal-postgres` services

## Validation

**Command:**

```bash
# 1. Verify health check endpoint is /readyz in production compose
grep -A5 'healthcheck' platform/infra/services/runtime/docker-compose.yml | grep readyz

# 2. Verify autoheal label present
grep -A2 'scheduler-worker' platform/infra/services/runtime/docker-compose.yml | grep autoheal

# 3. Unit: simulate worker.run() rejection, verify process exits or health goes false
# (manual verification — no existing test harness for this)
```

**Expected:** Health check uses `/readyz`, autoheal label present, worker failure propagates to health state.

## Review Checklist

- [ ] **Work Item:** `bug.0026` linked in PR body
- [ ] **Spec:** scheduler.md and temporal-patterns.md invariants upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
