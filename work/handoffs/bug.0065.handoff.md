---
id: handoff.bug.0065.2026-02-15
type: handoff
work_item_id: bug.0065
status: active
created: 2026-02-15
updated: 2026-02-15
branch: feat/gov-visibility
last_commit: db66bc04ba66e1b05b02baae5c86f4275ddd8973
---

# Handoff: Governance Agent Production Issues Investigation

## Context

- User reported governance agent giving "stupid" responses in production (openclaw chat)
- No charge receipts being created for user conversations despite using paid models (gpt-4o-mini)
- Investigation revealed 3 distinct bugs affecting governance system and billing pipeline
- Work done: log analysis, langfuse trace review, bug filing, partial fixes planned

## Current State

### Completed

- ✅ **3 bugs filed and indexed:**
  - `bug.0065` (Pri 1): Agent uses wrong tools for governance visibility (sessions_history vs files)
  - `bug.0066` (Pri 1): LiteLLM reports $0 cost for gpt-4o-mini causing 0-credit receipts
  - `bug.0067` (Pri 0, CRITICAL): Model allowlist blocks `openrouter/auto` — 75% governance sessions.patch failure rate
- ✅ **Root causes identified** with code pointers and evidence
- ✅ **Production log analysis** via Grafana/Loki - found OpenClaw gateway errors
- ✅ **Langfuse trace analysis** - trace `33edddad-e95d-4dba-a900-99a578f5f94c` shows agent behavior

### Not Done

- ❌ **Quick workaround fixes** (user requested, not started):
  1. Mark gpt-4o-mini as "free" model in billing config (hack - needs separate bug)
  2. Create stub workspace files (IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md)
  3. Update SOUL.md to not use sessions_history for governance visibility
- ❌ **Root cause fixes** (requires separate work items/PRs)
- ❌ **Production config fix** for bug.0067 (openrouter/auto allowlist)

### Blocked

- **bug.0067 is P0** and blocks governance completely - needs immediate production config fix
- Quick workarounds can unblock user visibility (bugs 0065, 0066) but don't fix root causes

## Decisions Made

### Bug Triage

- **bug.0067 = P0**: 75% governance failure rate, blocks subagent spawning
- **bug.0065 = P1**: User-facing, blocks governance visibility dashboard (story.0063)
- **bug.0066 = P1**: Billing integrity issue, affects all gpt-4o-mini users

### Investigation Approach

- Used Langfuse API to fetch recent traces: `pnpm langfuse:trace`
- Queried Grafana Loki for production logs: OpenClaw gateway + app service logs
- Cross-referenced billing events (`ai.billing.commit_complete`) with LLM call logs (`ai.llm_call`)

### Workaround Strategy

Per user request: "fix the low hanging fruit asap"

1. Config changes (no code) to unblock users immediately
2. File separate bugs for hacks/workarounds
3. Proper root cause fixes in follow-up PRs

## Next Actions

### Immediate (bug.0067 - P0)

- [ ] Check production `openclaw.json` model allowlist config
- [ ] Add `openrouter/auto` to allowlist OR update SOUL.md to use allowed model
- [ ] Deploy config change + reload gateway
- [ ] Validate: governance sessions.patch succeeds for 1 hour (4 cycles)

### Quick Fixes (bugs 0065, 0066)

- [ ] Create stub files in `services/sandbox-openclaw/gateway-workspace/`:
  - `IDENTITY.md` (2-3 lines: "Gateway agent identity context")
  - `USER.md` (2-3 lines: "User context (when available)")
  - `HEARTBEAT.md` (2-3 lines: "Heartbeat instructions (none for main agent)")
  - `BOOTSTRAP.md` (2-3 lines: "Bootstrap checklist (workspace ready)")
- [ ] Update `SOUL.md` § Finding Context:
  - Add governance data sources (memory/edo_index.md, git log, budget headers)
  - Add explicit: "DO NOT use sessions_history for governance visibility"
- [ ] Mark gpt-4o-mini as free model (HACK):
  - File bug for this workaround
  - Add to free models list in billing config
  - Document: "Actually costs $0.15/$0.60 per 1M but treating as free for new user onboarding"

### Root Cause Fixes (separate PRs)

- [ ] bug.0066: Investigate why LiteLLM reports $0 for OpenRouter paid models
- [ ] bug.0065: Design proper governance visibility API (story.0063 needs this)
- [ ] bug.0067: Configure governance sessions with pre-approved models in scheduler config

## Risks / Gotchas

- **Free model hack (bug.0066)**: Marking gpt-4o-mini as "free" means no charge receipts BUT it DOES cost us money on OpenRouter
- **Model allowlist (bug.0067)**: Production config out of sync with SOUL.md delegation instructions
- **Sessions_history architecture**: Tool works but is wrong abstraction - governance outputs are in FILES not session state
- **Stub files**: Creating empty workspace files is a band-aid - agent should handle missing optional files gracefully
- **OpenRouter free tier**: Need to verify if $0 costs are from free tier credits being applied vs missing pricing data

## Pointers

| File / Resource                                               | Why it matters                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `work/items/bug.0065.md`                                      | Main bug - agent uses wrong tools for governance visibility         |
| `work/items/bug.0066.md`                                      | Billing bug - $0 cost for paid models                               |
| `work/items/bug.0067.md`                                      | P0 bug - model allowlist blocks governance                          |
| `services/sandbox-openclaw/gateway-workspace/SOUL.md`         | Agent prompt - line 40 specifies brain model, § Finding Context     |
| `src/features/ai/services/billing.ts:100-122`                 | Cost handling - passes when costUsd=0 (number) instead of deferring |
| `platform/infra/services/runtime/configs/litellm.config.yaml` | LiteLLM model config - where to add free models                     |
| Langfuse trace `33edddad-e95d-4dba-a900-99a578f5f94c`         | Production evidence of agent using sessions_history incorrectly     |
| OpenClaw gateway logs 2026-02-15 11:45-14:15 UTC              | 11 "model not allowed: openrouter/auto" errors at 15min intervals   |
| Grafana query: `{app="cogni-template", env="production"}`     | Log access for billing/governance event correlation                 |
| `pnpm langfuse:trace`                                         | Command to fetch latest langfuse trace for debugging                |
