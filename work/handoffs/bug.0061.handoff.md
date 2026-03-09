---
work_item_id: bug.0061
status: In Progress
branch: fix/bug.0061-ui-balance
last_commit: 80d83ef1 (fix(models): governance fallback model Kimi K2.5)
---

# Handoff: bug.0061 + task.0064 — UI Balance Display & Cost Estimation

## Goal

Make negative credit balances visible & accurate in UI. Fix cost estimates to match actual OpenClaw token consumption (20k avg tokens). Default graph to OpenClaw, models to DeepSeek + Kimi K2.5.

## What's Done

**bug.0061 (UI):**

- Chat/credits pages: removed unsafe `?? 0` defaults on balance display
- Added red styling (`text-destructive`) when balance < 0
- See: `src/app/(app)/chat/page.tsx:83`, `src/app/(app)/credits/CreditsPage.client.tsx:70–72`

**task.0064 (Billing):**

- `ESTIMATED_USD_PER_1K_TOKENS`: 0.002 → 0.02 (10x multiplier)
- `GRAPH_OVERHEAD_BUFFER`: 500 → 10000 tokens (OpenClaw system prompt cost)
- See: `src/core/ai/token-estimation.server.ts:19`, `src/features/ai/services/preflight-credit-check.ts:117`

**Defaults & Config:**

- Default graph: `langgraph:poet` → `sandbox:openclaw`
- Model catalog: DeepSeek (primary), Kimi K2.5 (fallback — 7.5x cheaper than Sonnet)
- LiteLLM: Added `kimi-k2.5` with `fallback_thinking` tag
- OpenClaw gateway: K2.5 added to models + defaults

## Blockers / Next Steps

1. **Prerequisite bug.0050**: API contract must accept negative balances (Zod schema fix)
   - Without this, UI still hides negatives on API 400 error
   - Merge order: bug.0050 → bug.0061

2. **Testing**: Open `/chat` and `/credits` pages
   - Set test account balance < 0 (DB manual edit or billing test)
   - Verify balance displays in red as negative value
   - Check OpenClaw graph is default selection

3. **Cost estimate validation**: Run preflight checks with real OpenClaw calls
   - Verify 10k token buffer is sufficient
   - Monitor actual vs estimated spend

## Key Files

- UI display: [`src/app/(app)/chat/page.tsx`](<../../src/app/(app)/chat/page.tsx>), [`src/app/(app)/credits/CreditsPage.client.tsx`](<../../src/app/(app)/credits/CreditsPage.client.tsx>)
- Cost estimates: [`src/core/ai/token-estimation.server.ts`](../../src/core/ai/token-estimation.server.ts), [`src/features/ai/services/preflight-credit-check.ts`](../../src/features/ai/services/preflight-credit-check.ts)
- Defaults: [`src/features/ai/components/ChatComposerExtras.tsx:64`](../../src/features/ai/components/ChatComposerExtras.tsx)
- Specs: [`docs/spec/model-catalog.md`](../../docs/spec/model-catalog.md)
- Configs: [`platform/infra/services/runtime/configs/litellm.config.yaml`](../../platform/infra/services/runtime/configs/litellm.config.yaml), [`services/sandbox-openclaw/openclaw-gateway.json`](../../services/sandbox-openclaw/openclaw-gateway.json)

## Commits

See [`fix/bug.0061-ui-balance`](https://github.com/cogni-dao/cogni-template/compare/staging...fix/bug.0061-ui-balance) branch (8 commits total).

## Related Docs

- [Model Catalog](../../docs/spec/model-catalog.md) — governance model selection (DeepSeek + Kimi K2.5)
- bug.0050: API contract fix (blocker)
- bug.0027: Gateway billing failure context
- task.0029: Callback billing (triggered negative balance scenario)
