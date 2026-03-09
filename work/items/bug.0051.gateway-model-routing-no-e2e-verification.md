---
id: bug.0051
type: bug
title: Gateway model routing has no E2E verification — spend/logs can't correlate gateway calls
status: needs_triage
priority: 1
estimate: 2
summary: After removing the nginx audit log (task.0029 proxy billing kill), there is no working mechanism to verify that a model override requested via configureSession() actually reaches LiteLLM. The 3 model routing stack tests are skipped.
outcome: Model routing stack tests pass, verifying the full chain — GraphRunRequest.model → configureSession → OpenClaw → LiteLLM → recorded with correct model_id
spec_refs: billing-ingest, openclaw-sandbox-spec
assignees: unassigned
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [billing, openclaw, testing]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 7
---

# Gateway model routing has no E2E verification — spend/logs can't correlate gateway calls

## Observed

Three model routing tests in `sandbox-openclaw.stack.test.ts` fail (now skipped with `.todo()`):

1. **"session model override: test-free-model reaches LiteLLM"** (line ~354)
2. **"session model override: test-paid-model reaches LiteLLM"** (line ~391)
3. **"provider-level model selection: GraphRunRequest.model reaches LiteLLM"** (line ~427)

All return `model_id = "-"` instead of the expected LiteLLM deployment hash.

### Root cause: no correlation key between gateway calls and LiteLLM spend logs

The old verification path used the **nginx audit log** which captured both request headers (from OpenClaw) and response headers (from LiteLLM) in the same log line:

```nginx
# DELETED in task.0029 fix/kill-proxy-billing-path
log_format audit escape=json '{"ts":"$time_iso8601",'
  '"run_id":"$http_x_cogni_run_id",'                    # REQUEST header — correlation key
  '"litellm_model_id":"$upstream_http_x_litellm_model_id",' # RESPONSE header — model proof
  ...}';
```

The new `extractModelId()` queries LiteLLM `/spend/logs` API. Diagnostic curl against a live test stack revealed:

1. **`end_user` query param is ignored** — `/spend/logs?end_user=X` returns ALL entries regardless of X value (3688 entries for both `test-model-select` and `NONEXISTENT`). Only `request_id` works as a filter.

2. **Gateway model-override entries have no `spend_logs_metadata`** — Of 3692 total spend log entries:
   - 351 entries have `metadata.spend_logs_metadata` — ALL are `model_group=test-model` (ephemeral sandbox path, not gateway)
   - 16 entries have model overrides (test-free-model/test-paid-model) — **ZERO have `spend_logs_metadata`**
   - 0 entries match `end_user: "test-model-select"` — gateway entries show UUID billing account IDs instead

3. **Cannot correlate** — Without `spend_logs_metadata.run_id` in gateway spend log entries, there is no way to match a specific test's agent call to its LiteLLM spend log entry.

### Answered: OpenClaw DOES forward outbound headers (confirmed from source)

**Investigation (2026-02-13):** Read OpenClaw source (`v2026.2.4`). The forwarding chain is verified:

1. `sessions.patch` → `validateOutboundHeaders()` → stored in `SessionEntry.outboundHeaders` (`src/config/sessions/types.ts:51`)
2. `commands/agent.ts:457` retrieves `outboundHeaders` from session entry
3. Passed through: `runEmbeddedPiAgent()` → `runEmbeddedAttempt()` → `applyExtraParamsToAgent()`
4. `createHeadersWrapper()` (`src/agents/pi-embedded-runner/extra-params.ts:108-121`) wraps the Pi Agent `streamFn` to inject headers into **every** LLM API call: `{ ...sessionHeaders, ...options?.headers }`
5. OpenClaw does **NOT** set `user` or `end_user` in the request body — outbound headers are the only mechanism

**Merge priority** (extra-params.ts:136-140): provider config headers < session outboundHeaders < per-call options.headers

**Conclusion:** The headers leave OpenClaw correctly. The two remaining suspects:

- **Pi Agent SDK (`@mariozechner/pi-ai`) or underlying OpenAI SDK** may set `user: <uuid>` in the request body, which LiteLLM uses for `end_user` (overriding the `x-litellm-end-user-id` header). This explains the UUID end_users on gateway entries.
- **LiteLLM spend log storage** may not persist `x-litellm-spend-logs-metadata` for all call types — the header reaches LiteLLM but may only flow to the `generic_api` callback payload, not the PostgreSQL `LiteLLM_SpendLogs` table. This explains zero `spend_logs_metadata` on gateway entries despite 351 on ephemeral entries (which hit LiteLLM through a different code path).

## Expected

A working E2E test that verifies: model selected by user/GraphExecutor → `configureSession()` → OpenClaw → nginx proxy → LiteLLM → recorded with correct `model_id`/`model_group`.

## Reproduction

```bash
# Start test stack
pnpm dev:stack:test

# Run the (now-skipped) model routing tests
pnpm test:stack:dev -- tests/stack/sandbox/sandbox-openclaw.stack.test.ts

# Diagnostic: query LiteLLM spend/logs for gateway model override entries
curl -s 'http://localhost:4000/spend/logs' -H 'Authorization: Bearer test-key' | \
  python3 -c "import json,sys; d=json.load(sys.stdin); \
    ovr=[e for e in d if e.get('model_group') in ('test-free-model','test-paid-model')]; \
    slm=[e for e in ovr if 'spend_logs_metadata' in e.get('metadata',{})]; \
    print(f'Override entries: {len(ovr)}, with spend_logs_metadata: {len(slm)}')"
# Expected output: "Override entries: N, with spend_logs_metadata: 0"
```

