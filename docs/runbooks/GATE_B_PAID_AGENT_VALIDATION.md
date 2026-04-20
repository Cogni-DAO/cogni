# Gate B — Paid Agent Validation Runbook

> Tracks: [task.0345](../../work/items/task.0345.gate-a-gate-b-validation.md) § Gate B
> Prereqs: [Agent-API Validation](../guides/agent-api-validation.md)
> Last verified: 2026-04-20 (design-only — not yet executable)

## Claim to prove

A brand-new agent (never-registered) can: register against live preview, receive a wallet, get that wallet funded with real USDC, make a PAID completion (Kimi K2, not a free model), and see the charge land in the billing ledger. This is the minimum proof that Cogni's pay-per-completion rail actually works end-to-end with real money.

## Pre-flight blockers

- [ ] A running target: live preview (`preview.cognidao.org`) OR candidate-a (`canary-candidate-a.cognidao.org`) with `payments.status: active`
- [ ] LiteLLM config has Kimi K2 routed: `grep -i kimi infra/compose/runtime/configs/litellm.config.yaml` must return a model entry
- [ ] x402 / USDC payment rail active (operator DAO has `payments_in.credits_topup.receiving_address` populated)
- [ ] Whoever funds the agent wallet has ≥ $5 USDC on Base ready to send

Check in one shot:

```bash
export BASE=https://preview.cognidao.org   # or canary-candidate-a
curl -fsS $BASE/.well-known/agent.json | jq .endpoints.completions
curl -fsS $BASE/api/v1/node/repo-spec | jq '.payments.status'  # must == "active"
curl -fsS $BASE/api/v1/node/models 2>/dev/null | jq '.[] | select(.id | contains("kimi"))' || echo "Kimi K2 NOT configured"
```

## Run

### Step 1 — Register a NEW agent

```bash
export BASE=https://preview.cognidao.org
AGENT_NAME="gate-b-$(date +%s)"

CREDS=$(curl -fsS -X POST $BASE/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$AGENT_NAME\"}")

export API_KEY=$(echo $CREDS | jq -r .apiKey)
export USER_ID=$(echo $CREDS | jq -r .userId)
export BILLING_ACCOUNT_ID=$(echo $CREDS | jq -r .billingAccountId)
export WALLET_ADDRESS=$(echo $CREDS | jq -r .walletAddress // .billingAccountAddress)

echo "Agent: $AGENT_NAME"
echo "User:  $USER_ID"
echo "Acct:  $BILLING_ACCOUNT_ID"
echo "Wallet: $WALLET_ADDRESS"
```

**Expected:** apiKey prefix `cogni_ag_sk_v1_`, wallet address is a valid `0x[0-9a-f]{40}` NEVER seen before. Save wallet address — you'll fund it next.

### Step 2 — Fund the wallet with $2 USDC on Base

**Funder options:**

- **Derek (one-time for v0 bootstrapping):** Send 2 USDC on Base to `$WALLET_ADDRESS` from any wallet. Basescan confirmation takes ~15s.
- **Canary-bot (CP5+ when canary has revenue):** `canary-bot` uses its operator wallet to fund. Not available until CP5.

