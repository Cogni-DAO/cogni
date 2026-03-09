---
id: spike.0020
type: spike
title: Research messenger integration via OpenClaw channels
status: done
priority: 1
estimate: 1
summary: Investigate leveraging OpenClaw's channel plugin system for WhatsApp/Telegram/etc tenant integrations vs building custom connectionId-based messenger adapters
outcome: Research document with architecture recommendation and proposed project layout
spec_refs:
  - tenant-connections
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
assignees:
  - cogni-dev
credit:
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels:
  - messenger
  - openclaw
  - research
external_refs:
  - docs/research/messenger-integration-openclaw-channels.md
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Research: Messenger Integration via OpenClaw Channels

## Question

How can Cogni maximize OpenClaw's existing channel/messaging infrastructure for tenant messenger integrations (WhatsApp, Telegram, etc.)? Do we need to build our own connectionId plan, or can we leverage OpenClaw's channel plugin system? What does v0 WhatsApp look like?

## Key Findings

1. **OpenClaw already has 15+ channel plugins** — WhatsApp (Baileys), Telegram, Discord, Slack, Signal, iMessage, MS Teams, Matrix, LINE, Mattermost, and more. Full multi-account support, unified message routing, QR login flows.

2. **We should leverage OpenClaw's channels, not build our own.** Building custom WhatsApp/Telegram adapters would duplicate what OpenClaw already provides. The channel plugin system is battle-tested and extensible.

3. **The connectionId plan IS needed** — but extended for messenger channels (`provider: "openclaw:whatsapp"`, `credential_type: "channel_session"`). Same AEAD encryption, same tenant scoping. Channel credentials (Baileys auth state, bot tokens) stored in the existing `connections` table design.

4. **v0: WhatsApp via Baileys** — OpenClaw's `web` channel, unofficial protocol, QR code auth. No Meta verification needed. Accept ToS risk for internal/DAO use. Zero WhatsApp-specific code to write.

5. **v0 architecture: OpenClaw-native agent** — OpenClaw handles full conversation loop. Cogni provides LLM proxy (billing), channel config persistence, and management UI. Defer Cogni-mediated message handling to v1.

## Validation

- [x] Research document written: `docs/research/messenger-integration-openclaw-channels.md`
- [x] OpenClaw channel plugin system explored (15+ channels identified)
- [x] WhatsApp integration options evaluated (Baileys, Cloud API, Evolution API)
- [x] Multi-messenger abstraction landscape surveyed
- [x] Architecture recommendation made (leverage OpenClaw, extend connections table)
- [x] Proposed project layout included in research doc

## Research Document

See [docs/research/messenger-integration-openclaw-channels.md](../../docs/research/messenger-integration-openclaw-channels.md) for full findings, trade-off analysis, and proposed project layout.
