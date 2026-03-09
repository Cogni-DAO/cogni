---
id: bug.0067
type: bug
title: OpenClaw model allowlist blocks openrouter/auto — governance sessions.patch failures at 75% rate
status: needs_triage
priority: 0
estimate: 1
summary: Production OpenClaw gateway rejects openrouter/auto model in sessions.patch calls. Causes 75% failure rate for governance heartbeat updates and blocks subagent spawning.
outcome: openrouter/auto added to model allowlist OR governance sessions reconfigured to use allowed model
spec_refs: []
assignees: []
credit:
project:
branch:
pr:
reviewer:
created: 2026-02-15
updated: 2026-02-15
labels: [openclaw, governance, config, p0]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 7
---

# OpenClaw model allowlist blocks openrouter/auto — governance sessions.patch failures

## Requirements

### Observed

**Production OpenClaw gateway (2026-02-15):**

```
[ws] ⇄ res ✗ sessions.patch 100ms
errorCode=INVALID_REQUEST
errorMessage=model not allowed: openrouter/auto
```

**Pattern:**

- **Frequency**: Every 15 minutes (11:45, 12:00, 12:15, 12:30... 14:15 UTC)
- **Failure rate**: 75% (11 failures, 3 successes in sample window)
- **Affected**: Governance scheduled sessions trying to spawn subagents or update session models
- **Trigger**: Config reload at 10:06 and 10:32 UTC modified `models.providers.cogni.models`, first error 1.5hr later

**Code pointers:**

- OpenClaw gateway logs: `{service="openclaw-gateway", env="production"}`
- Config: `/path/to/openclaw.json` → `models.providers.cogni.models` (allowlist)
- SOUL.md lines 33-46: Delegation policy tells agent to spawn brain with `cogni/deepseek-v3.2` but `openrouter/auto` is attempted

**Impact cascade:**

1. Governance agent told to spawn brain subagent
2. Attempts `sessions.spawn` with `openrouter/auto` model
3. Gateway rejects: "model not allowed"
4. Agent can't delegate writes (violates SOUL.md delegation policy)
5. Governance heartbeats fail to update session state

### Expected

**Either:**

A) **Add `openrouter/auto` to allowlist** in `openclaw.json`:

```json
{
  "models": {
    "providers": {
      "cogni": {
        "models": ["cogni/deepseek-v3.2", "openrouter/auto", ...]
      }
    }
  }
}
```

B) **Update SOUL.md to use allowed model**:

- Change line 40 from `cogni/deepseek-v3.2` to whichever model IS allowed
- OR use explicit OpenRouter model instead of `/auto` routing

C) **Disable model allowlist** for governance sessions (NOT recommended - security risk)

### Reproduction

1. Deploy OpenClaw gateway with model allowlist configured
2. Configure governance session with SOUL.md delegating to `openrouter/auto`
3. Trigger governance run
4. **Observe**: `sessions.patch` fails with "model not allowed"
5. Check logs: `grep "INVALID_REQUEST" /path/to/gateway.log`

**Production evidence:**

```bash
# OpenClaw gateway logs
{service="openclaw-gateway", env="production"} | json
  | line=~"model not allowed"
```

Shows 11+ failures between 11:45-14:15 UTC at exactly 15-minute intervals.

### Impact

- **P0 SEVERITY**: Governance system completely broken - can't spawn brains, can't make decisions
- **Data**: 75% of governance heartbeat updates failing
- **User**: Governance agent appears non-functional, can't complete delegation workflow
- **Security**: If allowlist bypassed to fix, opens gateway to unapproved models

## Allowed Changes

- `openclaw.json` (production config) - model allowlist
- `services/sandbox-openclaw/gateway-workspace/SOUL.md` - model specification for brain delegation
- OpenClaw gateway deployment (config reload)

## Plan

### Immediate Fix

- [ ] Check production `openclaw.json` for current model allowlist
- [ ] Verify which models ARE allowed
- [ ] Either:
  - [ ] Add `openrouter/auto` to allowlist, OR
  - [ ] Update SOUL.md line 40 to use allowed model
- [ ] Test with governance session patch
- [ ] Deploy config change (reload gateway if needed)

### Root Cause Mitigation

- [ ] Add model allowlist validation to governance config sync
- [ ] Alert on sessions.patch failures (>5% error rate)
- [ ] Document which models are allowed for governance

## Validation

**Immediate:**

```bash
# After fix, check gateway accepts sessions.patch
curl -X PATCH http://openclaw-gateway:18789/api/sessions/gov-engineering \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"model": "openrouter/auto"}'

# Expected: 200 OK (not INVALID_REQUEST)
```

**Sustained:**

```bash
# Monitor for 1 hour (4 governance cycles)
{service="openclaw-gateway", env="production"} | json
  | line=~"sessions.patch"
  | errorCode!="INVALID_REQUEST"

# Expected: 0 "model not allowed" errors
```

## Review Checklist

- [ ] **Work Item:** `bug.0067` linked in PR body
- [ ] **Spec:** N/A (config fix)
- [ ] **Tests:** Manual validation (governance run succeeds)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Production logs: 2026-02-15 11:45-14:15 UTC
- Related: bug.0065 (governance visibility), task.0045 (enable OpenClaw subagent spawning)
- Evidence: 125 log entries, 13.2KB, 9 pairing failures + 11 model rejections

## Attribution

- Reported: derekg1729
- Investigation: Claude Code agent + OpenClaw log analysis
