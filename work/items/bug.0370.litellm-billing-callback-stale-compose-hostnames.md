---
id: bug.0370
type: bug
title: "LiteLLM billing callback DNS-fails since k3s migration — every prod LLM call drops on the floor"
status: needs_review
revision: 1
priority: 1
rank: 1
estimate: 1
created: 2026-04-24
updated: 2026-04-24
project: proj.cicd-services-gitops
assignees: []
summary: "infra/compose/runtime/docker-compose.yml hardcodes COGNI_NODE_ENDPOINTS to Compose-bridge hostnames (operator=http://app:3000, poly=http://poly:3100, resy=http://resy:3300). After bug.0295 moved node apps into k3s, those hostnames no longer resolve from the LiteLLM container on Compose. cogni_callbacks.async_log_success_event raises httpx.ConnectError ([Errno -2] Name or service not known) on every successful LLM call, so /api/internal/billing/ingest is never hit, charge_receipts never written, dashboard shows $0.000000 spend, no credits deducted."
outcome: "Every successful LLM call in production/preview/candidate-a writes a charge_receipt within seconds. Activity dashboard shows non-zero spend for the requesting user's own kimi-k2.5 call. Loki shows cogni.callbacks INFO 'Billing callback routed' for every call (no httpx.ConnectError tracebacks)."
---

# Bug: LiteLLM billing callback DNS-fails since k3s migration

## Symptoms

- Activity dashboard ("Last Day", By Model) → Spend: **$0.000000**, despite confirmed kimi-k2.5 chat usage via langgraph pr-manager.
- Zero credit deductions on the user's billing account.
- Tokens chart shows stale "GPT-5.4" data only — the kimi-k2.5 calls do not appear at all.

## Root cause

`infra/compose/runtime/docker-compose.yml:513` sets:

```yaml
- COGNI_NODE_ENDPOINTS=operator=http://app:3000,poly=http://poly:3100,resy=http://resy:3300,4ff8eac1-...=http://app:3000,5ed2d64f-...=http://poly:3100,f6d2a17d-...=http://resy:3300
```

These are Compose-bridge hostnames (`app`, `poly`, `resy`). They resolve in dev (where node apps run as Compose services) but **not** in production / preview / candidate-a — those envs run node apps in k3s, with no `app` / `poly` / `resy` containers on the Compose network.

The LiteLLM `CogniNodeRouter.async_log_success_event` callback (`infra/images/litellm/cogni_callbacks.py:136`) POSTs the standard logging payload to `<endpoint>/api/internal/billing/ingest`. DNS lookup fails:

```
File "/app/cogni_callbacks.py", line 136, in async_log_success_event
  response = await self._client.post(ingest_url, ...)
httpx.ConnectError: [Errno -2] Name or service not known
```

The exception is caught by the `try/except` at line 157 and only logged. From the user's perspective, the LLM call returns successfully; from the billing pipeline's perspective, nothing happens.

`UsageCommitDecorator` (`packages/graph-execution-host/src/decorators/usage-commit.decorator.ts:76`) deliberately defers `source: "litellm"` usage facts to the LiteLLM callback (`CALLBACK_WRITES_PLATFORM_RECEIPTS`), so there is no fallback writer. Receipts are simply lost.

## Why now

bug.0295 (#957 candidate-a, #958 preview, #959 production) migrated **k3s pods → infra** discovery to `<env>.vm.cognidao.org` ExternalName Services. The reverse direction — **LiteLLM (compose) → node apps (k3s)** — was never updated. The hardcoded Compose hostnames in `docker-compose.yml` shipped a default that was correct for dev only.

The NodePort scaffolding is already in place: `infra/k8s/base/node-app/service.yaml` ships `type: NodePort`, and overlays pin canonical ports per node (operator=30000, poly=30100, resy=30300).

## Fix (hotfix scope only)

Re-point `COGNI_NODE_ENDPOINTS` for production / preview / candidate-a at the per-env DNS introduced by bug.0295, on each node's canonical NodePort:

```
operator=http://<env>.vm.cognidao.org:30000,
poly=http://<env>.vm.cognidao.org:30100,
resy=http://<env>.vm.cognidao.org:30300,
<uuid>=...
```

Where `<env>` ∈ { `candidate-a`, `preview`, `production` }. Same DNS host used by k3s pods to reach Compose infra (bug.0295) — the round-trip out-and-back through the public IP + docker-proxy is established, proven, and bidirectional.

### Out of scope (followups)

- Generator script + canonical NodePort table (consolidate the three duplications across overlays + scheduler-worker configmap).
- LiteLLM boot-time DNS self-check (would have caught this in seconds rather than days).
- `DNS_IS_THE_DISCOVERY_LAYER` invariant in `docs/spec/ci-cd.md` (bidirectional).
- Move LiteLLM into k3s (orthogonal v2 direction).

These are tracked in a follow-up task.

## Validation

exercise: After deploy, run a kimi-k2.5 chat completion against `https://cognidao.org/api/v1/ai/chat` (production). Within ~5s, query `charge_receipts` for the user's billing account; expect a new row with non-null `response_cost_usd`. The Activity dashboard should show non-zero spend for the current hour.

observability: Loki query at deployed SHA — `{env="production", service="litellm", stream="stderr"}` should be **empty** of `cogni_callbacks.py:136` tracebacks. `{env="production", pod=~"operator-node-app-.*"} | json | event="ai.billing.commit_complete"` should fire once per LLM call. Same for preview and candidate-a using their respective DNS prefixes.

## Impact

P1. Every production LLM dollar spent since bug.0295 deployed (#959, 2026-04-23) has gone unbilled. No revenue accrual, no usage attribution, no per-user spend visibility.
