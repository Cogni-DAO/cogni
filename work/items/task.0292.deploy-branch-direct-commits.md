---
id: task.0292
type: task
title: "Deploy branches: switch preview/production to direct commits (kill PR noise)"
status: done
priority: 0
rank: 1
estimate: 1
summary: "promote-and-deploy.yml creates auto-merge PRs for preview/production deploy branches. Canary already uses direct push. Extend direct-commit pattern to all envs — PRs add no value for machine-written deploy state."
outcome: "All three deploy branches (canary, preview, production) updated via direct bot commits. No PR noise on deploy/* branches. Git history is the audit trail."
spec_refs: [ci-cd-spec]
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr_url:
created: 2026-04-05
updated: 2026-04-06
labels: [ci-cd, deploy]
---

# Deploy branches: direct commits for all envs

## Context

`promote-and-deploy.yml` has two code paths for updating deploy branches:

- **Canary**: direct push (line ~222) — already working, no PR noise
- **Preview/production**: create PR + auto-merge (lines ~235-255) — unnecessary noise

Deploy branches are machine-written overlay state (image digests, EndpointSlice IPs). PRs add no review value. Git history provides the audit trail.

## Changes

1. In `promote-and-deploy.yml`, extend the canary direct-push pattern to preview and production
2. Remove the PR creation + auto-merge logic for non-canary envs
3. Keep the commit message format (provides audit trail in `git log`)

## Validation

1. Push to canary → promote-and-deploy fires → deploy/canary updated via direct commit (existing)
2. Dispatch for preview → deploy/preview updated via direct commit (new)
3. No PRs created on deploy/\* branches
4. Argo CD still syncs correctly (watches branch HEAD, not PR merge events)
