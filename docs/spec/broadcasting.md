---
id: broadcasting-spec
type: spec
title: "Broadcasting — Content Publishing Pipeline"
status: draft
trust: draft
summary: Ports-and-adapters design for multi-platform content publishing with AI generation, human review, and engagement feedback.
read_when: Building broadcasting features, adding a new platform adapter, or integrating blog posts with the publishing pipeline.
owner: derekg1729
created: 2026-03-11
verified: 2026-03-11
tags: [broadcasting, social-media, content, architecture]
---

# Broadcasting — Content Publishing Pipeline

## Mission

Publish AI-generated content across platforms (social, blog, video) through a single **Message → Optimize → Review → Publish** pipeline. Every platform is a swappable adapter behind a shared port. Blog posts and social posts share the same core domain. Engagement observation added in Walk phase.

## Core Concept: The Content Message

A **ContentMessage** is the atomic unit of the broadcasting system. It carries the _intent_ of what to say, not how to say it on any particular platform. Platform-specific formatting is the adapter's job.

```
ContentMessage (platform-agnostic intent)
  │
  ├──▶ PlatformPost (X) ──▶ 280 chars, hashtags, thread splits
  ├──▶ PlatformPost (Bluesky) ──▶ 300 chars, facets for links/mentions
  ├──▶ PlatformPost (LinkedIn) ──▶ 3000 chars, professional tone
  ├──▶ PlatformPost (Discord) ──▶ rich embed via webhook
  └──▶ PlatformPost (Blog) ──▶ full markdown, SEO metadata, slug
```

## Architecture: Hexagonal Alignment

Broadcasting follows the same layering as the rest of the codebase:

```
contracts → core → ports → features → adapters → app
```

### Layer Mapping

| Layer         | Broadcasting Location                                                          | Responsibility                                                                                                   |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Core**      | `packages/broadcast-core/src/`                                                 | Domain model (ContentMessage, PlatformPost, Campaign, BroadcastRun), rules (risk assessment, validation), errors |
| **Ports**     | `packages/broadcast-core/src/ports/`                                           | `PublishPort`, `ContentOptimizerPort`, `EngagementPort`, `BroadcastLedgerPort`                                   |
| **Adapters**  | `packages/db-client/src/adapters/` + platform-specific packages or `services/` | Drizzle persistence, platform API clients (X, Bluesky, Discord, LinkedIn, Blog CMS)                              |
| **Features**  | `apps/web/src/features/broadcasting/services/`                                 | Orchestration: draft → optimize → review → publish → observe                                                     |
| **Contracts** | `apps/web/src/contracts/broadcast.*.v1.contract.ts`                            | HTTP wire formats for draft, review, publish, status APIs                                                        |
| **App**       | `apps/web/src/app/api/v1/broadcast/`                                           | Next.js routes                                                                                                   |
| **Workflows** | `services/scheduler-worker/src/workflows/`                                     | Temporal `broadcastWorkflow` for durable publish + review                                                        |

---

## Domain Model (`packages/broadcast-core`)

### Entities (Crawl)

```typescript
/** Platform-agnostic content intent. The "what to say". */
interface ContentMessage {
  id: ContentMessageId; // branded UUID
  ownerUserId: UserId;
  billingAccountId: string;
  body: string; // markdown source text
  title?: string; // for long-form (blog)
  mediaUrls: string[]; // attached images/video
  targetPlatforms: PlatformId[]; // which platforms to publish to
  metadata: Record<string, unknown>; // extensible (SEO, tags, etc.)
  status: ContentMessageStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Platform-specific optimized rendition + publish result. */
interface PlatformPost {
  id: PlatformPostId; // branded UUID
  contentMessageId: ContentMessageId;
  platform: PlatformId;
  optimizedBody: string; // platform-formatted text
  optimizedTitle?: string; // for platforms with titles (blog, YouTube)
  mediaUrls: string[];
  platformMetadata: Record<string, unknown>; // hashtags, facets, embed config, SEO slug
  status: PlatformPostStatus;
  reviewDecision?: ReviewDecision;
  // Publish result (flattened from BroadcastRun for Crawl simplicity)
  externalId?: string; // platform's post ID (tweet ID, bsky rkey, etc.)
  externalUrl?: string; // permalink on platform
  errorMessage?: string;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Entities (Walk/Run — added when needed)

```typescript
/** Immutable record of a publish attempt. Split out from PlatformPost in Walk
 *  when retry auditing and multi-attempt tracking become requirements. */
