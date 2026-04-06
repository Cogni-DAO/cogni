# litellm · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** stable

## Purpose

Custom LiteLLM Docker image extending upstream with per-node billing callback routing. The `CogniNodeRouter` custom callback class inspects `node_id` from `spend_logs_metadata` and routes billing events to the correct node's `/api/internal/billing/ingest` endpoint.

## Pointers

- [Multi-Node Tenancy Spec](../../docs/spec/multi-node-tenancy.md): CALLBACK_IS_ADAPTER_GLUE, MISSING_NODE_ID_DEFAULTS_OPERATOR
- [Billing Ingest Spec](../../docs/spec/billing-ingest.md): Callback pipeline, ingest endpoint contract

## Boundaries

```json
{
  "layer": "infra",
  "may_import": [],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services",
    "packages"
  ]
}
```

**External deps:** `litellm` (upstream image), `httpx` (async HTTP).

## Public Surface

- `cogni_callbacks.CogniNodeRouter` — CustomLogger subclass for LiteLLM success callbacks
- `Dockerfile` — extends `ghcr.io/berriai/litellm` with the custom callback module

## Env Vars

- `COGNI_NODE_ENDPOINTS` (required) — comma-separated `node_id=endpoint_url` pairs
- `BILLING_INGEST_TOKEN` — Bearer token forwarded to node ingest endpoints

## Responsibilities

- This directory **does**: build a custom LiteLLM image, route billing callbacks to per-node ingest endpoints based on `node_id` metadata
- This directory **does not**: contain pricing logic, policy logic, reconciliation logic, or any business rules (CALLBACK_IS_ADAPTER_GLUE)

## Notes

- Missing `node_id` defaults to operator with a warning (MISSING_NODE_ID_DEFAULTS_OPERATOR)
- Dockerfile extends the same SHA-pinned upstream image used previously in docker-compose
- `COGNI_NODE_ENDPOINTS` is required — `CogniNodeRouter` raises `RuntimeError` at init if unset
