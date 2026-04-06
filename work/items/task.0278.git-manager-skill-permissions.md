---
id: task.0278
type: task
title: "Git manager skill + GitHub App permissions for AI branch operations"
status: needs_design
priority: 1
rank: 3
estimate: 3
summary: "Skill for AI agents to manage branches, PRs, and merges. Replace PAT-based automation with GitHub App installation tokens. Scope: contents:write, pull-requests:write, actions:read. No admin, no secrets access."
outcome: "AI agents can create branches, push commits, create/merge PRs, and manage the multi-node integration flow via skill commands. GitHub App token replaces fragile PAT."
spec_refs: []
assignees: []
credit:
project: proj.agentic-dev-setup
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-03
updated: 2026-04-03
labels: [skill, git, permissions, agentic-dev]
external_refs:
---

# Git Manager Skill + Permissions

## Problem

Today's branch management is manual or PAT-based:

- `ACTIONS_AUTOMATION_BOT_PAT` is a personal token (expires, tied to one account, broad scope)
- AI agents can't create PRs, merge branches, or manage the integration flow without human intervention
- The existing `git-branch-feature-coordinator` skill exists but doesn't have proper GitHub permissions

## Deliverables

### 1. GitHub App permissions (replace PAT)

Replace `ACTIONS_AUTOMATION_BOT_PAT` with GitHub App installation token:

- Use existing `GH_REVIEW_APP_ID` + `GH_REVIEW_APP_PRIVATE_KEY_BASE64` pattern
- Permissions: contents:write, pull-requests:write, actions:read
- NOT: admin, settings, secrets

### 2. Git manager skill operations

| Operation             | Command                                                       | Permission needed   |
| --------------------- | ------------------------------------------------------------- | ------------------- |
| Create feature branch | `/git-manager branch feat/xyz`                                | contents:write      |
| Create PR             | `/git-manager pr --base integration/multi-node`               | pull-requests:write |
| Merge PR              | `/git-manager merge #710`                                     | contents:write      |
| Rebase branch         | `/git-manager rebase feat/xyz onto integration/multi-node`    | contents:write      |
| Cherry-pick           | `/git-manager cherry-pick abc123 onto integration/multi-node` | contents:write      |
| Close stale PR        | `/git-manager close #709 --comment "merged via cherry-pick"`  | pull-requests:write |

### 3. Integration with CI/CD

- After merge, skill checks if CI triggered
- Reports build status back to the agent
- On build failure, dumps failure logs for diagnosis

## Related

- Existing skill: `.claude/commands/git-branch-feature-coordinator`
- Existing app: GH_REVIEW_APP_ID (PR review bot)
- proj.agentic-dev-setup — parent project for agent tooling

## Validation

- [ ] Work item triaged and assigned
