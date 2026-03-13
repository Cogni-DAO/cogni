---
id: task.0159
type: task
title: "Broadcasting Crawl — core domain, schema, workflow, and X adapter"
status: needs_implement
priority: 1
rank: 1
estimate: 5
summary: Vertical slice delivering the full broadcast pipeline (draft → optimize → review → publish) with X/Twitter as the first platform adapter. Establishes broadcast-core package, 2-table schema, Drizzle adapters, Temporal workflow, API contracts + routes.
outcome: A ContentMessage can be created via API, AI-optimized for X, reviewed via Temporal Signal, and published to X/Twitter. The pipeline is end-to-end functional with one adapter.
spec_refs:
  - broadcasting-spec
assignees:
  - derekg1729
credit:
project: proj.broadcasting
branch: claude/research-broadcasting-integration-8p2DB
pr:
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13

labels: [broadcasting, x-twitter, temporal, crawl]
external_refs:
---

# Broadcasting Crawl — core domain, schema, workflow, and X adapter

## Context

This is the foundational Crawl (P0) task for [proj.broadcasting](../projects/proj.broadcasting.md). It delivers a vertical slice: everything needed to draft a content message, optimize it for X/Twitter, gate it through human review, and publish it. Discord and Bluesky adapters follow as lightweight tasks once this foundation lands.

**Governing spec:** [docs/spec/broadcasting.md](../../docs/spec/broadcasting.md)

## Requirements

1. **`packages/broadcast-core`** — new package exporting domain types, enums, port interfaces, error classes, and pure rule functions. No I/O. Mirrors `@cogni/scheduler-core` structure.
2. **`packages/db-schema/src/broadcasting.ts`** — 2 Drizzle tables (`content_messages`, `platform_posts`) with RLS, matching the Crawl schema in the spec. Barrel-exported from `packages/db-schema`.
3. **`packages/db-client`** — Drizzle adapters implementing `BroadcastLedgerUserPort` (appDb, RLS) and `BroadcastLedgerWorkerPort` (serviceDb). Follow `withTenantScope` pattern from existing adapters.
4. **X/Twitter `PublishPort` adapter** — in `services/scheduler-worker/src/adapters/broadcast/`. OAuth 2.0 bearer token, `POST /2/tweets`, `DELETE /2/tweets/:id`. Health check via token validation.
5. **`ContentOptimizerPort` basic implementation** — LLM-based optimization via `GraphExecutorPort`. Produces platform-formatted body for X (280 chars, hashtags, thread splitting if over limit).
6. **`broadcastWorkflow` Temporal workflow** — orchestrates: optimize → assess risk → review gate (Signal) → publish. Activities for each I/O step. Signal handler for `review-decision`.
7. **API contracts** — `broadcast.draft.v1`, `broadcast.review.v1`, `broadcast.status.v1` in `apps/web/src/contracts/`. Zod schemas as single source of truth.
8. **API routes** — `apps/web/src/app/api/v1/broadcast/` — POST (draft), PATCH (review), GET (status). Auth via `getSessionUser`, DI via `getContainer`.
9. **Container wiring** — register broadcast adapters and services in the app's DI container.

### Invariants (from spec)

- **MESSAGE_IS_PLATFORM_AGNOSTIC** — `ContentMessage.body` has no platform-specific formatting
- **ONE_POST_PER_PLATFORM** — unique index enforced at DB level
- **REVIEW_BEFORE_HIGH_RISK** — HIGH-risk posts block until explicit approval Signal
- **ADAPTERS_ARE_SWAPPABLE** — adding Discord/Bluesky later requires only a new `PublishPort` impl + optimizer strategy, no core/workflow changes
- **TEMPORAL_OWNS_DURABILITY** — no application-level retry loops

## Allowed Changes

- `packages/broadcast-core/` — **create** (new package)
- `packages/db-schema/src/broadcasting.ts` — **create**
- `packages/db-schema/src/index.ts` — **modify** (add broadcasting export)
- `packages/db-schema/package.json` — **modify** (add broadcasting export map entry)
- `packages/db-client/src/adapters/drizzle-broadcast-*.adapter.ts` — **create**
- `packages/db-client/src/index.ts` — **modify** (export new adapters)
- `services/scheduler-worker/src/adapters/broadcast/` — **create** (X adapter)
- `services/scheduler-worker/src/workflows/broadcast.workflow.ts` — **create**
- `services/scheduler-worker/src/activities/broadcast/` — **create** (activities)
- `apps/web/src/contracts/broadcast.*.v1.contract.ts` — **create**
- `apps/web/src/app/api/v1/broadcast/` — **create** (route handlers)
- `apps/web/src/features/broadcasting/` — **create** (feature services)
- `apps/web/src/bootstrap/container.ts` — **modify** (wire broadcast services)
- Migration file for the 2 new tables

