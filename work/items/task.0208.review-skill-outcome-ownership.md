---
id: task.0208
type: task
title: "Enhance /review-implementation for outcome ownership"
status: needs_design
priority: 0
rank: 2
estimate: 2
summary: "Evolve /review-implementation skill from 'leave a comment' to 'drive PR to merge or rejection'. Add CI fix loop (read error → push fix → wait), stale PR follow-up, and merge/reject decision with rationale."
outcome: "Git Reviewer agent receiving a needs_merge work item follows a playbook that: reviews quality gates, attempts to fix CI failures (max 3 iterations), follows up on stale review threads, and either merges (if all gates pass + approved) or rejects with documented rationale. Escalates to CEO after 48h stale."
spec_refs:
  - agent-roles
  - development-lifecycle
assignees:
  - derekg1729
project: proj.agent-workforce
branch:
pr:
reviewer:
revision: 1
blocked_by: task.0207
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [agents, governance, pr-review, workforce]
---

# Enhance /review-implementation for Outcome Ownership

## Context

The current `/review-implementation` skill reviews PRs and posts comments. The Git Reviewer role needs a skill that **owns the outcome** — driving PRs to merge or rejection, not just commenting.

This is a skill (playbook) enhancement, not a Role schema change. Per the `SKILL_OWNS_OUTCOME` invariant: role quality comes from skill quality.

## Design

### Outcome

The `/review-implementation` skill evolves from "review and comment" to a full PR lifecycle playbook with explicit decision points and iteration.

### Approach

**Solution**: Extend the existing SKILL.md with additional phases for CI fixing, follow-up, and merge/reject decisions.

**Reuses**: Existing cogni-git-review quality gates. Existing GitHub API (merge, comment). Existing OpenClaw brain delegation.

**Rejected**:

- "Separate /merge-pr skill" — unnecessary. Review and merge are one lifecycle, one playbook.
- "Automated merge without approval" — too risky. Agent gets PR to merge-ready, human clicks merge (crawl). Walk phase may add auto-merge with governance vote.

### Playbook Flow

```
1. ASSESS
   - Read PR diff, CI status, existing reviews
   - Classify: feature | bugfix | dependency | docs | refactor

2. REVIEW
   - Run quality gates (existing cogni-git-review rules)
   - Check: tests added? types clean? architecture aligned?
   - If APPROVE: proceed to step 4
   - If REQUEST CHANGES: proceed to step 3

3. FIX (max 3 iterations)
   - If CI failure: read error, push fix commit, wait for CI
   - If review feedback: address comments, push, wait
   - If still failing after 3 iterations: escalate to author with summary
   - Loop back to step 2

4. MERGE DECISION
   - Gates pass + at least 1 approval → merge
   - Gates pass + no approval → request review from maintainer
   - Gates fail after iterations → reject with rationale
   - Stale > 48h → escalate to CEO role via Discord

5. CLOSE
   - Update work item status (done or needs_implement for revisions)
   - Post summary to Discord
```

### Invariants

- [ ] MAX_FIX_ITERATIONS: Agent attempts at most 3 fix cycles before escalating
- [ ] HUMAN_MERGE_GATE: Crawl phase requires human approval before merge. Agent gets to merge-ready.
- [ ] ESCALATION_ON_STALE: Items with no activity > 48h trigger notification to escalateToRole
- [ ] RATIONALE_ON_REJECT: Every rejection includes documented reasoning (not just "CI fails")
- [ ] NO_FORCE_PUSH: Agent never force-pushes. Only additive commits.

### Files

- Modify: `.openclaw/skills/review-implementation/SKILL.md` — add Fix, Merge Decision, and Close phases
- Test: manual validation on a real PR in staging

## Validation

- [ ] Skill reviews a PR and posts structured feedback (not just "LGTM")
- [ ] On CI failure: agent pushes fix commit and waits for CI (max 3 iterations)
- [ ] On persistent failure: agent escalates with summary instead of looping
- [ ] Rejection includes documented rationale
- [ ] Agent never force-pushes
