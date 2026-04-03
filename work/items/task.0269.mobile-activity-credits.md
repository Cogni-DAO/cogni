---
id: task.0269
type: task
title: "Mobile activity dashboard + credits screens"
status: needs_implement
priority: 2
rank: 6
estimate: 2
summary: "Build activity feed and credit balance screens consuming existing /api/v1/activity and /api/v1/payments/credits/summary endpoints."
outcome: "Users see their AI usage activity and credit balance on mobile."
spec_refs: []
assignees: derekg1729
credit:
project: proj.mobile-app
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0268]
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
---

# Mobile activity dashboard + credits screens

## Goal

Activity and credits visibility on mobile — the secondary screens after chat.

## Implementation Plan

- [ ] Activity screen: fetch `/api/v1/activity`, display as timeline list
- [ ] Credits screen: fetch `/api/v1/payments/credits/summary`, show balance
- [ ] Pull-to-refresh on both screens
- [ ] Skeleton loading states
- [ ] Empty states for new users (no activity, no credits)
- [ ] Navigate to activity detail (model, cost, duration) on tap

## Validation

```bash
# Manual: verify activity loads from active node, credits display correctly
# Manual: pull-to-refresh works, empty states display for new accounts
```