interface BroadcastRun {
  id: BroadcastRunId;
  platformPostId: PlatformPostId;
  platform: PlatformId;
  status: BroadcastRunStatus;
  externalId?: string;
  externalUrl?: string;
  errorMessage?: string;
  publishedAt?: Date;
  createdAt: Date;
}

/** Engagement snapshot pulled from platform APIs (where available). */
interface EngagementSnapshot {
  id: string;
  broadcastRunId: BroadcastRunId; // or platformPostId if runs not yet split
  platform: PlatformId;
  impressions?: number;
  likes?: number;
  reposts?: number;
  replies?: number;
  clicks?: number;
  collectedAt: Date;
}

/** Groups related content messages into a coordinated launch. */
interface Campaign {
  id: CampaignId;
  ownerUserId: UserId;
  name: string;
  description?: string;
  status: CampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}
```

### Enums (Crawl)

```typescript
const PLATFORM_IDS = ["x", "bluesky", "linkedin", "discord", "blog"] as const;
type PlatformId = (typeof PLATFORM_IDS)[number];

const CONTENT_MESSAGE_STATUSES = [
  "draft",
  "optimizing",
  "review",
  "approved",
  "publishing",
  "published",
  "failed",
  "cancelled",
] as const;
type ContentMessageStatus = (typeof CONTENT_MESSAGE_STATUSES)[number];

const PLATFORM_POST_STATUSES = [
  "pending_optimization",
  "optimized",
  "pending_review",
  "approved",
  "rejected",
  "publishing",
  "published",
  "failed",
] as const;
type PlatformPostStatus = (typeof PLATFORM_POST_STATUSES)[number];

const REVIEW_DECISIONS = ["approved", "rejected", "edited"] as const;
type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

const RISK_LEVELS = ["low", "medium", "high"] as const;
type RiskLevel = (typeof RISK_LEVELS)[number];
```

### Enums (Walk/Run — added when needed)

```typescript
const BROADCAST_RUN_STATUSES = [
  "pending",
  "running",
  "success",
  "error",
] as const;
type BroadcastRunStatus = (typeof BROADCAST_RUN_STATUSES)[number];

const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "completed",
  "cancelled",
] as const;
type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
```

### Rules (Pure Functions)

```typescript
// Risk assessment — pure function, no I/O
function assessRisk(
  message: ContentMessage,
  platformPosts: PlatformPost[]
): RiskLevel;

// State machine transitions — validated at domain level
function canTransition(
  from: ContentMessageStatus,
  to: ContentMessageStatus
): boolean;
function canTransitionPlatformPost(
  from: PlatformPostStatus,
  to: PlatformPostStatus
): boolean;
```

---

## Ports (`packages/broadcast-core/src/ports/`)

### `publish.port.ts` — Platform Publishing

```typescript
/**
 * Adapter for publishing content to a specific platform.
 * One implementation per platform (X, Bluesky, Discord, LinkedIn, Blog).
 * Implementations live in services/ or adapters/, never in this package.
 */
interface PublishPort {
  readonly platform: PlatformId;

  /** Publish a platform post. Returns external ID + URL on success. */
  publish: (post: PlatformPost) => Promise<PublishResult>;

  /** Delete a previously published post (best-effort). */
  delete: (externalId: string) => Promise<void>;

  /** Check if credentials/connection are valid. */
  healthCheck: () => Promise<HealthCheckResult>;
}

interface PublishResult {
  externalId: string;
  externalUrl: string;
}