### Out of Scope

- Discord adapter, Bluesky adapter (separate follow-up tasks)
- Engagement collection (`EngagementPort`, `engagement_snapshots` table)
- Campaign management (`campaigns` table)
- `broadcast_runs` table (Walk phase)
- Review UI components
- Cron scheduling

## Plan

### 1. Core Package

- [ ] Create `packages/broadcast-core/` with `package.json`, `tsconfig.json`, `tsup.config.ts`, `AGENTS.md`
- [ ] Implement `src/types.ts` — `ContentMessage`, `PlatformPost`, branded IDs, all Crawl enums
- [ ] Implement `src/errors.ts` — domain error classes with type guards
- [ ] Implement `src/rules.ts` — `assessRisk()`, `canTransition()`, `canTransitionPlatformPost()` pure functions
- [ ] Implement `src/ports/publish.port.ts` — `PublishPort` interface
- [ ] Implement `src/ports/content-optimizer.port.ts` — `ContentOptimizerPort` interface
- [ ] Implement `src/ports/broadcast-ledger.port.ts` — `BroadcastLedgerUserPort`, `BroadcastLedgerWorkerPort`
- [ ] Implement `src/index.ts` barrel export
- [ ] Add to workspace `pnpm-workspace.yaml` if needed

### 2. Database Schema + Migration

- [ ] Create `packages/db-schema/src/broadcasting.ts` — 2 tables per spec
- [ ] Export from `packages/db-schema` barrel and package.json exports map
- [ ] Create migration for `content_messages` and `platform_posts` tables with RLS policies

### 3. Database Adapters

- [ ] Implement `packages/db-client/src/adapters/drizzle-broadcast-user.adapter.ts` — `BroadcastLedgerUserPort`
- [ ] Implement `packages/db-client/src/adapters/drizzle-broadcast-worker.adapter.ts` — `BroadcastLedgerWorkerPort`
- [ ] Export from `packages/db-client` barrel

### 4. API Contracts

- [ ] Create `apps/web/src/contracts/broadcast.draft.v1.contract.ts`
- [ ] Create `apps/web/src/contracts/broadcast.review.v1.contract.ts`
- [ ] Create `apps/web/src/contracts/broadcast.status.v1.contract.ts`

### 5. Feature Services

- [ ] Create `apps/web/src/features/broadcasting/services/draft.ts` — create ContentMessage, kick off workflow
- [ ] Create `apps/web/src/features/broadcasting/services/review.ts` — send review Signal to workflow
- [ ] Create `apps/web/src/features/broadcasting/services/status.ts` — fetch message + platform posts

### 6. API Routes

- [ ] Create `apps/web/src/app/api/v1/broadcast/route.ts` — POST (draft), GET (list)
- [ ] Create `apps/web/src/app/api/v1/broadcast/[id]/route.ts` — GET (status)
- [ ] Create `apps/web/src/app/api/v1/broadcast/[id]/review/route.ts` — PATCH (review decision)

### 7. X/Twitter Adapter

- [ ] Create `services/scheduler-worker/src/adapters/broadcast/x-publish.adapter.ts`
- [ ] Implement `publish()` — `POST https://api.twitter.com/2/tweets`
- [ ] Implement `delete()` — `DELETE https://api.twitter.com/2/tweets/:id`
- [ ] Implement `healthCheck()` — token validation
- [ ] Handle rate limiting (free tier: 1,500 tweets/month)

### 8. Content Optimizer

- [ ] Create `services/scheduler-worker/src/adapters/broadcast/x-content-optimizer.adapter.ts`
- [ ] Implement optimization via `GraphExecutorPort` — 280-char limit, hashtags, thread splitting

### 9. Temporal Workflow + Activities

- [ ] Create broadcast activities: `optimizeContentActivity`, `assessRiskActivity`, `publishToPlatformActivity`, `finalizePlatformPostActivity`, `updateContentMessageStatusActivity`
- [ ] Create `services/scheduler-worker/src/workflows/broadcast.workflow.ts` — full pipeline with Signal-based review gate
- [ ] Register workflow and activities in scheduler-worker

