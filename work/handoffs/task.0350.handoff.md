---
id: task.0350
type: task
title: Generate version strings and changelogs on merge
status: backlog
priority: low
created: 2026-04-22
updated: 2026-04-22
---

# Task: Generate version strings and changelogs on merge

## Context

- `/version` endpoint returns `"version": "unknown"`
- No changelog generation exists — just commitlint + squash merge to main
- PR #978 flight revealed we don't actually produce version strings

## Requirements

- Generate semver version on merge to main (likely from conventional commits or a version file)
- Produce changelog from squash-merged commits
- Surface in `/version` endpoint

## Related: commitlint on auto-commits

- Flight workflow auto-commits overlays to `deploy/candidate-a` — these must pass commitlint too
- Argo image updater auto commits to main — must pass commitlint

## Notes

- We do commitlint + squash merge already
- Could derive version from `conventional-changelog` or similar
