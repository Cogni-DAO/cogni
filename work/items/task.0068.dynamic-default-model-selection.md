---
id: task.0068
type: task
title: Dynamic default model selection from LiteLLM config metadata
status: needs_design
priority: 1
estimate: 2
summary: Replace hardcoded default model (gpt-4o-mini) with dynamic selection based on default_flash/default_thinking metadata in LiteLLM config
outcome: Graph execution and governance schedules use metadata-driven default model selection
spec_refs: []
assignees: []
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-15
updated: 2026-02-15
labels: [ai, config, governance]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 14
---

# Dynamic default model selection from LiteLLM config metadata

## Requirements

### Observed

**Current state:**

- Governance schedules hardcode `model: "gpt-4o-mini"` in `syncGovernanceSchedules.ts:122`
- No system-level default model configuration
- LiteLLM config has metadata (`default_flash: true`, `default_thinking: true`) but it's unused

**Problem:**

- Changing default model requires code changes, not config
- Metadata exists but provides no value
- "gpt-4o-mini" is hardcoded as temporary workaround (see TODO comment)

### Expected

**Default model resolution:**

1. Read LiteLLM config at runtime
2. Find model with `metadata.cogni.default_flash: true` for general use
3. Find model with `metadata.cogni.default_thinking: true` for reasoning tasks
4. Use these as system defaults when no explicit model specified in governance/scheduled runs

**Configuration:**

```yaml
# litellm.config.yaml
- model_name: llama-3.3-70b
  model_info:
    metadata:
      cogni:
        default_flash: true # Used for governance schedules by default

- model_name: deepseek-v3.2
  model_info:
    metadata:
      cogni:
        default_thinking: true # Available for reasoning-heavy tasks
```

**Code changes:**

- `packages/scheduler-core/src/services/syncGovernanceSchedules.ts:122` — remove hardcoded "gpt-4o-mini", use default_flash model
- Add utility to read LiteLLM config and extract default model IDs
- Governance schedules use `input: { message: schedule.entrypoint, model: getDefaultFlashModel() }`

## Allowed Changes

- `packages/scheduler-core/src/services/syncGovernanceSchedules.ts` — remove hardcode, call default model function
- `src/shared/config/` — new utility to parse LiteLLM config and extract default models
- `platform/infra/services/runtime/configs/litellm.config.yaml` — verify metadata is correct
- Tests for default model extraction

## Plan

- [ ] Create `getDefaultModelFromLiteLLMConfig(type: 'flash' | 'thinking')` utility
  - [ ] Read litellm.config.yaml from disk
  - [ ] Parse YAML
  - [ ] Find model with `metadata.cogni.default_flash: true` or `default_thinking: true`
  - [ ] Return model_name (e.g., "llama-3.3-70b")
  - [ ] Throw error if no default found (fail-fast, not silent fallback)
- [ ] Update `syncGovernanceSchedules.ts`
  - [ ] Import utility
  - [ ] Replace `model: "gpt-4o-mini"` with `model: getDefaultModelFromLiteLLMConfig('flash')`
  - [ ] Remove TODO comment
- [ ] Add tests
  - [ ] Unit test: parse config and extract default models
  - [ ] Unit test: error when no default_flash metadata found
  - [ ] Integration test: governance schedule created with correct model from config
- [ ] Verify LiteLLM config metadata is correct
  - [ ] Confirm llama-3.3-70b has `default_flash: true`
  - [ ] Confirm deepseek-v3.2 has `default_thinking: true`

## Validation

**Unit tests:**

```bash
pnpm test src/shared/config/litellmConfig.test.ts
```

**Expected:** Default model extraction works, errors when metadata missing

**Governance schedule test:**

```bash
pnpm test packages/scheduler-core/src/services/syncGovernanceSchedules.test.ts
```

**Expected:** Schedules created with model from config metadata, not hardcoded value

**Full check:**

```bash
pnpm check
```

**Expected:** All checks pass

## Review Checklist

- [ ] **Work Item:** `task.0068` linked in PR body
- [ ] **Spec:** N/A (config-driven behavior)
- [ ] **Tests:** Unit tests for config parsing, integration test for governance schedules
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: Governance schedules currently hardcode gpt-4o-mini (temporary workaround)
- LiteLLM config: `platform/infra/services/runtime/configs/litellm.config.yaml`

## Attribution

- Filed: derekg1729
- Context: Part of openclaw-agent-hotfixes branch cleanup