### 10. Container Wiring + Integration

- [ ] Wire broadcast adapters and services in `apps/web/src/bootstrap/container.ts`
- [ ] Wire X adapter in scheduler-worker bootstrap

### 11. Tests

- [ ] Unit tests for `broadcast-core` rules (risk assessment, state transitions)
- [ ] Unit tests for domain types and error classes
- [ ] Contract tests for API contracts (schema validation)
- [ ] Unit tests for Drizzle adapters (mock DB)
- [ ] Unit tests for X adapter (mock HTTP)

### 12. Validate

- [ ] `pnpm packages:build` — broadcast-core builds
- [ ] `pnpm check` — lint, types, format all pass
- [ ] `pnpm test` — all unit tests pass
- [ ] Verify adding a new platform adapter requires zero changes to core/workflow/features

## Validation

**Commands:**

```bash
pnpm packages:build          # broadcast-core compiles
pnpm check                   # lint + type + format (CI-fast)
pnpm test                    # unit tests pass
pnpm test:contract           # contract tests pass
```

**Expected:** All pass with zero errors.

**Manual verification:**

- POST `/api/v1/broadcast` with `{ body: "Test post", targetPlatforms: ["x"] }` creates a ContentMessage and starts the Temporal workflow
- GET `/api/v1/broadcast/{id}` returns the message with its PlatformPost (status progresses through optimize → review)
- PATCH `/api/v1/broadcast/{id}/review` with `{ platformPostId, decision: "approved" }` sends a Temporal Signal and triggers publish
- After publish, PlatformPost has `externalId` and `externalUrl` populated

## Review Checklist

- [ ] **Work Item:** `task.0159` linked in PR body
- [ ] **Spec:** all invariants from [broadcasting-spec](../../docs/spec/broadcasting.md) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Architecture:** `pnpm check` passes (layer import rules enforced)
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-

## Review Feedback

### Blocking Issues (revision 1)

1. **Unsafe status filter cast** — `apps/web/src/app/api/v1/broadcasting/route.ts:131-132`: Query parameter `?status=X` is cast directly to `ContentMessage["status"]` via `as` without validation. Allows arbitrary strings to reach the database query. **Fix:** Validate against `CONTENT_MESSAGE_STATUSES` array or use a Zod schema parse.

2. **`as never` type escapes** — `apps/web/src/app/api/v1/broadcasting/[messageId]/route.ts:82` and `apps/web/src/app/api/v1/broadcasting/[messageId]/posts/[postId]/review/route.ts:98`: Uses `as never` to bypass branded type system. **Fix:** Use `toContentMessageId(messageId)` and `toPlatformPostId(postId)` from `@cogni/broadcast-core`.

3. **`"edited"` decision without `editedBody`** — `packages/db-client/src/adapters/drizzle-broadcast-user.adapter.ts:213-216`: When `decision === "edited"` but `editedBody` is undefined, the method does not set status, leaving the post in an inconsistent state (e.g., stuck in `pending_review`). **Fix:** Either require `editedBody` when decision is `"edited"` (throw if missing), or treat `"edited"` without body as `"approved"`.

### Blocking Issues (revision 2)

1. **Duplicate work item ID** — `task.0159.governance-e2e-validation.md` conflicts with `task.0159.broadcasting-core-x-adapter.md`, causing `pnpm check:docs` to fail. **Fix:** Delete or re-number the governance task file.

2. **Incomplete scope vs. task status** — Task requirements 4–6 (X adapter, ContentOptimizerPort, Temporal broadcastWorkflow) are not implemented. The task was marked `needs_closeout` but ~40% of stated requirements are missing. **Fix:** Either split the task (create follow-up task for workflow/adapters, mark this as the domain+persistence deliverable) or implement the remaining scope before closing.

### Non-blocking Suggestions (revision 2)

- `toContentMessage`/`toPlatformPost` mappers duplicated across user and worker adapters — extract to shared file
- `toResponse`/`toPostResponse`/`handleRouteError` duplicated across route files — extract to shared module
- Review route ignores `messageId` param — verify post belongs to message to prevent cross-message review
- `PLATFORM_IDS`/`REVIEW_DECISIONS` redeclared in contracts instead of importing from `@cogni/broadcast-core` — drift risk
- `assessRisk` takes `_platformPosts` param but never uses it — remove or use
- No state transition validation at adapter or feature layer — `canTransitionMessage()` is defined but never called