interface HealthCheckResult {
  healthy: boolean;
  message?: string;
}
```

### `content-optimizer.port.ts` — AI Content Optimization

```typescript
/**
 * Transforms a ContentMessage into platform-optimized PlatformPost bodies.
 *
 * Implementation: runs the `broadcast-writer` LangGraph graph per platform.
 * The adapter reads the platform skill guide from platform-skills/<platform>.md,
 * builds the user message via buildBroadcastWriterMessage(), and runs the graph.
 *
 * One call per platform = one graph run = one PlatformPost.
 * Platform knowledge lives in markdown skill docs, not in code.
 */
interface ContentOptimizerPort {
  optimize: (
    message: ContentMessage,
    targetPlatform: PlatformId
  ) => Promise<PlatformPostDraft>;
}

interface PlatformPostDraft {
  optimizedBody: string;
  optimizedTitle?: string;
  platformMetadata: Record<string, unknown>;
  riskLevel: RiskLevel;
  riskReason?: string;
}
```

### `engagement.port.ts` — Feedback Loop (Walk)

```typescript
/**
 * Walk phase — Collects engagement metrics from platforms for published posts.
 * Not all platforms expose this (Discord webhooks don't).
 * Adapters return null for unsupported metrics.
 */
interface EngagementPort {
  readonly platform: PlatformId;

  /** Collect current engagement snapshot for a published post. */
  collect: (externalId: string) => Promise<EngagementSnapshot | null>;
}
```

### `broadcast-ledger.port.ts` — Persistence

```typescript
/**
 * CRUD for broadcasting domain entities.
 * Split by trust boundary: User (RLS) vs Worker (BYPASSRLS).
 *
 * Crawl scope: ContentMessage + PlatformPost (with inline publish result).
 * Walk adds: BroadcastRun reads/writes, EngagementSnapshot, Campaign CRUD.
 */
interface BroadcastLedgerUserPort {
  // ContentMessage CRUD
  createContentMessage: (
    callerUserId: UserId,
    input: CreateContentMessageInput
  ) => Promise<ContentMessage>;
  getContentMessage: (
    callerUserId: UserId,
    id: ContentMessageId
  ) => Promise<ContentMessage | null>;
  listContentMessages: (
    callerUserId: UserId,
    filter?: ContentMessageFilter
  ) => Promise<readonly ContentMessage[]>;
  updateContentMessageStatus: (
    callerUserId: UserId,
    id: ContentMessageId,
    status: ContentMessageStatus
  ) => Promise<ContentMessage>;

  // PlatformPost CRUD
  getPlatformPosts: (
    callerUserId: UserId,
    contentMessageId: ContentMessageId
  ) => Promise<readonly PlatformPost[]>;
  updatePlatformPostReview: (
    callerUserId: UserId,
    id: PlatformPostId,
    decision: ReviewDecision,
    editedBody?: string
  ) => Promise<PlatformPost>;
}

interface BroadcastLedgerWorkerPort {
  // Platform post creation (worker generates optimized posts)
  createPlatformPost: (
    actorId: ActorId,
    input: CreatePlatformPostInput
  ) => Promise<PlatformPost>;
  updatePlatformPostStatus: (
    actorId: ActorId,
    id: PlatformPostId,
    status: PlatformPostStatus
  ) => Promise<void>;

  // Publish result (flattened — no separate BroadcastRun in Crawl)
  finalizePlatformPost: (
    actorId: ActorId,
    id: PlatformPostId,
    result: FinalizePublishInput
  ) => Promise<void>;

  // Content message status (worker updates after publish)
  updateContentMessageStatus: (
    actorId: ActorId,
    id: ContentMessageId,
    status: ContentMessageStatus
  ) => Promise<void>;
}

