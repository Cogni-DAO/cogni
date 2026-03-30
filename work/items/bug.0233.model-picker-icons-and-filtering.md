---
id: bug.0233
type: bug
title: "Model picker shows wrong icons, leaks codex models into OpenRouter tab, shows embedding models"
status: needs_merge
priority: 2
estimate: 1
summary: Platform models display Zap fallback icon instead of provider logos; ChatGPT codex models appear under OpenRouter tab; text-embedding-3-small shown as selectable chat model
outcome: Correct provider icons, clean model list per tab, non-chat models filtered
spec_refs:
assignees: derekg1729
credit:
project:
branch: fix/logo-and-seed-money
pr: "https://github.com/Cogni-DAO/node-template/pull/658"
reviewer:
created: 2026-03-29
updated: 2026-03-29
labels: [ui, model-picker, billing]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 5
---

## Problem

Three issues in the model picker dialog:

1. **Wrong icons**: All platform (LiteLLM/OpenRouter) models show the default Zap lightning bolt icon instead of provider-specific logos (OpenAI, Anthropic, Google, etc.). Root cause: `platform.provider.ts` sets `ref.providerKey = "platform"` which has no entry in `PROVIDER_ICONS`.

2. **Codex models in OpenRouter tab**: ChatGPT subscription models (`providerKey: "codex"`) leak into the OpenRouter tab because the filter only excluded `"openai-compatible"`.

3. **Embedding model in chat list**: `text-embedding-3-small` from LiteLLM config appears as a selectable chat model.

## Fix

1. Add `MODEL_PREFIX_TO_PROVIDER` map and `resolveModelIcon()` in `provider-icons.ts` — tries providerKey first, falls back to model ID prefix matching (`gpt→openai`, `claude→anthropic`, `gemini→google`).

2. Exclude `providerKey === "codex"` from `platformModels` filter in `ModelPicker.tsx`.

3. Filter non-chat models in `transformModelInfoResponse` using LiteLLM's `mode` field.

Also adds `pnpm dev:seed:money` command to top up dev billing accounts with $100 credits for testing paid models.

## Validation

- [ ] OpenRouter tab shows provider-specific icons (OpenAI spiral for GPT models, Anthropic icon for Claude, etc.)
- [ ] No ChatGPT/codex models appear under OpenRouter tab
- [ ] No embedding models appear in the model picker
- [ ] `pnpm dev:seed:money` tops up accounts correctly (verified: $100 display matches)
