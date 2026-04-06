---
id: spike.0263
type: spike
title: "Spike: agent contributor protocol — communication mechanism + workflow design"
status: needs_research
priority: 1
rank: 99
estimate: 3
summary: "Research and design the communication mechanism and workflow protocol for multi-agent coordination. Evaluate git-native vs GitHub-native vs event bus. Produce a protocol spec."
outcome: "A protocol spec (docs/spec/agent-contributor-protocol.md) with: state machine, message formats, communication mechanism decision, structured review feedback format, and external agent onboarding flow."
spec_refs: []
assignees: derekg1729
credit:
project: proj.development-workflows
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
labels: [infrastructure, agents, protocol, research]
external_refs:
---

# Spike: agent contributor protocol — communication mechanism + workflow design

Parent: story.0262

## Research Questions

1. **Communication mechanism**: Which approach gives the best latency/infrastructure trade-off for agent-to-agent signaling?
   - Git-native (work item frontmatter + `git fetch` polling)
   - GitHub-native (PR labels, check runs, `gh` CLI)
   - Event bus (Redis pub/sub, workflow_dispatch, webhook relay)
   - Hybrid (git-native for state, GitHub for notifications)

2. **Structured review feedback**: What format lets a reviewing agent post feedback that an implementing agent can parse and act on without human interpretation?
   - JSON in PR comment (fenced code block)
   - GitHub check run annotations (file:line granularity)
   - Structured comment with markdown headings (current `/review-implementation` output)
   - Machine-readable section in work item file

3. **Task claiming / conflict prevention**: How do agents avoid working on the same task?
   - Work item `assignees` field + branch naming convention
   - GitHub issue assignment
   - Lock file in `.cogni/claims/`
   - Optimistic: branch existence = claim

4. **External agent trust model**: How does the review agent distinguish trusted internal agents from external contributors?
   - GitHub actor identity (bot accounts, app installations)
   - Signed commits
   - PR label-based trust tiers
   - `.cogni/contributors.yaml` allowlist

5. **Existing art**: What do other multi-agent coding systems use?
   - SWE-bench harness protocol
   - Devin's task API
   - GitHub Copilot Workspace's plan→implement→review flow
   - OpenAI's Codex task queue model
   - Claude Code's `RemoteTrigger` / scheduled agents

## Allowed Changes

- `docs/spec/agent-contributor-protocol.md` — the output spec
- `work/items/` — update story.0262 with findings

## Plan

- [ ] Audit current workflow: trace exactly what the human did during the task.0248 multi-agent session (this conversation is the primary source)
- [ ] Evaluate communication mechanisms against criteria: latency, infrastructure cost, agent compatibility (Claude Code, Codex, custom), failure modes
- [ ] Prototype GitHub-native approach: agent creates PR with structured summary → review agent triggered → posts structured feedback → implementing agent polls
- [ ] Design structured review feedback format
- [ ] Design external contributor onboarding (what goes in CLAUDE.md)
- [ ] Write protocol spec
- [ ] Update story.0262 with recommended approach

## Validation

- Protocol spec covers all 5 research questions with concrete recommendations
- At least one mechanism prototyped end-to-end (agent submit → review → feedback retrieval)

## PR / Links

- Parent: story.0262 (agent contributor protocol)
- Related: task.0242 (VCS tool plane), story.0091 (manager agent)
- Primary research source: this conversation (task.0248 multi-agent coordination session)

## Attribution

-