// Walk additions (extend ports when these features ship):
// BroadcastLedgerUserPort: getBroadcastRuns, getEngagementSnapshots, createCampaign, listCampaigns
// BroadcastLedgerWorkerPort: createBroadcastRun, finalizeBroadcastRun, upsertEngagementSnapshot
```

---

## Database Schema (`packages/db-schema/src/broadcasting.ts`)

### Crawl — 2 Tables

```typescript
export const PLATFORM_IDS = [
  "x",
  "bluesky",
  "linkedin",
  "discord",
  "blog",
] as const;
export const CONTENT_MESSAGE_STATUSES = [
  "draft",
  "optimizing",
  "review",
  "approved",
  "publishing",
  "published",
  "failed",
  "cancelled",
] as const;
export const PLATFORM_POST_STATUSES = [
  "pending_optimization",
  "optimized",
  "pending_review",
  "approved",
  "rejected",
  "publishing",
  "published",
  "failed",
] as const;
export const REVIEW_DECISIONS = ["approved", "rejected", "edited"] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;

export const contentMessages = pgTable(
  "content_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    billingAccountId: text("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    title: text("title"),
    mediaUrls: text("media_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    targetPlatforms: text("target_platforms").array().notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status", { enum: CONTENT_MESSAGE_STATUSES })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerIdx: index("content_messages_owner_idx").on(table.ownerUserId),
    statusIdx: index("content_messages_status_idx").on(table.status),
  })
).enableRLS();

export const platformPosts = pgTable(
  "platform_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentMessageId: uuid("content_message_id")
      .notNull()
      .references(() => contentMessages.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORM_IDS }).notNull(),
    optimizedBody: text("optimized_body").notNull(),
    optimizedTitle: text("optimized_title"),
    mediaUrls: text("media_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    platformMetadata: jsonb("platform_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status", { enum: PLATFORM_POST_STATUSES })
      .notNull()
      .default("pending_optimization"),
    riskLevel: text("risk_level", { enum: RISK_LEVELS }),
    riskReason: text("risk_reason"),
    reviewDecision: text("review_decision", { enum: REVIEW_DECISIONS }),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // Publish result (inline — no separate broadcast_runs table in Crawl)
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    errorMessage: text("error_message"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    contentMessageIdx: index("platform_posts_content_message_idx").on(
      table.contentMessageId
    ),
    platformIdx: index("platform_posts_platform_idx").on(table.platform),
    statusIdx: index("platform_posts_status_idx").on(table.status),
    /** One post per platform per content message */
    platformUnique: uniqueIndex("platform_posts_message_platform_unique").on(
      table.contentMessageId,
      table.platform
    ),
  })
).enableRLS();
```

### Walk/Run — Tables Added When Needed

These tables are created via migration when their features ship:

| Table                  | Phase | Trigger                                                                                                                                           |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `broadcast_runs`       | Walk  | Retry auditing — split `external_id`/`external_url`/`error_message`/`published_at` out of `platform_posts` into immutable append-only run records |
| `engagement_snapshots` | Walk  | Engagement feedback loop — periodic metric collection per platform                                                                                |
| `campaigns`            | Walk  | Campaign management — group content messages into coordinated launches                                                                            |

Schema for these tables is defined in the [Walk/Run entities section](#entities-walkrun--added-when-needed) above. Migration will add the tables and backfill the FK relationships (e.g., `content_messages.campaign_id` added as nullable column when `campaigns` ships).

---

## Workflow: The Pipeline

### Sequence

```
User creates ContentMessage (draft — the core intent)
  │
  ▼
1. APPROVE INTENT — Human confirms the message is worth publishing
  │                  (draft → approved)
  │
  ▼
2. GENERATE — N independent graph runs, one per target platform
  │            Each runs the `broadcast-writer` LangGraph graph:
  │              Input: platform skill guide (markdown) + content message
  │              Output: platform-optimized post body
  │            Creates PlatformPost per graph run result
  │
  ▼
3. REVIEW — Human reviews each platform post (or auto-approve low-risk)
  │          approve / reject / edit per PlatformPost
  │
  ▼
4. PUBLISH — PublishPort.publish() per approved PlatformPost
  │           Each platform = separate Temporal Activity with retry policy
  │
  ▼
