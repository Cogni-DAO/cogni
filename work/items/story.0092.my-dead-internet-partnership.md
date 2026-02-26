---
id: story.0092
type: story
title: My Dead Internet Partnership — Agent Collective Integration
status: needs_triage
priority: 1
rank: 99
estimate: 5
summary: Partner with My Dead Internet (MDI) — 299+ AI agent collective — as a reference implementation for AI-native DAO infrastructure, providing launchpad services and OpenClaw API access for agent spawning and coordination.
outcome: MDI uses CogniDAO launchpad to spawn specialized sub-agents, OpenClaw skill enables any MDI agent to tap into CogniDAO APIs, and <@1472841000530739200> joins the MDI collective as a participating agent.
spec_refs:
assignees:
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-26
updated: 2026-02-26
labels: [partnership, mdi, agents, launchpad, openclaw]
external_refs:
  - https://mydeadinternet.com
  - https://discord.com/channels/@me/1475984878083244102 (DM thread with SnappedAI)
---

# My Dead Internet Partnership — Agent Collective Integration

## Requirements

<!-- What must be true when this is done? Be specific. -->

- **Launchpad Integration:** MDI can spawn new specialized sub-agents via CogniDAO's USDC-to-credits launchpad without friction
- **Agent Services:** Langgraph agents exposed as customer-facing services that MDI agents can consume
- **OpenClaw Skill:** Build an OpenClaw skill enabling any MDI agent to tap into CogniDAO's API programmatically
- **Collective Membership:** <@1472841000530739200> joins the MDI collective as a participating agent
- **Reference Implementation:** MDI serves as a reference implementation of an AI-native niche DAO using CogniDAO infrastructure
- **Distribution Channels:** Integration surfaces through OpenClaw, 4claw, Farcaster, and MoltX
- **Feedback Loop:** Real usage from MDI's 299+ agents provides product feedback and validation
- **Documentation:** Clear docs for other agent collectives to replicate the integration pattern

## Allowed Changes

<!-- What files/areas may this item touch? Scope boundaries. -->

- OpenClaw skills/plugins for MDI API integration
- Launchpad agent spawning APIs and documentation
- Customer-facing Langgraph agent service interfaces
- Partnership documentation and reference architecture
- Discord/communication channels for agent-to-agent coordination
- Marketing/distribution materials featuring MDI as reference partner

## Plan

<!-- Step-by-step execution plan. -->

- [ ] **Kickoff call** with SnappedAI (Connor/Kai) to align on integration details and timeline
- [ ] **Technical scoping** — define exact API contracts for launchpad agent spawning
- [ ] **OpenClaw skill design** — schema for MDI → CogniDAO API calls
- [ ] **Launchpad access** — provision MDI with appropriate credits/rate limits for testing
- [ ] **Build OpenClaw skill** — implement and test the skill in MDI's environment
- [ ] **Agent onboarding** — onboard <@1472841000530739200> to MDI collective with proper credentials
- [ ] **Reference docs** — create documentation for other agent collectives to follow
- [ ] **Public announcement** — coordinated launch across both communities

## Validation

<!-- Name exact commands/tests and expected outcome. -->

**Command:**

```bash
# Test MDI agent spawning via launchpad
openclaw agent spawn --template mdi-subagent --config test-config.yaml

# Test OpenClaw skill API access
openclaw skill invoke cogni-dao --agent mdi-test-agent --action getCredits
```

**Expected:** 
- Sub-agent spawns successfully with MDI-specific configuration
- OpenClaw skill returns valid CogniDAO API responses
- <@1472841000530739200> appears in MDI collective roster

## Review Checklist

<!-- All required before status=done. -->

- [ ] **Work Item:** `story.0092` linked in PR body
- [ ] **Spec:** all invariants of linked specs (here, or project) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

<!-- PR URL and any related links. -->

- MDI Website: https://mydeadinternet.com
- SnappedAI (Kai) — MDI lead agent

## Attribution

<!-- Credit contributors. -->

- **Partnership proposal:** SnappedAI (Kai) / Connor — My Dead Internet collective
- **CogniDAO liaison:** Derek
