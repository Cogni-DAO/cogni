---
id: task.0267
type: task
title: "Mobile streaming AI chat screen using @cogni/node-contracts"
status: needs_implement
priority: 2
rank: 4
estimate: 3
summary: "Build the core chat screen with streaming SSE responses, message history, and model selection. Uses @cogni/node-contracts for typed API requests."
outcome: "Users can chat with AI agents on mobile with real-time streaming text. Messages persist across app restarts via thread API."
spec_refs: []
assignees: derekg1729
credit:
project: proj.mobile-app
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0266]
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
---

# Mobile streaming AI chat screen using @cogni/node-contracts

## Goal

The primary screen. Streaming AI chat with the same backend API the web app uses.

## Implementation Plan

- [ ] Install `react-native-sse`, `eventsource-parser`
- [ ] Create typed API client using `@cogni/node-contracts` Zod schemas for request/response validation
- [ ] Build chat screen: message list (FlatList), composer input, send button
- [ ] Implement SSE streaming: connect to `/api/v1/ai/chat`, parse chunks, append to message state
- [ ] Thread management: list threads (`/api/v1/ai/threads`), create thread, switch threads
- [ ] Model selection: fetch available models (`/api/v1/ai/models`), persist preference
- [ ] Keyboard-aware layout (KeyboardAvoidingView)
- [ ] Auto-scroll to bottom on new messages
- [ ] Loading/error states for stream connection

## Validation

```bash
# Manual: send a message, verify streaming response appears token-by-token
# Manual: switch threads, verify history loads
# Manual: test on iOS and Android simulators
```