5. OBSERVE — EngagementPort.collect() on schedule (Walk phase)
```

### Why 1 Graph Run Per Platform

Each platform has a deep, evolving **platform skill guide** (see `packages/broadcast-core/platform-skills/`).
These are rich markdown documents covering tone, constraints, examples, engagement strategy, and
anti-patterns. A single graph run receives one skill guide + the content and produces one post.

This is simpler and more correct than running all platforms in one graph because:

- Each run is **independent** — parallelizable, individually retryable
- Each run's context window contains **only the relevant platform knowledge**
- Adding a platform = adding a markdown file (no code changes for generation)
- Each graph run produces a **graph_runs record** visible in the dashboard
- Aligns with Temporal: parent workflow spawns N child `GraphRunWorkflow`s

### Platform Skill Guides

Platform knowledge lives in `packages/broadcast-core/platform-skills/<platform>.md`. Each guide covers:

- Platform identity, audience, content lifespan, how content spreads
- Format constraints (char limits, media, threading, special features)
- Optimization goals (what to maximize: replies, shares, SEO, authority)
- Tone and voice (what works, what fails, with examples)
- Content patterns and anti-patterns
- Adaptation rules (numbered rules the AI follows)
- Strong vs weak examples

Adding a new platform requires only:

1. Create `<platform-id>.md` in `platform-skills/`
2. Add the platform ID to `PLATFORM_IDS` in `types.ts`
3. Register a `PublishPort` adapter

### Crawl Execution (Synchronous in HTTP Handlers)

In Crawl, the pipeline runs synchronously within HTTP handlers for simplicity:

- `POST /broadcasting` creates draft + runs optimization inline
- `POST .../review` applies review + publishes inline

The use-case functions in `broadcast-core/application/` are structured as
**pure functions with ports as args** — ready to wrap as Temporal Activities
without rewriting business logic.

### Walk Execution (Temporal Workflow)

```typescript
// Pseudocode — Walk phase wraps existing use-cases
async function broadcastWorkflow(
  input: BroadcastWorkflowInput
): Promise<BroadcastWorkflowResult> {
  const { contentMessageId, targetPlatforms } = input;

  // 1. Generate — N child GraphRunWorkflows (one per platform)
  //    Each child: read skill guide → run broadcast-writer graph → create PlatformPost
  const graphRuns = await Promise.allSettled(
    targetPlatforms.map((platform) =>
      executeChild(GraphRunWorkflow, {
        args: [
          { graphId: "langgraph:broadcast-writer", platform, contentMessageId },
        ],
        workflowId: `broadcast-write-${contentMessageId}-${platform}`,
      })
    )
  );

  // 2. Review gate — wait for human signals per post
  for (const post of pendingReviewPosts) {
    const decision = await condition(
      () => reviewSignals.has(post.id),
      reviewTimeout
    );
    if (!decision || reviewSignals.get(post.id) === "rejected") {
      continue;
    }
  }

  // 3. Publish — parallel Activities per approved platform
  const results = await Promise.allSettled(
    approvedPosts.map((post) => publishToPlatform(post))
  );

  return { results };
}
```

### Temporal Signals

| Signal             | Payload                                                                           | Sender        |
| ------------------ | --------------------------------------------------------------------------------- | ------------- |
| `review-decision`  | `{ platformPostId, decision: "approved" \| "rejected" \| "edited", editedBody? }` | Review UI     |
| `cancel-broadcast` | `{ contentMessageId, reason }`                                                    | User or admin |

---

## Alignment with Blog Posts

Blog posts are **just another platform adapter** behind the same `PublishPort`. The blog dev's work plugs in here:

### How Blog Fits

| Concern                   | Social Platforms            | Blog                                                       |
| ------------------------- | --------------------------- | ---------------------------------------------------------- |
| **ContentMessage**        | Same entity                 | Same entity (with `title` + richer `metadata`)             |
| **PlatformPost**          | Short-form optimized text   | Full markdown + SEO metadata (slug, description, og:image) |
| **PublishPort**           | X API, Bluesky SDK, etc.    | Blog CMS adapter (Fumadocs, headless CMS, or static gen)   |
| **ContentOptimizerPort**  | Shortens, adds hashtags     | Expands, adds headings/structure, SEO keywords             |
| **EngagementPort** (Walk) | Likes, reposts, impressions | Page views, time on page (from analytics)                  |
| **Review**                | Same Temporal Signal flow   | Same flow (possibly different risk thresholds)             |

### Shared Contracts

The blog dev should:

1. **Use `ContentMessage` as the source entity** — blog posts start as `ContentMessage` with `targetPlatforms: ["blog"]`
2. **Implement `PublishPort` for `platform: "blog"`** — publishes markdown to the blog system
3. **Implement `ContentOptimizerPort` for blog** — long-form optimization (SEO, structure, readability)
4. **Reuse the same `broadcastWorkflow`** — blog posts go through the same review pipeline
5. **(Walk) Implement `EngagementPort` for blog** — collect analytics (page views, etc.)

### Cross-Posting Pattern

A single `ContentMessage` can target both blog and social:

```
ContentMessage { body: "Full blog post about our launch...", targetPlatforms: ["blog", "x", "bluesky", "linkedin"] }
  │
  ├──▶ PlatformPost (blog) — full markdown with SEO metadata
  ├──▶ PlatformPost (x) — 280-char summary + link to blog post
  ├──▶ PlatformPost (bluesky) — summary + link with facet
  └──▶ PlatformPost (linkedin) — professional excerpt + link