Verify funding landed (poll Basescan via API OR call Cogni's balance endpoint):

```bash
for i in 1 2 3 4 5 6; do
  BAL=$(curl -fsS $BASE/api/v1/agent/billing/balance \
    -H "Authorization: Bearer $API_KEY" | jq -r .balance_usdc)
  echo "attempt $i: balance=$BAL USDC"
  [[ $(echo "$BAL >= 1.5" | bc -l) == 1 ]] && break
  sleep 15
done
```

**Expected:** `balance_usdc` ≥ 1.5 (allowing for gas/fees below the deposit amount).

### Step 3 — Confirm Kimi K2 is a routable model

```bash
curl -fsS $BASE/api/v1/node/models \
  -H "Authorization: Bearer $API_KEY" | jq '.[] | select(.id | test("kimi"; "i"))'
```

**Expected:** at least one model with id like `moonshot/kimi-k2-0905` or similar. Pick one.

```bash
export MODEL="moonshot/kimi-k2-0905"    # adjust based on jq output
```

### Step 4 — Fire a paid completion

```bash
RESP=$(curl -fsS -X POST $BASE/api/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\":\"$MODEL\",
    \"graph_name\":\"poet\",
    \"messages\":[{\"role\":\"user\",\"content\":\"Write one haiku about real validation using real money.\"}]
  }")

echo "Response:"
echo $RESP | jq .choices[0].message.content
echo "Usage:"
echo $RESP | jq .usage
```

**Expected:** a real Kimi K2-generated haiku (NOT a fallback message, NOT 402 payment required, NOT 429 rate limit). `usage.total_tokens` > 0.

### Step 5 — Verify charge landed in ledger

```bash
sleep 5   # billing propagation
curl -fsS "$BASE/api/v1/agent/billing/receipts?limit=5" \
  -H "Authorization: Bearer $API_KEY" | jq '.receipts[] | select(.model | test("kimi"; "i"))'
```

**Expected:** at least one row with:
- `model` contains `kimi`
- `cost_usd` > 0
- `billing_account_id` == `$BILLING_ACCOUNT_ID`
- `created_at` within the last 5 minutes

### Step 6 — Verify balance decremented

```bash
curl -fsS $BASE/api/v1/agent/billing/balance \
  -H "Authorization: Bearer $API_KEY" | jq .
```

**Expected:** `balance_usdc` is less than Step 2's funded amount by approximately the `cost_usd` from Step 5's receipt.

## Proof checklist

- [ ] Step 1 returned a wallet address NEVER seen before (grep Basescan history)
- [ ] Step 2 funding transaction is visible on Basescan: `https://basescan.org/tx/<tx_hash>`
- [ ] Step 3 listed Kimi K2 in the model catalog
- [ ] Step 4 returned a real LLM completion (human-check the haiku — coherent, on-topic)
- [ ] Step 5 receipt shows `cost_usd > 0` matching OpenRouter published rate × tokens ±5%
- [ ] Step 6 balance decremented by approximately `cost_usd`
- [ ] No errors at any step

## Success = Gate B passed

On success: update `proj.cogni-canary.md` CP-validation with `gate_b_passed: true` and a link to the Basescan TX + Loki query that proves it. The canary's billing rail is now proven with real money.

## Troubleshooting

### Step 2: balance stays at 0 after 2 minutes

- Check Basescan directly for `$WALLET_ADDRESS` — did the USDC actually arrive?
- If yes on-chain but not in Cogni: the x402 / USDC deposit webhook isn't firing. Check `{app="operator", route="/api/internal/webhooks/alchemy"}` in Loki.
- Also check: deposits sometimes require N confirmations; wait another 60s.

### Step 4: 402 Payment Required

Balance isn't high enough for the Kimi K2 call. Either:
- Kimi K2's per-token rate is higher than you expected — fund $5 instead of $2.
- The balance-to-credits conversion isn't working. Check `{route="/api/v1/chat/completions"}` for the pre-call check log line.

### Step 4: `model not found`

Kimi K2 isn't in the LiteLLM config for this env. Check `infra/compose/runtime/configs/litellm.config.yaml` on the actual VM (via SSH) vs what's in git. If missing, add it via a PR + redeploy.

### Step 5: no receipts

Billing pipeline broke. Known failure modes documented in `bug.0037` (gateway proxy billing $0 cost). Check the LiteLLM audit log for the request id and whether it reached `response-billing-ingester`.

## Related

- [Gate A Runbook](./GATE_A_EXTERNAL_PR_FLIGHT.md)
- [Agent-API Validation](../guides/agent-api-validation.md)
- [task.0345 — Gate A/B validation](../../work/items/task.0345.gate-a-gate-b-validation.md)
- [bug.0037 — gateway billing zero cost](../../work/items/bug.0037.gateway-proxy-zero-cost-streaming.md)
