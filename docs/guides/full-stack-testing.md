---
id: full-stack-testing-guide
type: guide
title: Full-Stack Testing
status: draft
trust: draft
summary: How to run and author stack tests across single-node and multi-node configurations. Covers test infrastructure, mock-LLM routing, billing callback verification, and per-node DB isolation.
read_when: Running stack tests, writing new stack tests, debugging billing callback failures, or setting up multi-node test infrastructure.
owner: derekg1729
created: 2026-04-02
verified: 2026-04-02
tags: [testing, stack-tests, billing, multi-node]
---

# Full-Stack Testing

Stack tests run against real HTTP endpoints with real databases, real LiteLLM, and deterministic mock-LLM responses. They prove that the full request path works: HTTP request -> app -> LiteLLM -> mock-LLM -> callback -> database.

## Test Levels

| Level                   | Infra                               | LLM                  | Database                    | Command                 |
| ----------------------- | ----------------------------------- | -------------------- | --------------------------- | ----------------------- |
| Unit                    | None                                | None                 | None                        | `pnpm test`             |
| Component               | Testcontainers (Postgres)           | None                 | Isolated per-test           | `pnpm test:component`   |
| Contract                | None (in-memory route handlers)     | None                 | None                        | `pnpm test:contract`    |
| **Stack (single-node)** | Docker Compose (test mode)          | mock-llm via LiteLLM | `cogni_template_stack_test` | `pnpm test:stack:dev`   |
| **Stack (multi-node)**  | Docker Compose (test mode)          | mock-llm via LiteLLM | Per-node test DBs           | `pnpm test:stack:multi` |
| E2E                     | Full Docker stack (production mode) | Real LLM             | Production-like DB          | `pnpm e2e`              |

## Single-Node Stack Tests

### Setup

```bash
# First time: create test database + run migrations
pnpm dev:stack:test:setup

# Daily: start test infra + app (keep running in a terminal)
pnpm dev:stack:test

# Run tests (in another terminal)
pnpm test:stack:dev

# Run a specific test file
pnpm dotenv -e .env.test -- vitest run --config apps/operator/vitest.stack.config.mts <testfile>
```

### What `dev:stack:test` provides

- **Postgres** on `localhost:55432` with database `cogni_template_stack_test`
- **LiteLLM** on `localhost:4000` using `litellm.test.config.yaml`
- **mock-llm** (mock-openai-api container) — deterministic responses, no model weights
- **Redis, Temporal, scheduler-worker** — full execution pipeline
- **App** on `localhost:3000` with `APP_ENV=test` (fake adapters for EVM, metrics, etc.)

### How mock-LLM works

LiteLLM's test config routes all models to `http://mock-llm:3000` (a Docker container running `zerob13/mock-openai-api`). This means:

1. App makes a normal LLM call through the `LiteLlmAdapter`
2. LiteLLM intercepts, looks up the model in test config
3. LiteLLM proxies to mock-llm, which returns a deterministic response
4. LiteLLM computes `response_cost` from the test pricing metadata
5. LiteLLM fires the billing callback (CogniNodeRouter) to the app's ingest endpoint
6. App writes `charge_receipt` to the database

Tests then poll the database for the receipt using `waitForReceipts()`.

### Test lifecycle

1. **Global setup** (vitest.stack.config.mts `globalSetup` sequence):
   - `preflight-binaries.ts` — verify `rg` and `git` available
   - `wait-for-probes.ts` — poll `/livez` then `/readyz`
   - `preflight-openclaw-gateway.ts` — wait for gateway healthcheck
   - `preflight-litellm-config.ts` — verify test config loaded (should see "test-model")
   - `preflight-mock-llm.ts` — send test completion through LiteLLM -> mock-llm
   - `preflight-db-roles.ts` — verify `app_user` and `app_service` roles exist
   - `reset-db.ts` — truncate all tables, re-seed system tenant

2. **Per-test**: seed test actor -> execute test -> assert -> cleanup

3. **No teardown** — `reset-db` runs at the start of next suite

### Writing a single-node stack test

```typescript
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { seedTestActor, type TestActor } from "@tests/_fixtures/stack/seed";
import { waitForReceipts } from "@tests/helpers/poll-db";

describe("[internal] my billing test", () => {
  let testActor: TestActor;

  beforeEach(async () => {
    const db = getSeedDb();
    testActor = await seedTestActor(db);
  });

  it("creates charge receipt after LLM call", async () => {
    // 1. Trigger action (via route handler import or fetch)
    const response = await POST(request, { params });
    expect(response.status).toBe(200);

    // 2. Wait for async billing callback
    const db = getSeedDb();
    const receipts = await waitForReceipts(db, testActor.billingAccountId);

    // 3. Assert receipt properties
    expect(receipts.length).toBeGreaterThanOrEqual(1);
    expect(receipts[0].runId).toBeDefined();
  });
});
```

**Key patterns:**

- Use `getSeedDb()` for service-role DB access (BYPASSRLS)
- Use `seedTestActor()` to create user + billing account + virtual key
- Use `waitForReceipts()` to poll for async callback results (10s timeout, 250ms interval)
- Single-node tests can import route handlers directly (`import { POST } from "@/app/..."`)

