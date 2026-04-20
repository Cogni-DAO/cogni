---
id: task.0345
type: task
title: "Canary — Gate A + Gate B hard validation criteria"
status: needs_design
priority: 1
estimate: 5
rank: 2
summary: "Define + execute two end-to-end proofs that the canary node is real: (A) an external agent lifts a PR through to candidate-a flight via public API only, (B) a new agent registers against live preview, self-funds its wallet with real USDC, and runs a paid Kimi K2 completion that hits the billing ledger."
outcome: "Both gates documented with precise exercise: + observability: contracts. Gate A runbook is followable by any agent (including canary-bot itself). Gate B runbook is followable by the next human / paid-agent session without context handoff."
spec_refs:
  - canary
  - external-agent-onboarding
  - agent-api-validation
assignees: derekg1729
project: proj.cogni-canary
created: 2026-04-20
updated: 2026-04-20
labels: [canary, validation, gate, proof, external-agent]
external_refs:
  - docs/runbooks/GATE_A_EXTERNAL_PR_FLIGHT.md
  - docs/runbooks/GATE_B_PAID_AGENT_VALIDATION.md
  - docs/guides/external-agent-onboarding.md
  - docs/guides/agent-api-validation.md
---

# Canary — Gate A + Gate B hard validation

## Context

Shipping a node without proving that (a) an external agent can actually use the PR lifecycle and (b) a paid agent-to-model path actually charges real money is how we end up with a canary that looks live but has never had a real actor interact with it. These two gates are the minimum-credible proof that the canary is real.

## Gate A — external-agent PR lifecycle

**Claim:** An agent with no GitHub repo-write access can fork, branch, PR, flight, and merge via Cogni public APIs only.

**Blockers before this can run:**

1. [ ] task.0344 merged (`POST /api/v1/vcs/flight-candidate` shipped) OR `task.0297` branch merged (so `core__vcs_flight_candidate` tool is callable via pr-manager graph)
2. [ ] canary node is reachable at `canary-candidate-a.cognidao.org/readyz` → 200 (needs task.0338 part 2 + real image)
3. [ ] gitcogni supports `ai-only-repo-policy` scope fence + auto-merge (task.0342)
4. [ ] `canary-bot[bot]` GitHub App identity exists and has the scoped token (task.0342)

**Runbook:** `docs/runbooks/GATE_A_EXTERNAL_PR_FLIGHT.md`

**Exercise:**

```bash
# From any machine; agent has NO repo-write access beyond its own fork.
BASE=https://canary-candidate-a.cognidao.org

# 1. Discover
curl -sS $BASE/.well-known/agent.json | jq .

# 2. Register (returns apiKey)
CREDS=$(curl -sS -X POST $BASE/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"gate-a-validator"}')
API_KEY=$(echo $CREDS | jq -r .apiKey)

# 3. Fork + branch + commit + push (GitHub REST, agent's own GH App token)
# 4. Open PR targeting Cogni-DAO/cogni-template:main
# 5. Request candidate-a flight
curl -sS -X POST $BASE/api/v1/vcs/flight-candidate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pr_number": <PR>, "head_sha": "<sha>"}' | jq .

# 6. Poll status until Healthy + verify-buildsha pass
# 7. Expect ai-only-repo-policy to auto-merge once all gates green
```

**Observability:**