```

Social posts can reference the blog URL once it's published (sequential dependency handled by workflow).

---

## Platform Adapter Specifications

### Discord (`PublishPort` for `platform: "discord"`)

- **Auth:** Webhook URL (stored encrypted in `channel_registrations` or env)
- **Publish:** `POST webhookUrl` with JSON body (rich embed)
- **Delete:** `DELETE webhookUrl/messages/{messageId}` (requires `?wait=true` on publish)
- **Engagement:** Not available (webhook is fire-and-forget)
- **Rate limit:** 30 req/sec per webhook

### Bluesky (`PublishPort` for `platform: "bluesky"`)

- **Auth:** App password (stored encrypted)
- **SDK:** `@atproto/api` — `BskyAgent.post()`
- **Publish:** `agent.post({ text, facets, embed })`
- **Delete:** `agent.deletePost(uri)`
- **Engagement:** `agent.getPostThread()` → like/repost/reply counts
- **Rate limit:** Generous, no restrictive limits documented

### X/Twitter (`PublishPort` for `platform: "x"`)

- **Auth:** OAuth 2.0 with PKCE (tokens stored encrypted)
- **Publish:** `POST https://api.twitter.com/2/tweets` with bearer token
- **Delete:** `DELETE https://api.twitter.com/2/tweets/:id`
- **Engagement:** Requires Basic tier ($200/mo) — `GET /2/tweets/:id?tweet.fields=public_metrics`
- **Rate limit:** Free tier: 1,500 tweets/month; 24h windows
- **Thread support:** Chain tweets via `reply.in_reply_to_tweet_id`

### LinkedIn (`PublishPort` for `platform: "linkedin"`)

- **Auth:** OAuth 2.0, 3-legged, tokens expire every 2 months (auto-refresh)
- **Publish:** `POST https://api.linkedin.com/v2/posts` with `w_member_social` scope
- **Delete:** `DELETE https://api.linkedin.com/v2/posts/{postId}`
- **Engagement:** `GET /organizationalEntityShareStatistics` (org pages only)
- **Rate limit:** Standard API limits, no aggressive throttling
- **Walk phase** (requires Standard tier API approval)

### Blog (`PublishPort` for `platform: "blog"`)

- **Auth:** Internal (no external API needed if self-hosted)
- **Publish:** Write markdown file to docs/blog/ or CMS API call
- **Delete:** Remove file or unpublish via CMS
- **Engagement:** Analytics integration (Plausible, PostHog, etc.)
- **Designed by blog dev** — this spec defines the port contract; blog dev implements the adapter

---

## Credential Management

Platform credentials reuse the existing `channel_registrations` pattern from `proj.messenger-channels`:

