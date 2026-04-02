---
id: task.0242
type: task
title: "VCS tool plane + PR Manager agent"
status: needs_merge
priority: 0
rank: 1
estimate: 3
summary: "Add VcsCapability (listPrs, getCiStatus, mergePr, createBranch) with Octokit adapter. Create PR Manager agent graph with KPI-driven prompt and evolving playbook. Establish agent design paradigm: thin prompts + domain playbooks."
outcome: "Agents can read and manage GitHub PRs via typed tools. PR Manager runs on 15min cron, merges green PRs, reports KPIs. Agent design guide codifies the paradigm for all future agents."
spec_refs:
assignees: derekg1729
credit:
project: proj.agentic-project-management
branch: worktree-floating-wondering-bear
pr: "https://github.com/Cogni-DAO/node-template/pull/687"
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [ai-tools, vcs, agents, pr-manager]
external_refs:
---

# VCS Tool Plane + PR Manager Agent

## What Changed

### 1. VcsCapability + 4 AI Tools (`@cogni/ai-tools`)

- `VcsCapability` interface in `capabilities/vcs.ts` — listPrs, getCiStatus, mergePr, createBranch
- `core__vcs_list_prs` (read_only) — list open PRs with metadata
- `core__vcs_get_ci_status` (read_only) — PR detail + check runs + review status
- `core__vcs_merge_pr` (state_change) — merge a PR with method selection
- `core__vcs_create_branch` (state_change) — create branch from any ref
- All tools registered in TOOL_CATALOG, exported from barrel

### 2. GitHub Octokit Adapter (`apps/operator`)

- `GitHubVcsAdapter` in `adapters/server/vcs/github-vcs.adapter.ts`
- Uses `@octokit/auth-app` for GitHub App JWT + installation token management
- Installation ID resolved dynamically per owner/repo, cached
- Bootstrap factory in `bootstrap/capabilities/vcs.ts` — graceful stub if unconfigured
- Wired into container.ts → tool-bindings.ts

### 3. PR Manager Agent Graph (`@cogni/langgraph-graphs`)

- Registered as `langgraph:pr-manager` in catalog
- Thin prompt: identity + 2 KPIs + capabilities + playbook pointer
- Reads evolving playbook via `core__repo_open` at runtime
- Tool set: repo_open + 4 VCS tools + work_item_query
- Reuses `createOperatorGraph` factory (ReAct agent)

### 4. Agent Design Paradigm (docs/guides)

- `agent-design.md` — meta-guide: agents are thin prompts with KPIs, data streams, triggers, playbook pointers
- `pr-management-playbook.md` — evolving operational guide for PR Manager (merge gates, PR type handling, escalation, patterns log)
- Documents `.md → Dolt` migration path for playbooks

### 5. GitHub App Permissions (docs/guides)

- Updated `github-app-webhook-setup.md`: Contents → Read & Write, Actions → Read & Write (for merge, branch creation, future workflow triggers)

## Validation

```bash
pnpm packages:build  # all 21 packages build
pnpm check:fast      # typecheck + lint + format + tests pass
```

## PR / Links

- PR: (pending)
- Plan: `.claude/plans/dreamy-tickling-dragonfly.md`
