---
id: bug.0044
type: bug
title: "Gateway billing reader finds 0 entries in stale audit log — kills execution after graph switch"
status: needs_triage
priority: 1
estimate: 2
summary: "ProxyBillingReader tail-reads the shared append-only audit.jsonl, finds 14k+ lines from previous runs but 0 matching the current runId. Execution killed with 'Billing failed: no proxy billing entries from gateway'. Triggered when switching graphName from a langgraph agent to sandbox:openclaw within the same chat session (same stateKey)."
outcome: "Gateway billing reader reliably finds billing entries for the current run, even when the audit log contains thousands of entries from prior runs."
spec_refs:
assignees:
  - cogni-dev
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [openclaw, billing, gateway]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 5
---

# Gateway billing reader finds 0 entries in stale audit log

## Observed

When a user starts a chat with a langgraph agent (e.g. `langgraph:poet`), then switches to `sandbox:openclaw` within the **same chat session** (same `stateKey`), the OpenClaw gateway execution completes but billing fails:

```
ProxyBillingReader: lineCount=14014, billingEntryCount=0
CRITICAL: No billing entries from gateway proxy audit log
Billing failed: no proxy billing entries from gateway
```

The gateway proxy writes to a **shared append-only** file (`/tmp/cogni-openclaw-billing/audit.jsonl` in dev, `/openclaw-billing/audit.jsonl` in Docker). This file accumulates entries from all runs indefinitely. `ProxyBillingReader.readOnce()` tail-reads the last 2MB and filters by `run_id`:

- `src/adapters/server/sandbox/proxy-billing-reader.ts:149` — `if (parsed.run_id !== runId) continue;`

14,014 lines exist from prior runs but none match the fresh `runId` for the current request. The billing reader retries 4 times with backoff, then fails. The `SandboxGraphProvider` treats 0 billing entries as a fatal error:

- `src/adapters/server/sandbox/sandbox-graph.provider.ts:553-561` — throws `"Billing failed: no proxy billing entries from gateway"`

The stream receives no `text_delta` or `assistant_final` events before the error kills execution. The `done` event arrives **after** termination (protocol violation logged as "Ignoring event after termination"). Thread persistence skips because there's no content.

## Expected

Gateway billing reader should find the billing entry for the current run regardless of audit log size or prior graph provider usage. The agent's response should stream to the client normally.

## Reproduction

1. Start `pnpm dev:stack`
2. Open chat UI, select a langgraph agent (e.g. `langgraph:poet`)
3. Send a message, get a response (establishes stateKey)
4. Switch to `sandbox:openclaw` agent (same chat session, same stateKey)
5. Send a message — response never arrives, error in server logs

## Likely Root Causes

1. **Timing race**: The gateway proxy nginx hasn't flushed the audit log entry by the time `ProxyBillingReader` starts reading. The 4-retry backoff may not be long enough for slow LLM calls (~73s observed in logs).

2. **Stale log accumulation**: The audit log is never truncated. With 14k+ lines (2.6MB), the tail-read window (2MB cap in `readOnce`) may miss the newest entry if it falls outside the window after a burst of prior runs.

3. **Run ID propagation**: The gateway proxy captures `run_id` from `$http_x_cogni_run_id` header. If this header isn't set on the outbound LiteLLM request from the OpenClaw agent container, the audit entry has an empty/wrong `run_id` and never matches.

## Impact

- **Who**: Any user switching between graph providers mid-session
- **Severity**: Execution fails silently (200 response, no content). No data loss (thread persist skipped). Credits not charged (billing entry not found).
- **Workaround**: Start a new chat session (new stateKey) when switching agents.

## Allowed Changes

- `src/adapters/server/sandbox/proxy-billing-reader.ts` — improve matching, add log rotation/truncation, widen tail-read window
- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — improve error handling, consider graceful degradation
- `platform/infra/services/sandbox-proxy/nginx-gateway.conf.template` — verify `x-cogni-run-id` header propagation
- `tests/stack/ai/sandbox-*` — reproduction test

## Plan

- [ ] Confirm `x-cogni-run-id` header is set on outbound requests from gateway container to LiteLLM proxy
- [ ] Add audit log rotation (truncate entries older than N hours, or rotate per-day)
- [ ] Consider per-run log filtering that doesn't depend on 2MB tail window
- [ ] Add integration test: switch graph providers mid-session, verify billing resolves

## Validation

**Command:**

```bash
pnpm test:stack:dev  # with dev stack running, test multi-graph session
```

**Expected:** Switching from langgraph to sandbox:openclaw within the same stateKey produces a streamed response with valid billing entries.

## Review Checklist

- [ ] **Work Item:** `bug.0044` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: bug.0027 (gateway billing Docker socket ENOENT — different failure mode, same billing reader)

## Attribution

-
