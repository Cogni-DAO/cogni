---
id: bug.0261
type: bug
title: "CogniNodeRouter has four production reliability gaps — silent failures, no retry, unstructured logs"
status: needs_triage
priority: 0
rank: 1
estimate: 2
summary: "LiteLLM billing callback router (cogni_callbacks.py) silently drops billing data on POST failure, runs unauthenticated if BILLING_INGEST_TOKEN unset, ignores LLM failures entirely, and emits plain-text logs invisible to Loki JSON pipeline."
outcome: "CogniNodeRouter logs failures as structured JSON, warns on missing token, retries once on transient POST failure, and logs LLM error callbacks for visibility."
spec_refs:
  - docs/spec/billing-ingest.md
  - docs/spec/observability.md
  - docs/spec/multi-node-tenancy.md
assignees: derekg1729
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
labels: [billing, observability, reliability, litellm]
external_refs:
---

# CogniNodeRouter Production Reliability Gaps

## Observed

`infra/litellm/cogni_callbacks.py` (`CogniNodeRouter`) has four gaps that make production billing incidents harder to detect and debug:

### 1. No `async_log_failure_event` — LLM failures invisible (`cogni_callbacks.py`, class level)

The class only implements `async_log_success_event` (line 84). LiteLLM's `CustomLogger` also provides `async_log_failure_event` for failed completions (timeouts, rate limits, provider errors). Without it, the callback layer has zero visibility into LLM failures. A spike in failures is indistinguishable from low traffic from the callback's perspective.

**Spec violated:** observability.md cardinal rule "Every operation has deterministic terminal outcome (success OR failure)".

### 2. `_get_billing_token()` returns `""` silently (line 63-64)

```python
def _get_billing_token() -> str:
    return os.environ.get("BILLING_INGEST_TOKEN", "")
```

If `BILLING_INGEST_TOKEN` is not set, every POST goes out without an `Authorization` header. The ingest endpoint requires Bearer auth (`CALLBACK_AUTHENTICATED` invariant). This means all billing callbacks are silently rejected with 401 — no receipts written, no startup warning.

**Spec violated:** billing-ingest.md `CALLBACK_AUTHENTICATED`.

### 3. No retry on POST failure — billing data silently lost (lines 135-148)

When `response.status_code != 200`, the callback logs an error but the billing payload is gone. A transient network hiccup or brief node restart causes permanent data loss. The reconciler (task.0039) is designed as a safety net but isn't built yet.

**Spec note:** billing-ingest.md `NO_SYNCHRONOUS_RECEIPT_BARRIER` means we can't block, but a single async retry with short backoff is safe.

### 4. Python `logging` emits plain text, not JSON (line 25)

```python
logger = logging.getLogger("cogni.callbacks")
```

All log output is plain text (e.g., `WARNING:cogni.callbacks:No node_id...`). Alloy's log pipeline expects JSON from Docker containers (`stage.json` in alloy-config). Plain text lands in Loki as unparsed raw strings — no field extraction, no structured queries, no `| json | event=...` filtering.

**Spec violated:** observability.md "All event names MUST be in EVENT_NAMES registry" (Python service has no registry) and JSON logging contract.

## Expected

1. `async_log_failure_event` logs `node_id`, `model`, `error_type`, `call_id` on LLM failures (no billing action, just visibility)
2. `_get_billing_token()` logs a warning at init if token is empty
3. POST failure triggers one retry with 2s backoff before logging error and dropping
4. All logging output is structured JSON matching the Loki pipeline expectations

## Reproduction

1. Start `dev:stack:test` with `BILLING_INGEST_TOKEN` unset → no warning at LiteLLM startup, all callbacks silently 401'd
2. Stop a node mid-test, trigger LLM call routed to that node → billing POST fails, `logger.error` fires but data is gone
3. Query Loki for `{service="litellm"} | json` → callback log lines have no parsed fields (plain text)
4. Trigger a rate-limited LLM call → no log output from callback layer at all

## Impact

- **Data loss:** Transient POST failures permanently lose billing receipts (no retry, no reconciler yet)
- **Silent misconfiguration:** Missing `BILLING_INGEST_TOKEN` causes 100% callback rejection with no startup warning
- **Blind spot:** LLM failures invisible to callback layer; degraded billing pipeline indistinguishable from low traffic
- **Debugging friction:** Plain-text logs can't be queried structurally in Loki

## Requirements

- [ ] Add `async_log_failure_event` with structured JSON logging (node_id, model, error_type, call_id)
- [ ] Warn at `__init__` if `BILLING_INGEST_TOKEN` is empty
- [ ] Add single retry with 2s backoff on POST failure before dropping
- [ ] Switch to JSON-formatted logging (e.g., `python-json-logger` or manual `json.dumps` formatter)

## Allowed Changes

- `infra/litellm/cogni_callbacks.py` — all four fixes
- `infra/litellm/requirements.txt` or `Dockerfile` — if adding `python-json-logger` dependency

## Plan

- [ ] Add JSON log formatter to `cogni_callbacks.py` (or add `python-json-logger` to LiteLLM Dockerfile)
- [ ] Add `logger.warning` in `__init__` when `self.billing_token` is empty
- [ ] Implement `async_log_failure_event` — log structured error info, no billing action
- [ ] Add retry logic: on non-2xx POST, wait 2s, retry once, then log error
- [ ] Verify with `dev:stack:test` — stop node, trigger LLM call, confirm retry + error log in JSON

## Validation

**Command:**

```bash
pnpm dev:stack:test
# In another terminal, verify LiteLLM logs are JSON:
docker logs cogni-litellm 2>&1 | head -20 | python3 -c "import sys,json; [json.loads(l) for l in sys.stdin]"
```

**Expected:** All LiteLLM callback logs parse as valid JSON. Missing token warning visible at startup if unset.

## Review Checklist

- [ ] **Work Item:** `bug.0261` linked in PR body
- [ ] **Spec:** `CALLBACK_AUTHENTICATED` upheld (token warning), observability cardinal rules upheld (failure events, JSON logs)
- [ ] **Tests:** verify retry behavior and JSON format in stack test environment
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Introduced in: task.0256 (per-node billing pipeline)
- First reviewed on: feat/task-0258-multi-node-stack-tests branch
- Related: task.0039 (billing reconciler — the async safety net that doesn't exist yet)

## Attribution

- Identified during task.0258 design review
