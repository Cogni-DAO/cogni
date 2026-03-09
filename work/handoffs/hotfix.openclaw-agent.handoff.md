---
id: handoff.openclaw-agent-hotfixes.2026-02-15
type: handoff
work_item_id: hotfix
status: active
created: 2026-02-15
updated: 2026-02-15
branch: openclaw-agent-hotfixes
last_commit: 8fc4263de6aa0f024b58c0199b14f87f3a14378b
---

# Handoff: OpenClaw Agent Configuration Hotfixes

## Context

- Production issues: governance agents failing 75%, billing showing $0 costs, cost control hemorrhage
- Root causes: hardcoded `openrouter/auto` fallback (not in LiteLLM config), multiple unreliable free models, DeepSeek model ID mismatch
- Fixes completed: removed model fallback, consolidated to single free model (gpt-4o-mini), fixed DeepSeek config
- **Remaining work**: Create missing OpenClaw gateway workspace files (IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md)

## Current State

### Completed ✅

**3 atomic commits on `openclaw-agent-hotfixes` branch:**

1. **`ddfc4f69`** - Set gpt-4o-mini as designated free model
   - Removed 4 unreliable free models (nemotron, trinity-mini, glm-4.5-air, solar-pro-3)
   - Fixed DeepSeek model IDs: `deepseek-chat-v3.x` → `deepseek-v3.x` (production 400 error fix)
   - Updated DeepSeek V3.2 context window: 65k → 164k tokens
   - Updated all test fixtures and skill documentation

2. **`ce5eab25`** - Require explicit model field, remove openrouter/auto fallback
   - Removed hardcoded `"openrouter/auto"` default (was never in LiteLLM config!)
   - API now returns 400 error when model field missing (explicit > implicit)
   - Updated tests to expect 400 or provide explicit model

3. **`8fc4263d`** - Add temporary model to governance schedules
   - Hardcoded `gpt-4o-mini` in `syncGovernanceSchedules.ts` (temporary)
   - Created `task.0068` for proper metadata-driven model selection
   - Governance schedules now work (previously relied on removed fallback)

**Bug resolution status:**

- ✅ `bug.0067` - Model allowlist: Fixed by removing `openrouter/auto`, requiring explicit models
- ✅ `bug.0066` - Zero-cost billing: Workaround via setting gpt-4o-mini as free model
- ⚠️ `bug.0065` - Missing workspace files: **NOT FIXED** (see Next Actions)

### Not Done ❌

**Missing OpenClaw gateway workspace files** (bug.0065):

- `services/sandbox-openclaw/gateway-workspace/IDENTITY.md` - Agent identity context
- `services/sandbox-openclaw/gateway-workspace/USER.md` - User context template
- `services/sandbox-openclaw/gateway-workspace/HEARTBEAT.md` - Heartbeat state tracking
- `services/sandbox-openclaw/gateway-workspace/BOOTSTRAP.md` - Workspace initialization

**Impact:** OpenClaw gateway agent can't read these files, causing tool errors when agent tries `files_read()` expecting them to exist.

## Decisions Made

### Model Configuration Strategy

- **Decision:** Single designated free model (gpt-4o-mini) instead of multiple free-tier models
- **Rationale:** Cost control - predictable vs unreliable free tiers that hit rate limits
- **Link:** Commit `ddfc4f69`, `.openclaw/skills/litellm-free-models/SKILL.md`

### No Model Fallback

- **Decision:** Require explicit `model` field in all graph execution requests (400 if missing)
- **Rationale:** `openrouter/auto` was never in LiteLLM config, caused production failures
- **Link:** Commit `ce5eab25`, `src/app/api/internal/graphs/[graphId]/runs/route.ts:341-348`

### Temporary vs Proper Fix

- **Decision:** Hardcode gpt-4o-mini in governance schedules now, implement metadata-driven selection later
- **Rationale:** Unblock governance immediately, avoid over-engineering without requirements clarity
- **Link:** Commit `8fc4263d`, `task.0068`

## Next Actions

### Immediate (bug.0065 - Missing Workspace Files)

- [ ] Create `services/sandbox-openclaw/gateway-workspace/IDENTITY.md`
  - Content: Agent identity/role description (read SOUL.md for context)
  - Purpose: Provides agent with self-awareness context
  - Format: Markdown with frontmatter (see existing workspace files for examples)

- [ ] Create `services/sandbox-openclaw/gateway-workspace/USER.md`
  - Content: User context template (PII-safe identity injection point)
  - Purpose: Agent reads to understand who it's talking to
  - Reference: `task.0047` (OpenClaw user context v0)

- [ ] Create `services/sandbox-openclaw/gateway-workspace/HEARTBEAT.md`
  - Content: Heartbeat state tracking template
  - Purpose: Agent reads/writes to track execution state across runs
  - Reference: `docs/spec/governance-council.md` (heartbeat contract)

- [ ] Create `services/sandbox-openclaw/gateway-workspace/BOOTSTRAP.md`
  - Content: Workspace initialization checklist
  - Purpose: First-run setup instructions for agent
  - Reference: `SOUL.md` Operating Modes section

- [ ] Test in production: Trigger governance run, verify no `files_read()` errors
- [ ] Update bug.0065 status to Done, link PR

### Follow-up (task.0068 - Metadata-Driven Model Selection)

- [ ] Implement `getDefaultModelFromLiteLLMConfig(type: 'flash' | 'thinking')` utility
- [ ] Replace hardcoded `"gpt-4o-mini"` in `syncGovernanceSchedules.ts:124` with dynamic selection
- [ ] Read metadata from `platform/infra/services/runtime/configs/litellm.config.yaml`
- [ ] Find models with `metadata.cogni.default_flash: true` or `default_thinking: true`

## Risks / Gotcas

- **Breaking change:** API now requires explicit `model` field. Any external consumers (tests, scripts) will break if they relied on the fallback.
- **Governance still hardcoded:** `task.0068` must be completed before changing the default model from gpt-4o-mini.
- **Workspace files are guesswork:** No spec exists for IDENTITY/USER/HEARTBEAT/BOOTSTRAP content. Create minimal stubs, iterate based on agent behavior.
- **DeepSeek context window:** Updated to 164k based on production testing, but OpenRouter docs may lag. Verify with actual usage.
- **Missing workspace files break agent:** Until created, agent will error when trying to read them via `files_read()` tool.

## Pointers

| File / Resource                                                       | Why it matters                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `platform/infra/services/runtime/configs/litellm.config.yaml`         | LiteLLM model config - free model designation, DeepSeek fixes    |
| `services/sandbox-openclaw/openclaw-gateway.json`                     | OpenClaw model allowlist - must match LiteLLM config             |
| `services/sandbox-openclaw/gateway-workspace/SOUL.md`                 | Agent system prompt - references workspace files that must exist |
| `packages/scheduler-core/src/services/syncGovernanceSchedules.ts:124` | Hardcoded gpt-4o-mini - replace with task.0068 solution          |
| `src/app/api/internal/graphs/[graphId]/runs/route.ts:341-348`         | Model requirement validation - returns 400 if missing            |
| `work/items/task.0068.dynamic-default-model-selection.md`             | Follow-up work to implement metadata-driven model selection      |
| `work/items/bug.0065.openclaw-governance-visibility.md`               | Missing workspace files bug - what remains to fix                |
| Commits: `ddfc4f69`, `ce5eab25`, `8fc4263d`                           | 3 atomic commits with full context and rationale                 |
| Branch: `openclaw-agent-hotfixes`                                     | Ready for PR to staging                                          |
