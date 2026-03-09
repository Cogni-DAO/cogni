---
id: task.0079
type: task
title: "Create bot-generated Discord invite link for website"
status: needs_design
priority: 2
estimate: 1
summary: "Current Discord invite link (discord.gg/3b9sSyhZ4z) is tied to a personal user account, showing 'derekg1729 invited you'. Create a bot-generated invite link so the inviter is the Cogni bot instead of a personal account. Alternatively, set up a vanity URL (discord.gg/cogni) if the server reaches Boost Level 1."
outcome: "Website Discord links use a bot-generated or vanity invite URL with no personal user attribution."
spec_refs: []
assignees: []
credit:
project:
branch:
pr:
created: 2026-02-17
updated: 2026-02-17
revision: 0
blocked_by:
deploy_verified: false
rank: 14
---

## Context

The homepage, header, and mobile nav all link to Discord. The current invite link shows the creating user's name in the join prompt. A bot-generated invite or vanity URL would be more professional.

## Options

1. **Bot invite** — Use a bot with "Create Instant Invite" permission to generate the link via `POST /channels/{channel_id}/invites`
2. **Vanity URL** — Requires Server Boost Level 1 (2 boosts). Set in Server Settings > Vanity URL.

## Validation

- [ ] Discord invite link on homepage, header, and mobile nav does not show a personal user as inviter
- [ ] Link works for new users (join flow) and existing members (opens server directly)
