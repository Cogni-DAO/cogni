---
id: story.0089
type: story
title: Discord Bot Conversation Evals
status: needs_triage
priority: 1
rank: 99
estimate: 3
summary: Automated evaluation framework for Discord bot conversation channels to measure response quality, latency, and correctness
outcome: A repeatable eval suite that tests bot behavior in Discord channels with metrics and regression detection
spec_refs:
assignees: derekg1729
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-19
updated: 2026-02-19
labels: [discord, evals, testing, bot]
external_refs:
---

# Discord Bot Conversation Evals

## Requirements

<!-- What must be true when this is done? Be specific. -->

- Automated eval harness that sends test messages to Discord channels and captures bot responses
- Metrics collection for response latency, token usage, and correctness against expected outputs
- Regression detection — fail eval when bot responses deviate from baseline quality
- CI/CD integration — evals run on PRs and scheduled runs
- Test scenarios cover common conversation patterns (greetings, tool calls, error handling, context retention)
- Discord-specific behaviors tested: message threading, @mentions, embed formatting, rate limiting

## Allowed Changes

<!-- What files/areas may this touch? Scope boundaries. -->

- New `tests/evals/discord/` directory for eval harness and test cases
- OpenClaw gateway eval tooling integration
- Discord bot adapter modifications for test mode hooks
- CI workflow files for eval automation
- Optional: Langfuse evals integration for LLM-as-judge scoring

## Plan

<!-- Step-by-step execution plan. -->

- [ ] Define eval harness architecture (mock Discord client vs. real channel)
- [ ] Create test scenario DSL for Discord conversations
- [ ] Implement baseline response recording and storage
- [ ] Build assertion framework for bot response validation
- [ ] Integrate with CI pipeline for automated runs
- [ ] Add metrics dashboard or report generation
- [ ] Document eval authoring guide for adding new test cases

## Validation

<!-- Name exact commands/tests and expected outcome. -->

**Command:**

```bash
cd tests/evals/discord
pnpm eval:run --scenario=baseline --channel=test-bot-eval
```

**Expected:** Eval completes, all test scenarios pass, regression delta report generated with latency/token metrics.

## Review Checklist

<!-- All required before status=done. -->

- [ ] **Work Item:** `<type>.<num>` linked in PR body
- [ ] **Spec:** all invariants of linked specs (here, or project) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

<!-- PR URL and any related links. -->

-

## Attribution

<!-- Credit contributors. -->

-
