---
id: proj.broadcasting
type: project
primary_charter:
title: "Broadcasting — Multi-Platform Content Publishing Pipeline"
state: Active
priority: 1
estimate: 4
summary: AI-generated content publishing across social platforms and blog with human-in-the-loop review, engagement feedback, and Temporal-based durable workflows.
outcome: ContentMessage drafts flow through optimize → review → publish pipeline to Discord, Bluesky, X, LinkedIn, and Blog via swappable platform adapters. Engagement observation and campaign management added in Walk.
assignees:
  - derekg1729
created: 2026-03-11
updated: 2026-03-11
labels: [broadcasting, social-media, content, temporal, ai]
---

# Broadcasting — Multi-Platform Content Publishing Pipeline

> Research: [spike.0158](../items/spike.0158.broadcasting-platform-integration.md) → [docs/research/broadcasting-platform-integration.md](../../docs/research/broadcasting-platform-integration.md)

## Goal

Enable AI-generated content to be drafted, optimized per platform, reviewed by humans, and published across multiple platforms — all through a single pipeline where every platform is a swappable adapter behind a shared port. Blog posts and social posts share the same core domain model (`ContentMessage → PlatformPost`). Engagement tracking, campaign grouping, and retry audit trails are added in Walk phase.

## Roadmap

### Crawl (P0) — Core Pipeline + Echo Publisher

**Goal:** A `ContentMessage` can be drafted, AI-optimized per platform via LLM, reviewed by a human, and published (echo adapter for Crawl). Use-case seam in `broadcast-core` enables Temporal to wrap later without rewriting. Real platform adapters are follow-up tasks.

| Deliverable                                                                                 | Status      | Est | Work Item |
| ------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| `broadcast-core` — domain model, ports, rules, errors                                       | Done        | 1.5 | task.0159 |
| DB schema — 2 tables with RLS + Drizzle adapters                                            | Done        | 2   | task.0159 |
| API contracts + routes + container wiring                                                   | Done        | 1   | task.0159 |
| Broadcasting UI — compose, list, detail, review                                             | Done        | 3   | task.0167 |
| Use-case seam (`broadcast-core/application/`) + echo optimizer + echo publisher + migration | In Review   | 3   | task.0159 |
| X/Twitter `PublishPort` adapter (OAuth 2.0, rate limiting)                                  | Not Started | 2   | task.0166 |
| Discord `PublishPort` adapter (webhook)                                                     | Not Started | 0.5 | —         |
| Bluesky `PublishPort` adapter (`@atproto/api`)                                              | Not Started | 0.5 | —         |

### Walk (P1) — Schema Evolution + LinkedIn + Blog + Engagement

**Goal:** Split `broadcast_runs` out of `platform_posts` for retry auditing. Add `engagement_snapshots` and `campaigns` tables. LinkedIn and Blog adapters join the pipeline. Engagement feedback loop operational. Campaigns group related messages.

| Deliverable                                                                        | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| `broadcast_runs` table — split publish results out of `platform_posts` + migration | Not Started | 1   | (create at P1 start) |
| `engagement_snapshots` table + `EngagementPort` adapters (Bluesky, X, Blog)        | Not Started | 2   | (create at P1 start) |
| `campaigns` table + Campaign management (group messages, track launch)             | Not Started | 2   | (create at P1 start) |
| LinkedIn `PublishPort` adapter (OAuth 2.0 + token refresh)                         | Not Started | 2   | (create at P1 start) |
| Blog `PublishPort` adapter (aligned with blog dev's work)                          | Not Started | 2   | (create at P1 start) |
| Engagement collection child workflow (hourly for 48h)                              | Not Started | 1   | (create at P1 start) |
| Risk-based auto-approval tiers (configurable per tenant)                           | Not Started | 1   | (create at P1 start) |
| Cron-scheduled broadcasting via `@cogni/scheduler-core`                            | Not Started | 1   | (create at P1 start) |

### Run (P2+) — Full Suite

**Goal:** Rich content types, analytics dashboard, A/B testing, and cross-platform threading.

| Deliverable                                                              | Status      | Est | Work Item            |
| ------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| YouTube video upload adapter (OAuth + quota mgmt)                        | Not Started | 2   | (create at P2 start) |
| Content calendar UI                                                      | Not Started | 3   | (create at P2 start) |
| A/B testing (post variants per platform)                                 | Not Started | 2   | (create at P2 start) |
| Cross-platform threading (X thread → LinkedIn carousel → Bluesky thread) | Not Started | 2   | (create at P2 start) |
| Review UI with side-by-side platform previews (upgrade from task.0167)   | Not Started | 2   | (create at P2 start) |
| Analytics dashboard (engagement trends over time)                        | Not Started | 2   | (create at P2 start) |

## Constraints

- Blog posts and social posts share the same `ContentMessage → PlatformPost` pipeline — no separate code paths
- Every platform is a `PublishPort` adapter — adding a platform never modifies core, features, or workflows
- HIGH-risk posts must receive explicit human approval (no auto-approve)
- Crawl uses 2 tables (`content_messages`, `platform_posts` with inline publish result); Walk splits out `broadcast_runs`, adds `engagement_snapshots` and `campaigns`
- Platform adapters live in `services/` (scheduler-worker), not in `packages/` (packages have no I/O)
- Credential storage reuses `channel_registrations` AES-256-GCM pattern from `proj.messenger-channels`

## Dependencies

- [x] Temporal infrastructure operational (via `@cogni/scheduler-core`)
- [x] LangGraph graph execution (via `GraphExecutorPort`)
- [ ] `proj.messenger-channels` P0 for credential encryption utilities (can bootstrap standalone if needed)
- [ ] Blog dev's CMS/publishing system design (for Walk phase Blog adapter alignment)

## As-Built Specs

- [Broadcasting Spec (draft)](../../docs/spec/broadcasting.md) — domain model, ports, schema, workflow, invariants

## Design Notes

- Research found that 4 platforms (Discord, Bluesky, X, LinkedIn) cover ~80% of developer audience with ~20% of effort
- Thin wrapper (~800 LOC) preferred over Postiz dependency — avoids Redis/NestJS/Prisma operational burden
- Blog alignment achieved by making blog "just another PlatformId" — same optimization, review, and publishing pipeline
- Temporal Signals used for review gate (durable pause surviving restarts)
- Engagement feedback loop uses Temporal child workflows with scheduled collection windows
