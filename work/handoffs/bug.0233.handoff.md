---
id: bug.0233.handoff
type: handoff
work_item_id: bug.0233
status: active
created: 2026-03-30
updated: 2026-03-30
branch: claude/research-broadcasting-integration-8p2DB
last_commit: 7e2069e9
---

# Handoff: Broadcasting UI is unusable — echo-only output, no publish action, confusing UX

## Context

- Broadcasting is a multi-platform content publishing pipeline: user writes content intent, AI adapts it per platform (X, Discord, LinkedIn, Bluesky, Blog), human reviews, then publishes.
- The backend pipeline works end-to-end (create draft → optimize → review → publish via echo adapters), covered by stack tests.
- The UI was built as a task.0168 deliverable and wired to the API, but it exposes internal state machine concepts directly to users and lacks critical user-facing actions.
- PR #581 on branch `claude/research-broadcasting-integration-8p2DB` contains all broadcasting work. It is merged up to staging as of 2026-03-30.
- A `broadcast-writer` LangGraph graph and 5 platform skill guides were added, plus a `GraphContentOptimizerAdapter` that wires through the billing/observability stack — but in practice the graph falls back to the echo adapter silently.

## Current State

- **Backend (works):** Use-cases (`optimize-draft`, `apply-review-decision`, `publish-post`), DB migration with RLS, Drizzle adapters (user + worker trust split), API routes, echo publish adapter. Stack tests pass.
- **Graph infra (wired but not producing output):** `broadcast-writer` graph registered in catalog, `GraphContentOptimizerAdapter` wired in container with scoped executor (billing/preflight/Langfuse). Falls back to echo adapter silently — likely skill doc path resolution or missing LLM model. See `graph-content-optimizer.adapter.ts:38-42`.
- **UI (broken UX):** Lists drafts, expands to show platform posts, has compose dialog. But: no "Publish" button, no "Regenerate" button, edit only works on `pending_review` posts, risk/status badges show raw state machine values, auto-approve dead-ends.
- **Platform skill guides (done):** 5 rich markdown docs in `packages/broadcast-core/platform-skills/` covering tone, constraints, examples, engagement strategy per platform.

## Decisions Made

- [Broadcasting spec](docs/spec/broadcasting.md) — pipeline flow: approve intent → N graph runs per platform → review posts → publish
- [Platform skill guides](packages/broadcast-core/platform-skills/README.md) — adding a platform = adding a markdown file, no code changes for optimization
- `ContentOptimizerPort` renamed return type to `PlatformPostDraft` (was `OptimizationResult`)
- Echo adapter kept as test/fallback; graph adapter is production path
- Use-cases live in `packages/broadcast-core/src/application/` (not app routes) so Temporal activities can wrap them later without rewriting

## Next Actions

- [ ] **Fix graph optimizer**: debug why `GraphContentOptimizerAdapter` falls back to echo — check skill doc path resolution and LLM model availability
- [ ] **Add Publish button**: for any post in `approved` status, show a "Post" / "Publish" action
- [ ] **Add Regenerate button**: re-run optimizer for any unpublished post
- [ ] **Allow editing any unpublished post**: not just `pending_review`
- [ ] **User-friendly status labels**: "Ready to post" not "approved", "Needs review" not "pending_review", "Posted" not "published"
- [ ] **Fix risk heuristic**: URLs should not auto-block — most social posts contain URLs
- [ ] **Show loading/error states**: optimization may take seconds, failures should be visible
- [ ] **Wire first real PublishPort**: Discord webhook is simplest (no OAuth, just POST)

## Risks / Gotchas

- The graph optimizer resolves skill docs via `process.cwd()` + relative path — this breaks if the Next.js server CWD isn't the monorepo root (common in Docker/deployment). Needs a robust resolution strategy.
- The scoped executor wiring in `route.ts` is copy-pasted from the graph runs route — heavyweight. Consider extracting a shared factory.
- Risk assessment runs on the original message body, not the AI-adapted output. The spec notes this is a latent divergence risk for Walk phase when real optimizers change content.
- The `broadcastOptimizer` singleton on the container is still the echo adapter — `broadcastOptimizerForExecutor()` is the graph-backed factory but must be called per-request with billing context.

## Pointers

| File / Resource                                                             | Why it matters                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `work/items/bug.0233.broadcasting-ui-unusable-ux-gaps.md`                   | The bug being handed off — full requirements and reproduction steps        |
| `docs/spec/broadcasting.md`                                                 | Governing spec — pipeline flow, domain model, invariants                   |
| `packages/broadcast-core/platform-skills/`                                  | AI skill guides per platform — the knowledge base for content optimization |
| `packages/broadcast-core/src/application/`                                  | Use-case functions (optimize-draft, apply-review, publish-post)            |
| `apps/web/src/app/(app)/broadcasting/view.tsx`                              | The UI component — all issues are here                                     |
| `apps/web/src/adapters/server/broadcast/graph-content-optimizer.adapter.ts` | Graph-backed optimizer — where the fallback-to-echo happens                |
| `apps/web/src/app/api/v1/broadcasting/route.ts`                             | POST route — scoped executor wiring for graph execution                    |
| `packages/langgraph-graphs/src/graphs/broadcast-writer/`                    | Graph definition + system prompt                                           |
| `packages/langgraph-graphs/src/catalog.ts`                                  | Graph catalog registration                                                 |
| `work/qa-task-0159-broadcasting-pipeline.md`                                | QA test plan with 10 click-through test cases                              |
| `apps/web/tests/stack/broadcasting/broadcast-pipeline.stack.test.ts`        | Stack tests proving backend pipeline works                                 |