- AES-256-GCM encrypted credentials in DB
- `CHANNEL_ENCRYPTION_KEY` env var
- Per-tenant scoping via `billing_account_id`

For Crawl, simpler: store credentials as encrypted env vars per platform. Migrate to DB-backed storage in Walk phase when multi-tenant is needed.

---

## API Contracts (`apps/web/src/contracts/`)

### `broadcast.draft.v1.contract.ts`

```typescript
// Create a new content message draft
export const broadcastDraftOperation = {
  id: "broadcast.draft.v1",
  input: z.object({
    body: z.string().min(1).max(50_000),
    title: z.string().max(500).optional(),
    targetPlatforms: z.array(z.enum(PLATFORM_IDS)).min(1),
    mediaUrls: z.array(z.string().url()).max(10).default([]),
    metadata: z.record(z.unknown()).default({}),
    campaignId: z.string().uuid().optional(),
  }),
  output: z.object({
    contentMessage: ContentMessageSchema,
  }),
};
```

### `broadcast.review.v1.contract.ts`

```typescript
// Submit a review decision for a platform post
export const broadcastReviewOperation = {
  id: "broadcast.review.v1",
  input: z.object({
    platformPostId: z.string().uuid(),
    decision: z.enum(REVIEW_DECISIONS),
    editedBody: z.string().optional(),
  }),
  output: z.object({
    platformPost: PlatformPostSchema,
  }),
};
```

### `broadcast.status.v1.contract.ts`

```typescript
// Get full status of a content message + all platform posts (with inline publish result)
export const broadcastStatusOperation = {
  id: "broadcast.status.v1",
  input: z.object({
    contentMessageId: z.string().uuid(),
  }),
  output: z.object({
    contentMessage: ContentMessageSchema,
    platformPosts: z.array(PlatformPostSchema),
  }),
};
```

---

## Observability

| Metric                                 | Type      | Labels                               |
| -------------------------------------- | --------- | ------------------------------------ |
| `broadcast_publish_total`              | counter   | `platform`, `status` (success/error) |
| `broadcast_publish_duration_ms`        | histogram | `platform`                           |
| `broadcast_review_decision_total`      | counter   | `platform`, `decision`               |
| `broadcast_optimization_duration_ms`   | histogram | `platform`                           |
| `broadcast_engagement_collected_total` | counter   | `platform`                           |

All operations logged via Pino with `contractId`, `contentMessageId`, `platform`.

---

## Invariants

1. **MESSAGE_IS_PLATFORM_AGNOSTIC** — `ContentMessage.body` never contains platform-specific formatting. Optimization is the adapter's job.
2. **ONE_POST_PER_PLATFORM** — A `ContentMessage` produces at most one `PlatformPost` per `PlatformId` (enforced by unique index).
3. **REVIEW_BEFORE_HIGH_RISK** — Posts assessed as HIGH risk must receive an explicit `approved` review decision before publishing. No auto-approve for HIGH.
4. **ADAPTERS_ARE_SWAPPABLE** — Adding a new platform requires only: (a) a `PublishPort` implementation, (b) a `ContentOptimizerPort` strategy, (c) a row in `PLATFORM_IDS`. No changes to core, features, or workflow.
5. **BLOG_IS_A_PLATFORM** — Blog posts use the same `ContentMessage → PlatformPost` pipeline as social posts. No special-case code paths.
6. **PUBLISH_IS_IDEMPOTENT** — `publishPost()` must no-op if the post already has an `externalId`. Prevents double-publishing on retries.
7. **USE_CASES_ARE_TEMPORAL_READY** — Orchestration functions in `broadcast-core/use-cases/` take ports as arguments. No HTTP, no framework deps, no env vars. Temporal activities wrap these directly.
8. **TEMPORAL_OWNS_DURABILITY** (Walk) — Publish retries, review waits, and engagement collection schedules are Temporal's responsibility. Crawl uses synchronous use-case calls; Walk wraps them in Temporal activities.
9. **ENGAGEMENT_IS_BEST_EFFORT** (Walk) — Not all platforms expose metrics. Missing data is null, never fabricated.
10. **RUNS_ARE_IMMUTABLE** (Walk) — When `broadcast_runs` is split out, records are append-only. Never update a run; create a new one on retry.

