---
title: Event Taxonomy v0
status: active
owner: platform
created: 2025-02-28
---

# Event Taxonomy v0

> Single source of truth for PostHog product analytics events.
> Code registry: `apps/operator/src/shared/analytics/events.ts`

## Event Envelope (Required on Every Event)

Every event sent to PostHog **must** include:

| Field                    | Type    | Source               | Description                                          |
| ------------------------ | ------- | -------------------- | ---------------------------------------------------- |
| `event`                  | string  | caller               | Namespaced event name (e.g., `cogni.auth.signed_in`) |
| `timestamp`              | ISO8601 | capture() auto       | When the event occurred                              |
| `distinct_id`            | string  | `identity.userId`    | Canonical `users.id` UUID (or stable anon ID)        |
| `properties.session_id`  | string  | `identity.sessionId` | Session identifier                                   |
| `properties.tenant_id`   | string? | `identity.tenantId`  | Billing account ID (null for system events)          |
| `properties.environment` | string  | config               | `local\|preview\|staging\|prod`                      |
| `properties.app_version` | string  | config               | Git SHA or semver                                    |
| `properties.trace_id`    | string? | OTel context         | 32-char hex OTel trace ID (when available)           |

## Properties Invariants

- **No free-form nested blobs.** All properties are flat key-value pairs.
- **No PII.** No emails, raw tokens, secrets, wallet addresses, or IP addresses in properties.
- **Costs/tokens/models are numeric + normalized.** Costs in USD (float), tokens as integers, models as string IDs.
- **Event names are namespaced.** Format: `cogni.<domain>.<action>` (lowercase, snake_case).

---

## MVP Event Set (13 events)

### Auth Domain

#### `cogni.auth.signed_in`

User completed authentication (any provider).

| Property      | Type    | Description                                      |
| ------------- | ------- | ------------------------------------------------ |
| `provider`    | string  | Auth provider: `wallet\|github\|discord\|google` |
| `is_new_user` | boolean | Whether this is a first-time sign-in             |

**Answers:** How many users sign in? Which providers are most popular? New user acquisition rate?

#### `cogni.identity.provider_linked`

User linked an additional identity provider to their account.

| Property   | Type   | Description                                        |
| ---------- | ------ | -------------------------------------------------- |
| `provider` | string | Provider linked: `wallet\|github\|discord\|google` |

**Answers:** How many users link multiple providers? Which providers are linked most?

---

### Agent Execution (Core Loop)

#### `cogni.agent.run_requested`

Agent/graph run was requested.

| Property     | Type   | Description                                 |
| ------------ | ------ | ------------------------------------------- |
| `run_id`     | string | Unique run identifier                       |
| `agent_type` | string | Graph/agent type (e.g., `research`, `chat`) |
| `entrypoint` | string | Entry point (e.g., `api`, `schedule`)       |

**Answers:** How many runs are requested? Which agent types are most used? API vs scheduled?

#### `cogni.agent.run_completed`

Agent/graph run completed successfully.

| Property     | Type    | Description                          |
| ------------ | ------- | ------------------------------------ |
| `run_id`     | string  | Unique run identifier                |
| `success`    | boolean | Whether the run succeeded            |
| `latency_ms` | number  | Total execution time in milliseconds |
| `model`      | string  | Primary model used (e.g., `gpt-4o`)  |
| `cost_usd`   | number  | Total cost in USD                    |
| `tokens_in`  | number  | Total input tokens                   |
| `tokens_out` | number  | Total output tokens                  |

**Answers:** Success rate? Cost per run? Latency by model? Token usage patterns?

#### `cogni.agent.run_failed`

Agent/graph run failed.

| Property      | Type   | Description                                                      |
| ------------- | ------ | ---------------------------------------------------------------- |
| `run_id`      | string | Unique run identifier                                            |
| `error_class` | string | Error classification (e.g., `llm_error`, `insufficient_credits`) |
| `error_code`  | string | Specific error code                                              |

**Answers:** Failure rate? Top error classes? Which models fail most?

---

### Tool Use

#### `cogni.tool.connection_created`

User connected a new tool/service provider.

| Property   | Type   | Description                                  |
| ---------- | ------ | -------------------------------------------- |
| `provider` | string | Tool provider (e.g., `github`, `web_search`) |

**Answers:** Tool adoption rate? Which tools are connected most?

---

### Artifacts

#### `cogni.artifact.created`

An artifact was created (PR, work item, statement).

| Property      | Type   | Description                               |
| ------------- | ------ | ----------------------------------------- |
| `type`        | string | Artifact type: `pr\|work_item\|statement` |
| `artifact_id` | string | Unique artifact identifier                |

**Answers:** What artifacts are being produced? Production rate by type?

---

### Billing

#### `cogni.billing.credits_purchased`

User purchased credits.

| Property     | Type   | Description            |
| ------------ | ------ | ---------------------- |
| `amount_usd` | number | Purchase amount in USD |
| `credits`    | number | Credits received       |

**Answers:** Revenue per user? Purchase frequency? Average purchase size?

#### `cogni.billing.credits_spent`

Credits consumed by an agent run.

| Property  | Type   | Description               |
| --------- | ------ | ------------------------- |
| `credits` | number | Credits consumed          |
| `run_id`  | string | Associated run identifier |

**Answers:** Credit consumption rate? Cost per run in credits? Burn rate?

---

### Rate Limits

#### `cogni.rate_limit.hit`

Rate limit was triggered.

| Property   | Type   | Description                                |
| ---------- | ------ | ------------------------------------------ |
| `provider` | string | Rate-limited provider (e.g., `openrouter`) |
| `model`    | string | Model that was rate-limited                |

**Answers:** How often do we hit rate limits? Which providers/models are constrained?

---

### Scheduling

#### `cogni.schedule.created`

User created a new automated schedule.

| Property        | Type   | Description                     |
| --------------- | ------ | ------------------------------- |
| `schedule_type` | string | Type of schedule (e.g., `cron`) |
| `graph_id`      | string | Graph/agent being scheduled     |

**Answers:** Schedule adoption? Which graphs are automated most?

---

## Event Count: 13 (within 20-event MVP budget)

## Future Candidates (not in MVP)

- `cogni.nav.page_viewed` — deferred to avoid volume spam
- `cogni.user.profile_updated` — low signal for MVP
- `cogni.governance.vote_cast` — governance-specific
- `cogni.agent.first_run_completed` — derivable from `run_completed` + user history