## Impact

- **No test coverage** for the model routing chain (GraphRunRequest → OpenClaw → LiteLLM)
- Model routing regressions (e.g., OpenClaw ignoring model override, proxy stripping headers) would be **silent**
- The `generic_api` callback billing path assumes model info arrives correctly — if model forwarding breaks, billing receipts get the wrong model

## Requirements

- A working `extractModelId()` (or equivalent) that can verify which LiteLLM model deployment served a specific gateway agent call
- 3 model routing tests un-skipped and passing
- The verification approach must not depend on the nginx audit log (deleted per COST_AUTHORITY_IS_LITELLM)

## Allowed Changes

- `tests/stack/sandbox/sandbox-openclaw.stack.test.ts` — `extractModelId()` rewrite + test unskip
- `tests/_fixtures/sandbox/fixtures.ts` — shared helpers if needed
- OpenClaw source (`/Users/derek/dev/openclaw/`) — if outbound header forwarding needs a fix
- `platform/infra/services/sandbox-proxy/nginx-gateway.conf.template` — if proxy header pass-through needs explicit directives

## Plan

Investigation complete (see "Answered" section above). OpenClaw forwarding is confirmed. Remaining work:

- [x] ~~Investigate OpenClaw outbound header forwarding~~ — **Confirmed working** from source review
- [ ] Determine why Pi Agent SDK sets `user: <uuid>` in request body (overrides `x-litellm-end-user-id` header). Check if this is configurable or if OpenClaw needs to suppress it.
- [ ] Determine why `x-litellm-spend-logs-metadata` isn't stored in LiteLLM spend logs for gateway calls — is this a LiteLLM bug or an SDK-level issue where the header doesn't survive the Pi Agent → OpenAI SDK → HTTP request chain?
- [ ] Choose and implement a verification approach (see "Path Forward" below)
- [ ] Rewrite `extractModelId()` with a working approach
- [ ] Un-skip the 3 model routing tests
- [ ] Verify all 3 pass on test stack

### Path Forward — Verification Options (ranked)

**Option A: Minimal nginx debug log (recommended)**
Re-add a lightweight access log to the gateway proxy — NOT for billing, just model-routing observability:

```nginx
# Model routing observability (NOT billing — see COST_AUTHORITY_IS_LITELLM)
log_format model_debug escape=json
  '{"run_id":"$http_x_cogni_run_id",'
  '"model_id":"$upstream_http_x_litellm_model_id",'
  '"ts":"$time_iso8601"}';
access_log /tmp/model-debug.log model_debug;
```

Test reads `/tmp/model-debug.log` from the proxy container via `dockerode exec`, matches by `run_id`, checks `model_id`. This is the exact technique that worked before, stripped to observability only. The `$http_x_cogni_run_id` capture also re-confirms header forwarding end-to-end.

**Pros:** Proven reliable, tests the full chain, sub-second verification.
**Cons:** Re-introduces container file reads in tests (but NOT billing — the log is ephemeral in `/tmp`).
**Reference:** See git history of `platform/infra/services/sandbox-proxy/` — the previous billing audit log format, volume mount, and container read helper were removed in `fix/kill-proxy-billing-path`.

**Option B: LiteLLM request_id capture via OpenClaw**
If OpenClaw can be patched to return the `x-litellm-call-id` response header in the agent result metadata, the test can query `/spend/logs?request_id=<id>` (the only working filter). Requires an OpenClaw change to propagate LLM response headers through the Pi Agent → agent result → WS response chain.

**Pros:** No nginx changes, uses LiteLLM's own API.
**Cons:** Requires OpenClaw change; Pi Agent SDK may not expose response headers.

**Option C: Time-window heuristic**
Record timestamp before call, query `/spend/logs?start_date=...`, filter by `model_group` in test code. No infrastructure changes.

**Pros:** Zero config changes.
**Cons:** Fragile under parallel test execution; relies on LiteLLM `start_date` filter actually working; can't distinguish between test runs using the same model.

## Validation

**Command:**

```bash
pnpm test:stack:dev -- tests/stack/sandbox/sandbox-openclaw.stack.test.ts
```

**Expected:** All tests pass, including "session model override: test-free-model", "session model override: test-paid-model", and "provider-level model selection".

## Review Checklist

- [ ] **Work Item:** `bug.0051` linked in PR body
- [ ] **Spec:** COST_AUTHORITY_IS_LITELLM invariant upheld (no return of nginx audit log)
- [ ] **Tests:** 3 model routing tests un-skipped and green
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Caused by: `fix/kill-proxy-billing-path` branch (task.0029 proxy billing removal)
- Related: task.0010 (gateway model selection)
- Related: bug.0044 (gateway billing reader stale audit log — now deleted)
- OpenClaw source: `src/agents/pi-embedded-runner/extra-params.ts` (header injection), `src/gateway/sessions-patch.ts` (session storage)

## Attribution

-