---

## Crawl / Walk / Run Phases

### Crawl (P0) — Core Pipeline + 3 Platforms

| Deliverable                                       | Est      | Notes                                                              |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `packages/broadcast-core` — domain model + ports  | 1.5      | Types, enums, port interfaces, error classes (no Campaign/Run yet) |
| `packages/db-schema` — broadcasting tables        | 0.5      | 2 tables with RLS (`content_messages`, `platform_posts`)           |
| `packages/db-client` — Drizzle broadcast adapters | 1.5      | User + Worker ports (simplified, no Run/Engagement CRUD)           |
| Discord `PublishPort` adapter                     | 0.5      | Webhook, simplest                                                  |
| Bluesky `PublishPort` adapter                     | 0.5      | @atproto/api                                                       |
| X `PublishPort` adapter                           | 1        | OAuth 2.0, free tier                                               |
| `broadcastWorkflow` Temporal workflow             | 2        | Draft → review → publish                                           |
| `ContentOptimizerPort` basic impl                 | 1        | LLM via GraphExecutorPort                                          |
| API contracts + routes                            | 1        | draft, review, status                                              |
| **Total**                                         | **~9.5** |                                                                    |

### Walk (P1) — LinkedIn + Blog + Engagement + Schema Evolution

| Deliverable                                                                        | Est |
| ---------------------------------------------------------------------------------- | --- |
| `broadcast_runs` table — split publish results out of `platform_posts` + migration | 1   |
| `engagement_snapshots` table + `EngagementPort` adapters (Bluesky, X, Blog)        | 2   |
| `campaigns` table + Campaign management (group messages)                           | 2   |
| LinkedIn `PublishPort` adapter                                                     | 2   |
| Blog `PublishPort` adapter (with blog dev)                                         | 2   |
| Engagement collection child workflow                                               | 1   |
| Risk-based auto-approval tiers (configurable)                                      | 1   |
| Cron-scheduled broadcasting via `@cogni/scheduler-core`                            | 1   |

### Run (P2) — Full Suite

| Deliverable                                             | Est |
| ------------------------------------------------------- | --- |
| YouTube upload adapter                                  | 2   |
| Content calendar UI                                     | 3   |
| A/B testing (post variants)                             | 2   |
| Cross-platform threading (X thread → LinkedIn carousel) | 2   |
| Review UI with side-by-side platform previews           | 2   |
| Analytics dashboard (engagement trends)                 | 2   |

---

## File Pointers (Planned)

| Component         | Path                                                             |
| ----------------- | ---------------------------------------------------------------- |
| Core package      | `packages/broadcast-core/`                                       |
| DB schema         | `packages/db-schema/src/broadcasting.ts`                         |
| DB adapters       | `packages/db-client/src/adapters/drizzle-broadcast-*.adapter.ts` |
| Platform adapters | `services/scheduler-worker/src/adapters/broadcast/`              |
| Temporal workflow | `services/scheduler-worker/src/workflows/broadcast.workflow.ts`  |
| Feature services  | `apps/web/src/features/broadcasting/services/`                   |
| API contracts     | `apps/web/src/contracts/broadcast.*.v1.contract.ts`              |
| API routes        | `apps/web/src/app/api/v1/broadcast/`                             |
| Review UI         | `apps/web/src/features/broadcasting/components/`                 |

---

## Related

- [Architecture Spec](architecture.md) — hexagonal layering rules
- [Feature Development Guide](../guides/feature-development.md) — contracts → core → ports → features → adapters → app
- [Scheduler Spec](scheduler.md) — Temporal patterns, `@cogni/scheduler-core`
- [Messenger Channels Spec](messenger-channels.md) — credential encryption pattern, channel_registrations
- [Broadcasting Research](../research/broadcasting-platform-integration.md) — API analysis, OSS comparison
- [Packages Architecture](packages-architecture.md) — package isolation rules
