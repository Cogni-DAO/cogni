---
id: agent-api-validation-guide
type: guide
title: Agent-First API Validation (Canary + Local)
status: draft
trust: draft
summary: Explicit validation checklist for proving machine-agent registration, auth, run list/stream access, and metered graph execution behavior.
read_when: Validating the new machine-agent API surface locally or against canary.
owner: derekg1729
created: 2026-04-08
verified: 2026-04-08
tags: [agent-api, validation, canary, billing]
---

# Agent-First API Validation (Canary + Local)

## Prereqs

- [ ] Running target: `pnpm dev:stack` (local) **or** live canary URL.
- [ ] Funded wallet + funded billing account for the node under test.
- [ ] `curl`, `jq`, and SSE-capable client (`curl -N` is enough).

## Quickstart — free poem in 3 calls

```bash
BASE=http://localhost:3000

# 1. Discover
curl $BASE/.well-known/agent.json | jq .

# 2. Register (no wallet required)
CREDS=$(curl -s -X POST $BASE/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}')
API_KEY=$(echo $CREDS | jq -r .apiKey)

# 3. Request poem (graph_name is required — routes through platform key)
curl -s -X POST $BASE/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"model":"gpt-4o-mini","graph_name":"poet","messages":[{"role":"user","content":"Write a haiku about APIs."}]}'
```

> **Why `graph_name`?** Without it, completions tries a direct LiteLLM call using a per-user
> virtual key that doesn't exist for newly registered agents. Routing via a named graph uses
> the platform key instead. This is a known gap — see shortcomings below.

## Available graphs (vNext registry)

Graphs are currently discoverable only via session auth (`GET /api/v1/ai/agents`). Machine agents
cannot list graphs via Bearer token yet. Known graphs in the default catalog:

```
langgraph:poet        — poem generation (free, good demo target)
langgraph:brain       — general reasoning + tools
langgraph:research    — web research
langgraph:ponderer    — long-form thinking
langgraph:pr-review   — code review
langgraph:browser     — browser automation
```

Pass the short name (without `langgraph:` prefix) as `graph_name` in completions requests.

## Full validation flow (agent-first, no browser)

1. **Discover API surface:**
   - `GET /.well-known/agent.json` — confirms `registrationUrl`, `runs`, `runStream`, `completions`.

2. **Register machine actor:**
   - `POST /api/v1/agent/register` with `{ "name": "validator-agent" }`.
   - Persist returned `apiKey`, `userId`, `actorId`, `billingAccountId`.

3. **Execute graph:**
   - `POST /api/v1/chat/completions` with `graph_name` + `Authorization: Bearer <apiKey>`.
   - Use `"model": "gpt-4o-mini"` (free, no wallet needed for local dev).

4. **List runs as machine actor:**
   - `GET /api/v1/agent/runs` with `Authorization: Bearer <apiKey>`.
   - Verify new run appears and `requestedBy == userId`.

5. **Stream run events:**
   - `GET /api/v1/agent/runs/{runId}/stream` with bearer key.
   - Verify SSE events flow and terminal event is received.

6. **Reconnect proof:**
   - Repeat stream call with `Last-Event-ID`; verify replay resumes from cursor.

## Proof criteria

- Agent completes **discover → register → auth → execute → list runs → stream events** with no browser session.
- Graph execution produced a successful run (`status: "success"`).
- Metering path recorded downstream (charge receipt / billing telemetry) for the run.

## Configs that matter most

- `AUTH_SECRET` (sign/verify machine keys)
- `REDIS_URL` (run stream replay plane)
- `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY` (usage + provider routing)
- Billing/settlement env from active lane (credit-ledger today, x402 in migration lanes)

## Known shortcomings for next iteration

1. **High**: `graph_name` required on completions for new agents — without it, calls fail with
   "model not found" because no LiteLLM virtual key exists for a freshly registered account.
   Fix: provision a platform virtual key at registration time, or route all completions through
   the graph executor by default.
2. **High**: no machine-accessible graph/agent listing endpoint (`GET /api/v1/ai/agents`
   uses session auth only). Agents cannot self-discover available graphs.
3. **High**: `POST /api/v1/ai/chat` (the primary human chat path) still uses `getSessionUser` —
   Bearer tokens rejected. Agents must use `chat/completions` instead.
4. **High**: no explicit revocation/introspection endpoint for issued machine keys.
5. **Medium**: no first-class "run submit" machine endpoint yet (registration + run read are
   shipped; run create is indirect via chat/completions).
6. Billing strategy transition is in-flight: threshold policy + x402/hyperion split needs a
   single canonical gate (see `proj.x402-e2e-migration`).
7. Eval automation not wired into this flow yet; add canary eval checks so agents can
   self-validate response quality (`proj.ai-evals-pipeline`).
