---
id: task.0238
type: task
title: "Agent avatars — Rive/Lottie animated characters on run cards and chat"
status: needs_design
priority: 2
rank: 2
estimate: 3
summary: "Add animated 2D agent avatars using Rive or Lottie. Each graph/agent type gets a character with idle/thinking/working/done state animations. Displayed on RunCards and in chat."
outcome: "Agent types have unique animated avatars that react to run status. Avatars show idle when pending, thinking animation when processing, working animation during tool use, checkmark on done."
spec_refs:
assignees: []
credit:
project: proj.premium-frontend-ux
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [ui, design, agents]
external_refs:
---

# Agent Avatars — Rive/Lottie Animated Characters

## Requirements

1. Evaluate Rive vs Lottie for agent avatars (size, GPU perf, state machine support)
2. Define avatar state machine: idle → thinking → tool_use → done / error
3. Create or source placeholder avatar assets (at least 1 generic agent character)
4. Integrate avatar component into RunCard (replaces status dot for running cards)
5. Integrate avatar into chat (small avatar next to status line)

## Allowed Changes

- `apps/operator/src/components/kit/data-display/AgentAvatar.tsx` — new component
- `apps/operator/src/components/kit/data-display/RunCard.tsx` — add avatar slot
- `apps/operator/public/assets/agents/` — avatar asset files
- `package.json` — add Rive or Lottie runtime dependency

## Plan

- [ ] Spike: evaluate Rive vs Lottie (Rive preferred for state machines)
- [ ] Source/create placeholder agent avatar with 4 states
- [ ] Build AgentAvatar component with state machine input
- [ ] Wire into RunCard and chat StatusLine
- [ ] Performance test on mobile

## Validation

```bash
pnpm check:fast
```
