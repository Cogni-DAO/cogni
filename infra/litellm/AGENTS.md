# litellm · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** active

## Purpose

Custom LiteLLM Docker image extending upstream with per-node billing callback routing. The `CogniNodeRouter` custom callback class inspects `node_id` from `spend_logs_metadata` and routes billing events to the correct node's `/api/internal/billing/ingest` endpoint.

## Boundaries

```json
{
  "layer": "infra",
  "may_import": [],
  "must_not_import": ["app", "features", "ports", "core", "adapters", "shared", "services", "packages"]
}
```

**External deps:** `litellm` (upstream image), `httpx` (async HTTP).

## Public Surface

- `cogni_callbacks.CogniNodeRouter` — CustomLogger subclass for LiteLLM success callbacks
- `Dockerfile` — extends `ghcr.io/berriai/litellm` with the custom callback module

## Env Vars

- `COGNI_NODE_ENDPOINTS` (required) — comma-separated `node_id=endpoint_url` pairs
- `BILLING_INGEST_TOKEN` — Bearer token forwarded to node ingest endpoints

## Invariants

- CALLBACK_IS_ADAPTER_GLUE: no pricing logic, no policy logic, no reconciliation
- MISSING_NODE_ID_DEFAULTS_OPERATOR: missing node_id → operator endpoint + warning log
- CALLBACK_AUTHENTICATED: forwards Bearer token as-is
- NODE_LOCAL_METERING_PRIMARY: routes to node-local endpoint, never centralizes writes
