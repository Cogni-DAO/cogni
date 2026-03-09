---
id: task.0097
type: task
title: "GitHub + Discord source adapters for epoch activity collection"
status: done
priority: 1
rank: 3
estimate: 3
summary: "Implement SourceAdapter port interface and two adapters (GitHub, Discord) that collect contribution activity and normalize to ActivityEvent. Uses @octokit/graphql and discord.js."
outcome: "GitHub PRs/reviews and Discord messages collected automatically during epoch collection. Events have deterministic IDs, provenance fields, and platform identity for resolution."
spec_refs: [epoch-ledger-spec, vcs-integration]
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: worktree-ingestion-core-github-adapter
pr: https://github.com/Cogni-DAO/node-template/pull/458
reviewer:
revision: 0
blocked_by: task.0089, task.0094
deploy_verified: false
created: 2026-02-21
updated: 2026-02-22
labels: [governance, ledger, ingestion]
external_refs:
---

# GitHub + Discord Source Adapters

## Requirements

- `SourceAdapter` port at `src/ports/source-adapter.port.ts` with:
  - `collect({ streams, cursor, window, limit })` → `{ events: ActivityEvent[], nextCursor }`
  - `streams()` → `StreamDefinition[]`
  - Optional `handleWebhook(payload)` → `ActivityEvent[]` (deferred to P1)
  - `ActivityEvent` type with deterministic ID, provenance fields, platform identity (3-field split)
  - `StreamDefinition` with cursorType and defaultPollInterval
  - `StreamCursor` with streamId, value, retrievedAt

- GitHub adapter in `services/scheduler-worker/src/adapters/ingestion/github.ts`:
  - Uses `@octokit/graphql` for efficient data fetching (1 request replaces ~11 REST calls)
  - Streams: `pull_requests` (merged PRs), `reviews` (submitted reviews), `issues` (closed issues)
  - Deterministic event IDs: `github:pr:{owner}/{repo}:{number}`, `github:review:{owner}/{repo}:{pr}:{reviewId}`, `github:issue:{owner}/{repo}:{number}`
  - Platform identity: `platform_user_id` = GitHub numeric ID, `platform_login` = GitHub username
  - `payload_hash` = SHA-256 of canonical JSON (sorted keys of relevant fields)
  - Cursor: timestamp-based (last event time)
  - Scope: configured repo list (e.g., `cogni-dao/cogni-template`)

- Discord adapter in `services/scheduler-worker/src/adapters/ingestion/discord.ts`:
  - Uses `discord.js` for message fetching
  - Streams: `messages` (messages in configured channels)
  - Deterministic event IDs: `discord:message:{guildId}:{channelId}:{messageId}`
  - Platform identity: `platform_user_id` = Discord snowflake, `platform_login` = Discord username
  - Cursor: snowflake-based (Discord message ID is chronologically sortable)
  - Scope: configured guild + channel list

- Both adapters:
  - Handle pagination and rate limits gracefully
  - Return provenance fields: `producer`, `producer_version`, `payload_hash`, `retrieved_at`
  - Produce CloudEvents-compatible envelopes using `cloudevents` npm package
  - Live in `services/scheduler-worker/` (ADAPTERS_NOT_IN_CORE)

## Allowed Changes

- `src/ports/source-adapter.port.ts` (new)
- `src/ports/index.ts` (add export)
- `services/scheduler-worker/src/adapters/ingestion/github.ts` (new)
- `services/scheduler-worker/src/adapters/ingestion/discord.ts` (new)
- `services/scheduler-worker/src/adapters/ingestion/index.ts` (new barrel)
- `services/scheduler-worker/package.json` (add `@octokit/graphql`, `discord.js`, `cloudevents` deps)
- `tests/unit/adapters/ingestion/` (new unit test files)

## Plan

- [x] Define `SourceAdapter`, `ActivityEvent`, `StreamDefinition`, `StreamCursor` types in `@cogni/ingestion-core` package
- [x] Wire port re-exports into `src/ports/source-adapter.port.ts`
- [x] Implement GitHub adapter with GraphQL queries for PRs, reviews, issues
- [x] Add unit tests: 13 helper tests + 22 adapter tests (deterministic IDs, hashing, pagination, rate limits, bot filtering)
- [ ] Create Review GitHub App (contents:read, PRs:read, issues:read), install on Cogni-DAO/test-repo
- [ ] Add `InstallationTokenProvider` in scheduler-worker (sign JWT → POST /installations/{id}/access_tokens → cache until expiry)
- [ ] Wire provider as default auth; gate PAT behind `GITHUB_AUTH=pat` env flag
- [ ] Add env vars: `REVIEW_APP_ID`, `REVIEW_APP_PRIVATE_KEY`, `REVIEW_INSTALLATION_ID`
- [ ] Implement Discord adapter with message fetching
- [ ] Add adapter registry/factory for workflow to iterate registered adapters

## Validation

**Command:**

```bash
pnpm check
pnpm --filter scheduler-worker build
pnpm test tests/unit/adapters/ingestion/
```

**Expected:** Types pass, worker builds, unit tests green.

## Review Checklist

- [ ] **Work Item:** `task.0097` linked in PR body
- [ ] **Spec:** ACTIVITY_IDEMPOTENT (deterministic IDs), PROVENANCE_REQUIRED (all fields present), ADAPTERS_NOT_IN_CORE, CURSOR_STATE_PERSISTED (cursor returned)
- [ ] **Tests:** unit tests for ID determinism, pagination handling, cursor logic
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0097.handoff.md)

## Attribution

-
