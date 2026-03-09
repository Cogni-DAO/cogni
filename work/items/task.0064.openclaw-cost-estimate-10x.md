---
id: task.0064
type: task
title: "OpenClaw preflight cost estimate 10x audit — real token consumption"
status: needs_design
priority: 2
estimate: 1
summary: "OpenClaw AI consumes significant budget; preflight estimates are 10x too low. User account went severely negative because estimates didn't match reality. Increase ESTIMATED_USD_PER_1K_TOKENS from $0.002 to $0.02."
outcome: "Preflight cost estimates accurate to actual OpenClaw spend. Accounts with high AI workloads no longer go negative due to underestimation."
spec_refs: []
assignees: []
credit:
project: proj.reliability
branch: fix/bug.0061-ui-balance
pr:
reviewer:
created: 2026-02-15
updated: 2026-02-15
labels: [billing, openclaw, cost-estimation, p2]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 8
---

# task.0064 — OpenClaw cost estimate 10x audit

## Requirements

OpenClaw AI workloads consume significantly more tokens than preflight estimates predict. User account went to -$296K because estimates were 10x lower than actual spend.

Increase preflight cost estimates to reflect real OpenClaw token consumption.

### Observed

- `src/core/ai/token-estimation.server.ts:1`: `ESTIMATED_USD_PER_1K_TOKENS = 0.002`
- Used by: `src/features/ai/services/preflight-credit-check.ts` (all AI graph gate checks)
- Impact: User can initiate calls that appear affordable but consume 10x more credits

### Expected

- `ESTIMATED_USD_PER_1K_TOKENS = 0.02` (10x multiplier, reflects actual OpenClaw consumption)
- All preflight checks now require 10x higher balance
- Users blocked earlier, preventing severe negative balances

## Allowed Changes

- `src/core/ai/token-estimation.server.ts` — update constant from 0.002 to 0.02
- Update any related tests or fixtures that hardcode this value
- Document rationale in commit message

## Plan

- [ ] Locate `ESTIMATED_USD_PER_1K_TOKENS` definition and all uses
- [ ] Change from `0.002` to `0.02`
- [ ] Run tests (update test fixtures if needed)
- [ ] Verify no hardcoded assumptions elsewhere
- [ ] Document: "OpenClaw token consumption audit shows 10x higher costs"

## Validation

```bash
pnpm typecheck && pnpm test:contract
```

Expected: All tests pass. Preflight checks now gate at 10x higher credit requirement.

## Review Checklist

- [ ] **Work Item**: `task.0064` linked in PR
- [ ] **Rationale**: documented why 10x (OpenClaw spend audit)
- [ ] **Tests**: passing with updated fixtures
- [ ] **Reviewer**: assigned and approved

## Notes

- Separate from bug.0061 (UI display fix)
- Different reviewer: billing/infrastructure engineer
- Different testing strategy: billing system gates, not UI