- `{app="operator", route="/api/v1/vcs/flight-candidate"}` shows exactly 1 dispatch for the PR
- `{github_workflow="candidate-flight.yml"}` shows the triggered run
- `{app="canary", namespace="cogni-candidate-a"}` shows `/readyz.version` matching PR head SHA post-rollout
- GitHub event stream: PR state `open → closed (merged)` with `merged_by: canary-bot[bot]` (or your agent's identity)

**Success criteria:**

- [ ] No human clicks at any step between `fork` and `merged`
- [ ] Total elapsed time: < 20 min end-to-end
- [ ] `verify-buildsha` green on candidate-a before merge
- [ ] gitcogni audit log shows `auto_merged: true` with policy reason

## Gate B — paid agent-to-model flow

**Claim:** A brand-new agent (never seen before) can register against live preview, receive a wallet, have that wallet funded with USDC on Base, make a paid completion call routed through Kimi K2 (not a free model), and see the charge reflected in the billing ledger.

**Blockers before this can run:**

1. [ ] canary (or preview operator) reachable with `/api/v1/agent/register` returning a wallet address
2. [ ] x402 / USDC payment rail active (`payments.status: active` in repo-spec)
3. [ ] Kimi K2 routed through LiteLLM config (`infra/compose/runtime/configs/litellm.config.yaml` must have `moonshot/kimi-k2-*` models)
4. [ ] Someone funds the returned wallet with real USDC (see "Who funds" below)

**Runbook:** `docs/runbooks/GATE_B_PAID_AGENT_VALIDATION.md`

**Exercise:**

```bash
BASE=https://canary-candidate-a.cognidao.org    # or preview
MODEL=moonshot/kimi-k2-0905    # paid model — NOT gpt-4o-mini (that's free)

# 1. Register (first-time agent)
CREDS=$(curl -sS -X POST $BASE/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"gate-b-validator"}')
WALLET=$(echo $CREDS | jq -r .walletAddress)      # or billingAccountAddress
API_KEY=$(echo $CREDS | jq -r .apiKey)

# 2. Fund the wallet (EXTERNAL STEP — see "Who funds")
#    Send ≥ $1 USDC on Base to $WALLET

# 3. Wait for USDC deposit to land in the billing account (≤ 60s)
# 4. Fire a paid completion
curl -sS -X POST $BASE/api/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\":\"$MODEL\",
    \"graph_name\":\"poet\",
    \"messages\":[{\"role\":\"user\",\"content\":\"Write one haiku about validation.\"}]
  }" | jq .

# 5. Verify charge hit the ledger
curl -sS $BASE/api/v1/agent/billing/receipts \
  -H "Authorization: Bearer $API_KEY" | jq .
```

**Observability:**

- Loki: `{app="operator", route="/api/v1/agent/register"}` shows the register event with the returned wallet address
- On-chain: Basescan shows the USDC transfer to the wallet
- Loki: `{app="operator", route="/api/v1/chat/completions"}` shows the completion with `model=moonshot/kimi-k2-0905` and `cost_usd > 0`
- DB: `charge_receipts` table has a row for this agent's `billingAccountId` within 60s

**Success criteria:**

- [ ] Register returned a NEW, never-seen wallet address
- [ ] USDC arrived on-chain (Basescan transaction confirmed)
- [ ] Completion returned a real Kimi K2 response (not 402 / not 429 / not stubbed)
- [ ] `cost_usd` in the receipt is > 0 AND matches OpenRouter's published rate × token count ±5%
- [ ] Agent's balance decremented by the receipt amount

### Who funds the Gate B wallet?

Two paths:

- **Option 1 (bootstrapping — Derek):** Derek sends $1–5 USDC on Base to the Gate B agent's wallet. One-time cost, proves the rail.
- **Option 2 (self-funding — future):** Once canary itself has revenue (CP5), `canary-bot` can use its own operator-wallet funds to seed the Gate B agent. Not v0.

For v0, **Option 1 is the unblocker**. Derek sends the USDC when the Gate B agent registers and reports its wallet address. All other steps are agent-executable.

## Gate ordering

Gate B can run first — it only needs preview + payments active, not any canary-specific infra. Gate A needs the canary node flightable AND the `flight-candidate` API route shipped, so it lands after task.0344 + task.0338 part 2.

```
Gate B ready after: task.0339 (DAO + payments active) + LiteLLM Kimi model config
Gate A ready after: Gate B + task.0344 + task.0338 part 2 + task.0342
```

## Non-goals

- Proving prod promotion (deliberately human-gated in v0)
- Proving multi-agent concurrency (single agent proves the rail; concurrent load is a separate proj)
- Covering graph catalog discovery for machine agents — tracked separately under `agent-api-validation` § known shortcomings

## Related

- [External Agent Onboarding](../../docs/guides/external-agent-onboarding.md)
- [Agent-API Validation](../../docs/guides/agent-api-validation.md)
- [task.0242](task.0242.vcs-tool-plane-pr-manager.md) — VCS tool plane
- [task.0344](task.0344.public-flight-request-surface.md) — public flight API
