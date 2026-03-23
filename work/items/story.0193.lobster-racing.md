---
id: story.0193
type: story
title: "Lobster Racing: competitive OpenClaw agents funded by web3 wallets"
status: needs_triage
priority: 1
rank: 99
estimate: 2
summary: "Fund 2+ OpenClaw instances via CogniDAO web3 wallets, give them a shared goal with clear success criteria, and let them race to complete it first."
outcome: "A working lobster race: multiple OpenClaw agents autonomously competing on the same task, each funded by a distinct DAO-controlled wallet, with a prize awarded to the winner."
spec_refs:
assignees: [derekg1729]
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-23
updated: 2026-03-23
labels: []
external_refs:
---

# Lobster Racing: competitive OpenClaw agents funded by web3 wallets

## Context

"Lobster" = an OpenClaw agent instance. "Racing" = funding 2+ lobsters via CogniDAO web3 accounts, assigning them the same goal with clear success criteria, and letting them compete to finish first. The winner receives a prize from the funding pool.

This combines three existing Cogni capabilities into a new product surface:

1. **OpenClaw agent provisioning** -- spinning up isolated agent instances
2. **CogniDAO web3 wallets** -- programmatic funding and prize distribution
3. **Task evaluation** -- determining when an agent has met success criteria

## Requirements

- Ability to define a **race**: a task description with measurable success criteria, a prize pool, and a participant count (2+)
- Each participant ("lobster") is a separately provisioned OpenClaw instance
- Each lobster is funded from a distinct web3 wallet (DAO-controlled agent accounts)
- Lobsters work autonomously toward the goal -- no human intervention during the race
- A **judge mechanism** evaluates completion against the success criteria and declares a winner
- Prize is distributed to the winning lobster's wallet on completion
- Race lifecycle: create -> fund -> start -> monitor -> judge -> payout

## Allowed Changes

- Broad -- this is a greenfield feature spanning infra provisioning, web3 integration, and agent orchestration
- Likely touches: OpenClaw config/provisioning, DAO wallet integration, a new "race" orchestration layer

## Plan

- [ ] Spike infrastructure questions (see `spike.0194`)
- [ ] Design race lifecycle and data model
- [ ] Implement race creation and lobster provisioning
- [ ] Integrate DAO wallet funding per lobster
- [ ] Build judge/evaluation mechanism
- [ ] Wire up prize payout on race completion
- [ ] Demo: run a real lobster race end-to-end

## Validation

**Manual:** Create a race with 2 lobsters, fund each from separate DAO wallets, start the race with a well-defined task, observe both agents working, confirm the judge picks a winner, and verify prize payout lands in the correct wallet.

## Review Checklist

- [ ] **Work Item:** `story.0193` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related spike: `spike.0194` (infrastructure research)

## Attribution

-
