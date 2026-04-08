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
- [ ] One model/graph known to produce non-trivial output.
- [ ] `curl`, `jq`, and SSE-capable client (`curl -N` is enough).

## Actions (agent-first, not human UI)

1. Discover API surface:
   - `GET /.well-known/agent.json` and confirm `registrationUrl`, `runs`, `runStream`.
2. Register machine actor:
   - `POST /api/v1/agent/register` with `{ "name": "validator-agent" }`.
   - Persist returned `apiKey`, `userId`, `actorId`, `billingAccountId`.
3. Execute graph via existing API path (internal automation or API call path already used by your agent).
4. List runs as machine actor:
   - `GET /api/v1/agent/runs` with `Authorization: Bearer <apiKey>`.
   - Verify new run appears and `requestedBy == userId`.
5. Stream run events:
   - `GET /api/v1/agent/runs/{runId}/stream` with bearer key.
   - Verify SSE events flow and terminal event is received.
6. Reconnect proof:
   - repeat stream call with `Last-Event-ID`; verify replay resumes from cursor.

## Proof criteria

- Agent can complete **discover → register → auth → list runs → stream events** with no browser session.
- Graph execution produced usage events and standard run lifecycle states.
- Metering path recorded downstream (charge receipt / billing telemetry) for the run.

## Configs that matter most

- `AUTH_SECRET` (sign/verify machine keys)
- `REDIS_URL` (run stream replay plane)
- `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY` (usage + provider routing)
- Billing/settlement env from active lane (credit-ledger today, x402 in migration lanes)

## Known shortcomings for next iteration

1. **High**: no explicit revocation/introspection endpoint for issued machine keys.
2. **High**: no first-class “run submit” machine endpoint yet (registration + run read are shipped; run create path is still indirect).
3. Billing strategy transition is in-flight: threshold policy + x402/hyperion split needs a single canonical gate (see `proj.x402-e2e-migration`).
4. Eval automation not wired into this flow yet; add canary eval checks so agents can self-validate response quality (`proj.ai-evals-pipeline`).
