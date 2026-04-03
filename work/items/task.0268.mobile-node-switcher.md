---
id: task.0268
type: task
title: "Node-switcher — multi-backend support in mobile app"
status: needs_implement
priority: 2
rank: 5
estimate: 2
summary: "Add node management: add/remove nodes by URL, switch active node, persist node list. Theme adapts to active node's color."
outcome: "Users can connect to multiple Cogni nodes from one app. Switching nodes changes the active API base URL and theme."
spec_refs: []
assignees: derekg1729
credit:
project: proj.mobile-app
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0267]
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
---

# Node-switcher — multi-backend support in mobile app

## Goal

One app, many nodes. Users add Cogni nodes by URL and switch between them.

## Implementation Plan

- [ ] Create `NodeContext` provider: `{ activeNode, nodes, addNode, removeNode, switchNode }`
- [ ] Node model: `{ url: string, name: string, themeColor: string }`
- [ ] Persist node list in AsyncStorage
- [ ] Add node flow: enter URL → fetch `/openapi.json` to validate → extract node name → save
- [ ] Settings screen: list nodes, swipe to delete, tap to switch
- [ ] API client reads base URL from `NodeContext`
- [ ] Theme adapts to `activeNode.themeColor` (status bar, headers, accent)
- [ ] Default node: operator URL pre-configured
- [ ] Auth is per-node: store JWT per node URL in SecureStore

## Validation

```bash
# Manual: add operator + poly nodes, switch between them, verify API calls target correct backend
# Manual: verify auth state is independent per node
```
