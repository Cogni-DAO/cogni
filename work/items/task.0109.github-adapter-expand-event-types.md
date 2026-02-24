---
id: task.0109
type: task
title: "Expand GitHub adapter — PR comments, review comments, issue creation"
status: needs_triage
priority: 2
rank:
estimate: 2
summary: "Add pr_comment, review_comment, and issue_opened streams to the GitHub source adapter. The current 3 event types (pr_merged, review_submitted, issue_closed) systematically miss review feedback and triage work."
outcome: "GitHub adapter collects 6 event types. Review-heavy and triage-heavy contributors have their activity captured in the collection layer."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-24
updated: 2026-02-24
labels: [governance, ledger, ingestion]
external_refs:
---

# Expand GitHub Adapter Event Types

## Problem

The GitHub adapter collects exactly 3 event types: `pr_merged`, `review_submitted`, `issue_closed`. This systematically undervalues:

- **Code review feedback**: Detailed PR comments and review comments are invisible. A rubber-stamp approval and a 3-round deep review look identical.
- **Triage work**: Filing well-described bug reports (issue creation) generates no events.
- **Discussion**: PR-level comments (not part of a formal review) are uncaptured.

The collection layer predetermines the ceiling of what the valuation layer can recognize. No weight policy can credit work that was never collected.

## New Streams

| Stream            | Event Type       | Deterministic ID                                    | Cursor Field |
| ----------------- | ---------------- | --------------------------------------------------- | ------------ |
| `pr_comments`     | `pr_comment`     | `github:pr_comment:{owner}/{repo}:{comment_id}`     | `createdAt`  |
| `review_comments` | `review_comment` | `github:review_comment:{owner}/{repo}:{comment_id}` | `createdAt`  |
| `issues_opened`   | `issue_opened`   | `github:issue_opened:{owner}/{repo}:{issue_number}` | `createdAt`  |

## Scope

- [ ] Add GraphQL fragments for PR comments (`pullRequest.comments`), review comments (`pullRequest.reviews.comments`), and issue creation
- [ ] Add 3 new stream definitions to `GitHubAdapter.streams()`
- [ ] Map to `ActivityEvent` with deterministic IDs and payload hashes
- [ ] Metadata: comment body length (not content — privacy), associated PR/issue number
- [ ] Bot filtering: same `__typename == "User"` check
- [ ] Unit tests: deterministic IDs, pagination, bot filtering for new streams

## Validation

```bash
pnpm check
pnpm --filter scheduler-worker build
pnpm test tests/unit/adapters/ingestion/
```

- [ ] 3 new stream definitions in `GitHubAdapter.streams()`
- [ ] Deterministic IDs for all new event types
- [ ] Unit tests for pagination, bot filtering, deduplication

## Research

- [Gap Analysis](../../docs/research/ledger-collection-gap-analysis.md) — section 2c