## Multi-Node Stack Tests

### Setup

```bash
# First time: create per-node test databases + run migrations
pnpm dev:stack:test:full:setup

# Daily: start test infra + all 3 nodes (keep running)
pnpm dev:stack:test:full

# Run multi-node tests (in another terminal)
pnpm test:stack:multi

# Run a specific multi-node test file
pnpm dotenv -e .env.test -- vitest run --config apps/operator/vitest.stack-multi.config.mts <testfile>
```

### What `dev:stack:test:full` provides

- **Operator** on `localhost:3000` with `cogni_template_stack_test` database
- **Poly** on `localhost:3100` with `cogni_poly_test` database
- **Resy** on `localhost:3300` with `cogni_resy_test` database
- **Shared LiteLLM** on `localhost:4000` with test config + `CogniNodeRouter` callback routing
- **mock-llm** — deterministic responses (same as single-node)
- **Shared Postgres** on `localhost:55432` with per-node test databases
- All nodes run with `APP_ENV=test` and `.env.test`

### How multi-node tests differ

| Aspect       | Single-node                           | Multi-node                        |
| ------------ | ------------------------------------- | --------------------------------- |
| Target       | One app on :3000                      | 3 apps on :3000, :3100, :3300     |
| Database     | Single test DB                        | Per-node test DBs                 |
| LLM config   | `litellm.test.config.yaml` (mock-llm) | Same (mock-llm)                   |
| Route access | Import handlers directly              | `fetch()` to HTTP endpoints       |
| DB reset     | Global `reset-db.ts`                  | Tests seed/cleanup their own data |
| Env file     | `.env.test`                           | `.env.test`                       |

### Why fetch() instead of route imports

Multi-node tests must use `fetch()` because:

- Route handler imports bypass the HTTP layer — they don't prove callback routing works
- Each node runs as a separate process on a different port
- The test needs to verify that LiteLLM routes the callback to the correct node

### Writing a multi-node stack test

```typescript
import { createServiceDbClient } from "@cogni/db-client/service";
import { chargeReceipts } from "@/shared/db/schema";
import { eq } from "drizzle-orm";

// Connect directly to each node's DB
const polyDb = createServiceDbClient(process.env.DATABASE_SERVICE_URL_POLY!);

it("poly callback → receipt in poly DB only", async () => {
  // 1. Seed test data in poly's DB
  const actor = await seedTestActorInDb(polyDb);

  // 2. POST billing callback to poly's HTTP endpoint
  const res = await fetch("http://localhost:3100/api/internal/billing/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BILLING_INGEST_TOKEN}`,
    },
    body: JSON.stringify([callbackPayload]),
  });
  expect(res.status).toBe(200);

  // 3. Verify receipt in poly DB
  const polyReceipts = await polyDb
    .select()
    .from(chargeReceipts)
    .where(eq(chargeReceipts.billingAccountId, actor.billingAccountId));
  expect(polyReceipts.length).toBe(1);

  // 4. Verify receipt NOT in operator or resy DBs
  const operatorReceipts = await operatorDb
    .select()
    .from(chargeReceipts)
    .where(eq(chargeReceipts.billingAccountId, actor.billingAccountId));
  expect(operatorReceipts.length).toBe(0);
});
```

### Multi-node test invariants

Each test should prove one of these spec invariants:

| Invariant                             | What to test                                      |
| ------------------------------------- | ------------------------------------------------- |
| NODE_LOCAL_METERING_PRIMARY           | Callback to node X → receipt in node X's DB       |
| DB_PER_NODE                           | Receipt in node X's DB absent from node Y's DB    |
| MISSING_NODE_ID_DEFAULTS_OPERATOR     | Callback without node_id → receipt in operator DB |
| CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID | Same callback twice → one receipt                 |
| CALLBACK_AUTHENTICATED                | Wrong Bearer token → 401                          |

## Troubleshooting

### "waitForReceipts timed out"

The LiteLLM callback didn't fire. Check:

1. LiteLLM container logs: `docker logs litellm 2>&1 | tail -20`
2. `COGNI_NODE_ENDPOINTS` is set correctly on the litellm container
3. `BILLING_INGEST_TOKEN` matches between LiteLLM env and app env
4. App is reachable from LiteLLM container (`host.docker.internal` resolves)

### "Node not reachable at localhost:3100"

Multi-node tests require `pnpm dev:stack:test:full` running. Check:

1. All 3 node processes are running (check terminal output)
2. Per-node test databases exist: `pnpm dev:stack:test:full:setup`
3. Per-node env vars are set in `.env.test` (DATABASE_URL_POLY, AUTH_SECRET_POLY, etc.)

### Tests pass individually but fail together

Likely a cleanup issue. Multi-node tests seed and clean their own data. If cleanup fails (e.g., FK constraint), subsequent tests may find stale data. Check `afterAll` cleanup order matches reverse FK order.

## Related

- [Testing Strategy](./testing.md) — test adapter pattern, APP_ENV=test
- [Developer Setup](./developer-setup.md) — first-time setup
- [Multi-Node Tenancy Spec](../spec/multi-node-tenancy.md) — invariants these tests prove
- [Billing Ingest Spec](../spec/billing-ingest.md) — callback pipeline architecture
