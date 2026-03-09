---
id: task.0057
type: task
title: "OpenClaw OSS: per-section system prompt toggles + heartbeat guard"
status: needs_triage
priority: 1
estimate: 2
summary: "OpenClaw's buildAgentSystemPrompt() unconditionally injects Heartbeats, Silent Replies, CLI Quick Reference, Self-Update, Model Aliases, and Memory Recall sections into every main agent system prompt. No per-section config toggles exist — only promptMode (full/minimal/none) which is too coarse. Need upstream PR adding section-level config so deployments can opt out of irrelevant sections."
outcome: "OpenClaw config supports per-section toggles (e.g. agents.defaults.promptSections.heartbeats: false). Heartbeat section gated on heartbeat.every !== '0'. Irrelevant sections no longer waste tokens."
spec_refs:
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [openclaw, oss, upstream, prompt, tokens]
external_refs:
assignees: derekg1729
credit:
revision: 0
blocked_by:
deploy_verified: false
rank: 15
---

# task.0057 — OpenClaw OSS: per-section system prompt toggles

## Context

OpenClaw's `buildAgentSystemPrompt()` (`src/agents/system-prompt.ts`) injects these sections unconditionally into every non-subagent system prompt:

| Section                           | Lines   | Gated by                     | Wastes tokens when...                  |
| --------------------------------- | ------- | ---------------------------- | -------------------------------------- |
| `## Heartbeats`                   | 589-600 | `!isMinimal` only            | `heartbeat.every: "0"` (disabled)      |
| `## Silent Replies`               | 571-587 | `!isMinimal` only            | Agent is API-only, no channel          |
| `## OpenClaw CLI Quick Reference` | 415-422 | None (always)                | Agent is sandboxed, no CLI access      |
| `## OpenClaw Self-Update`         | 427-435 | `hasGateway && !isMinimal`   | Agent shouldn't self-update            |
| `## Memory Recall`                | 51-65   | `!isMinimal` + tools exist   | "Mandatory" language can't be softened |
| `## Model Aliases`                | 439-448 | `!isMinimal` + aliases exist | Low value, consumes tokens             |

The only lever is `promptMode` ("full" / "minimal" / "none") but "minimal" strips Skills, Memory tools, Messaging, Reply Tags too — too aggressive.

## Requirements

Upstream PR to OpenClaw:

- [ ] Add `agents.defaults.promptSections` config object with boolean toggles per section
- [ ] Gate `## Heartbeats` on `heartbeat.every !== "0"` (or `promptSections.heartbeats: false`)
- [ ] Gate `## Silent Replies` on `promptSections.silentReplies` (default true for backward compat)
- [ ] Gate `## OpenClaw CLI Quick Reference` on `promptSections.cliReference` (default true)
- [ ] Gate `## OpenClaw Self-Update` on `promptSections.selfUpdate` (default true)
- [ ] Gate `## Memory Recall` on `promptSections.memoryRecall` (default true)
- [ ] Make memory_search tool description configurable (override "Mandatory recall step" text)

## Validation

- Config `promptSections.heartbeats: false` removes Heartbeats section from system prompt
- Config `heartbeat.every: "0"` auto-disables Heartbeats section (no explicit toggle needed)
- All existing tests pass with default config (backward compatible)

## PR / Links

- Related: task.0053 (token optimization — workaround via SOUL.md overrides until this lands)
- OpenClaw source: `src/agents/system-prompt.ts`
- OpenClaw repo: https://github.com/cogni-dao/openclaw

## Attribution

-
