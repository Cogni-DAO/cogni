---
id: bug.0013
type: bug
title: "Sandbox stack tests flaky — proxy container vanishes during readiness check"
status: needs_triage
priority: 2
estimate: 2
summary: Ephemeral sandbox proxy container disappears mid-startup, causing "no such container" in LlmProxyManager.waitForProxyReady. Affects 3 stack tests.
outcome: Sandbox stack tests pass reliably without container race conditions
spec_refs:
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [sandbox, proxy, flaky-test, docker]
external_refs:
assignees: derekg1729
credit:
revision: 0
blocked_by:
deploy_verified: false
rank: 4
---

# Sandbox stack tests flaky — proxy container vanishes during readiness check

## Observed

3 sandbox stack tests fail intermittently with:

```
Error: Timeout waiting for proxy socket: /llm-sock/llm.sock
  (last: (HTTP code 404) no such container - No such container: a313944b...)
```

The proxy container (nginx:alpine) is created but disappears before `waitForProxyReady()` completes its health polling loop. The container ID exists briefly then returns 404.

## Failing Tests (skipped pending fix)

1. `tests/stack/sandbox/sandbox-llm-completion.stack.test.ts`
   - "socket bridge connects sandbox to proxy health endpoint" (line 88)
   - "socket bridge forwards to LiteLLM (connection test)" (line 101)

2. `tests/stack/sandbox/sandbox-llm-roundtrip-billing.stack.test.ts`
   - "proxy audit log captures billing data and commits to charge_receipts" (line 95)

## Root Cause (suspected)

Container lifecycle race in `LlmProxyManager.start()` → `waitForProxyReady()`. The proxy container either:

- Crashes on startup (nginx config issue, port conflict) and Docker auto-removes it
- Gets cleaned up by a concurrent `cleanupOrphanedProxies()` from a parallel test
- Exits due to OOM or resource constraints under test load

The error `(HTTP code 404) no such container` at `llm-proxy-manager.ts:676` means `docker exec` or `docker inspect` finds the container gone.

## Investigation Needed

- [ ] Check if proxy container has `--rm` or `AutoRemove: true` — would explain instant removal on crash
- [ ] Check nginx startup logs at point of failure — does the config template have a syntax error?
- [ ] Check if `cleanupOrphanedProxies()` in parallel test `beforeAll` removes another test's proxy
- [ ] Check if 4s `testTimeout` is too tight for proxy startup under load

## Validation

- All 3 skipped tests unskipped and passing reliably (run 5x in a row with no failures)

## PR / Links

- Proxy code: `src/adapters/server/sandbox/llm-proxy-manager.ts:676`
- Runner: `src/adapters/server/sandbox/sandbox-runner.adapter.ts:130`
- Project: [proj.openclaw-capabilities](../projects/proj.openclaw-capabilities.md)
