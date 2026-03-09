---
id: openclaw-sandbox-spec
type: spec
title: OpenClaw Sandbox Integration
status: active
spec_state: draft
trust: draft
summary: OpenClaw agent runtime in Cogni — two execution modes (ephemeral sandbox, long-running gateway), invariants, container images, LLM protocol, I/O protocol, billing
read_when: Implementing OpenClaw sandbox or gateway agent, modifying container images, or debugging sandbox LLM calls
owner: derekg1729
created: 2026-02-07
verified: 2026-02-15
tags: [sandbox, openclaw, ai-agents]
---

# OpenClaw Sandbox Integration

> [!CRITICAL]
> OpenClaw runs in two modes: **ephemeral** (one-shot `network=none` container, CLI invocation) and **gateway** (long-running service on `sandbox-internal` + `cogni-edge`, WS protocol). Gateway has internet egress (curl, git, web_fetch, web_search). Ephemeral remains fully isolated. Both route LLM calls through an nginx proxy to LiteLLM. OpenClaw's own sandbox and cron are **disabled** in both modes.

## Published Images

All images are multi-arch (`linux/amd64` + `linux/arm64`). Docker resolves the correct arch automatically.

| Image                         | GHCR Path                                            | Purpose                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **openclaw-outbound-headers** | `ghcr.io/cogni-dao/openclaw-outbound-headers:latest` | Fork of OpenClaw with patches for auth header forwarding and billing metadata. Build-time base only — not run directly.                                      |
| **cogni-sandbox-openclaw**    | `ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest`    | Wraps the above with Cogni devtools (pnpm, git, node:22). The image agents actually run in — used for both ephemeral and gateway modes.                      |
| **pnpm-store**                | `ghcr.io/cogni-dao/node-template:pnpm-store-latest`  | Snapshot of all project dependencies so agents can `pnpm install --offline` without downloading anything. Also tagged by lockfile hash: `pnpm-store-{hash}`. |

**Local dev equivalents:**

| pnpm script                              | What it does                                                   |
| ---------------------------------------- | -------------------------------------------------------------- |
| `pnpm sandbox:openclaw:docker:build`     | Build `cogni-sandbox-openclaw:latest` locally                  |
| `pnpm sandbox:pnpm-store:seed`           | Build pnpm-store image + seed `pnpm_store` volume (idempotent) |
| `pnpm sandbox:pnpm-store:seed:from-ghcr` | Pull from GHCR + seed (for fresh clones without building)      |

## Execution Modes

|                       | Ephemeral                                    | Gateway                                                                          |
| --------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| **Container**         | `cogni-sandbox-openclaw:latest`              | `cogni-sandbox-openclaw:latest` (entrypoint overridden to gateway mode)          |
| **Lifecycle**         | One-shot per run, destroyed after            | Long-running compose service, shared                                             |
| **Network**           | `network=none` (isolated)                    | `sandbox-internal` + `cogni-edge` (Docker DNS + internet egress)                 |
| **Invocation**        | CLI: `--local --agent main --message ...`    | WS: custom frame protocol on port 18789                                          |
| **Concurrency**       | Single user per container                    | Multiple concurrent sessions                                                     |
| **LLM proxy**         | Per-run nginx via unix socket (socat)        | Shared nginx (`llm-proxy-openclaw:8080`) via TCP                                 |
| **Billing headers**   | Proxy **overwrites** `x-litellm-end-user-id` | OpenClaw **injects** per-session via `outboundHeaders`; proxy **passes through** |
| **Session isolation** | Container boundary (invariant 19)            | Session key: `agent:main:{billingAccountId}:{runId}`                             |

## Context

The sandbox runtime ([Sandboxed Agents](sandboxed-agents.md), invariants 1–12) provides isolated container execution for AI agents. OpenClaw is a third-party agent runtime that supports autonomous multi-turn tool-use loops. This spec defines how OpenClaw integrates with Cogni across both execution modes: what is disabled, how LLM calls route through the proxy, container images, invocation protocols, and billing.

## Goal

Define the invariants and design contracts for running OpenClaw in Cogni: which OpenClaw features are disabled, how the two execution modes work, how LLM calls transit the proxy, how billing is tracked through LiteLLM.

## Non-Goals

- OpenClaw Lit-based Control UI / dashboard (invariant 18)
- Passing API keys or git credentials into containers (SECRETS_HOST_ONLY)
- Multi-stage Docker image optimization (see [proj.sandboxed-agents](../../work/projects/proj.sandboxed-agents.md))
- Graph provider wiring, agent catalog, or bootstrap integration (see [openclaw-sandbox-controls](openclaw-sandbox-controls.md))
- Streaming passthrough from OpenClaw to client (deferred)

## Core Invariants

> Numbering continues from [Sandboxed Agents](sandboxed-agents.md) invariants 1–12.

### Shared (both modes)

13. **OPENCLAW_SANDBOX_OFF**: OpenClaw's built-in sandbox (`sandbox.mode`) is always `"off"`. Docker is not available inside the container; enabling OpenClaw's sandbox would hard-fail on `docker create`.

14. **OPENCLAW_CRON_DISABLED**: OpenClaw's cron scheduler (`cron.enabled`) is always `false`. Temporal is scheduler-of-record. Duplicate schedulers cause billing surprises and audit gaps.

15. **OPENCLAW_ELEVATED_DISABLED**: OpenClaw's elevated tool mode (`tools.elevated.enabled`) is always `false`. Elevated mode bypasses tool policy and would collapse the security boundary.

16. **COGNI_IS_MODEL_ROUTER**: OpenClaw's model providers are set to `mode: "replace"` with a single `cogni` provider. All built-in providers are stripped. The `baseUrl` differs by mode:
    - Ephemeral: `http://localhost:8080/v1` (socat → unix socket → per-run proxy)
    - Gateway: `http://llm-proxy-openclaw:8080/v1` (Docker DNS → shared proxy)

17. **NO_OPENCLAW_DASHBOARD**: OpenClaw's Control UI and bridge port are not exposed. The proxy only serves `/v1/*` (LLM) and `/health`.

18. **LITELLM_IS_BILLING_TRUTH**: OpenClaw's self-reported usage is a UX hint only. Authoritative billing comes from LiteLLM spend logs, correlated by proxy audit log.

### Ephemeral mode only

19. **EPHEMERAL_NO_GATEWAY**: The gateway service is never started inside the `network=none` sandbox. Gateway mode requires network listeners and persistent state that conflict with one-shot container semantics.

20. **ONE_RUN_ONE_SESSION**: Each `SandboxRunnerAdapter.runOnce()` invocation is a fresh OpenClaw session. Session state does not persist across runs. Conversation history is injected via workspace files (see [Agent I/O Protocol](#agent-io-protocol)).

### Gateway mode only

21. **GATEWAY_NETWORK_ACCESS**: The OpenClaw gateway runs on `sandbox-internal` (LLM proxy access) and `cogni-edge` (internet egress for curl, git, web search). Never exposed to the public internet. Auth via token (`gateway.auth.mode: "token"`). `GITHUB_TOKEN` is passed as env var for GitHub API access via curl. `COGNI_REPO_URL` is passed for git remote setup. Ephemeral containers remain `network=none`.

22. **OUTBOUND_HEADERS_PER_SESSION**: Billing headers (`x-litellm-end-user-id`, `x-litellm-spend-logs-metadata`, `x-cogni-run-id`) are set per-session via the `outboundHeaders` field on the WS `agent` call. The gateway proxy passes these through to LiteLLM without overwriting.

23. **SESSION_KEY_ISOLATION**: Each Cogni run gets a unique session key (`agent:main:{billingAccountId}:{runId}`). Concurrent users are isolated by session — no shared session state, no cross-contamination of billing headers. Validated empirically (see [research](../research/openclaw-gateway-header-injection.md#5-patch-validation-results-2026-02-09)).

24. **WS_EVENT_CAUSALITY**: Every streamed chat token is attributable to exactly one request. The gateway client hard-filters all chat event frames by `payload.sessionKey` — frames with missing or mismatched sessionKey are dropped (fail-closed, no fallback). `sessionKey` is required in `RunAgentOptions` (compile-time enforcement). The gateway broadcasts chat events to all connected WS clients; this filter is the isolation mechanism. See `openclaw-gateway-client.ts:304-313`.

25. **HEARTBEAT_DISABLED**: OpenClaw heartbeats (`heartbeat.every`) are set to `"0"` in both `openclaw-gateway.json` and `openclaw-gateway.test.json`, disabling the heartbeat runner entirely. Heartbeats serve no purpose for backend agent usage and cause `HEARTBEAT_OK` contamination when combined with broadcast chat events (see bug.0021).

26. **IMAGE_FROM_PUBLISHED_BASE**: The `cogni-sandbox-openclaw` Dockerfile must reference a published GHCR OpenClaw image (with header-forwarding) as its base — never `openclaw:local`. The base is parameterized via `ARG OPENCLAW_BASE` with the GHCR tag as default.

27. **COMPOSE_IMAGE_PARITY**: Dev and prod compose files reference the same `cogni-sandbox-openclaw` image tag for the `openclaw-gateway` service. Architecture differences are handled by the multi-arch manifest — not by different image references.

28. **SESSION_MODEL_OVERRIDE**: `SandboxGraphProvider.createGatewayExecution()` calls `configureSession(sessionKey, outboundHeaders, model)` before every `runAgent()` call. OpenClaw's `sessions.patch` handler resolves the model through the gateway model catalog and sets `modelOverride`/`providerOverride` on the session entry. Without this, the gateway uses its config default model regardless of `GraphRunRequest.model`. See `openclaw-gateway-client.ts:configureSession()`, `sandbox-graph.provider.ts:476-482`.

---

## Design

### Architecture

#### Ephemeral Mode

```
SandboxGraphProvider
  1. Create tmp workspace, write .cogni/prompt.txt + openclaw.json
  2. SandboxRunnerAdapter.runOnce({ image: openclaw, llmProxy: ... })
  3. Parse stdout JSON → emit AiEvents
  4. Reconcile billing via proxy audit log
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ SANDBOX CONTAINER: cogni-sandbox-openclaw (network=none)    │
│                                                             │
│  node /app/dist/index.js agent --local --agent main         │
│       --message "..." --session-id ${RUN_ID} --json         │
│                                                             │
│  Pi agent runtime (multi-turn tool loop):                   │
│    → POST localhost:8080/v1/chat/completions                │
│    ← tool_calls → execute locally → repeat                  │
│                                                             │
│  socat (localhost:8080 ↔ /llm-sock/llm.sock)               │
└────────────────────────┼────────────────────────────────────┘
                         │ unix socket (Docker volume)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ PER-RUN PROXY: nginx:alpine (sandbox-internal)              │
│  OVERWRITES: Authorization, x-litellm-end-user-id,         │
│              x-litellm-spend-logs-metadata                  │
│  Forwards → http://litellm:4000                             │
└─────────────────────────────────────────────────────────────┘
```

#### Gateway Mode

```
SandboxGraphProvider
  1. WS connect to openclaw-gateway:18789 (token auth, protocol v3)
  2. WS agent call with outboundHeaders (billing + x-cogni-run-id)
  3. Parse WS response → emit AiEvents
  4. grep proxy audit log by x-cogni-run-id for billing
         │
         ▼  WS (custom frame protocol, NOT JSON-RPC)
┌─────────────────────────────────────────────────────────────┐
│ GATEWAY: cogni-sandbox-openclaw (sandbox-internal:18789)    │
│  Long-running, concurrent sessions                          │
│  Session key: agent:main:{billingAccountId}:{runId}         │
│                                                             │
│  Pi agent runtime per session (multi-turn tool loop):       │
│    → POST llm-proxy-openclaw:8080/v1/chat/completions      │
│      with outboundHeaders merged into outbound request      │
│    ← tool_calls → execute locally → repeat                  │
└────────────────────────┼────────────────────────────────────┘
                         │ TCP (Docker DNS)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ SHARED PROXY: llm-proxy-openclaw (sandbox-internal:8080)    │
│  INJECTS: Authorization: Bearer ${LITELLM_MASTER_KEY}       │
│  PASSES THROUGH: x-litellm-end-user-id,                    │
│    x-litellm-spend-logs-metadata, x-cogni-run-id           │
│  Forwards → http://litellm:4000                             │
│  Audit log keyed by x-cogni-run-id for per-run billing      │
└─────────────────────────────────────────────────────────────┘
```

**Key insight**: OpenClaw may make **many** LLM calls per run (one per tool-use turn). Every call transits the proxy. In ephemeral mode, the proxy injects billing headers. In gateway mode, OpenClaw injects them via per-session `outboundHeaders` and the proxy passes them through. LiteLLM tracks all calls; we never count tokens ourselves.

---

### LLM API Protocol

OpenClaw speaks standard **OpenAI Chat Completions** (`/v1/chat/completions`) via its `api: "openai-completions"` provider mode.

#### Request Flow (per LLM turn)

```
OpenClaw runtime
  │  POST http://localhost:8080/v1/chat/completions
  │  Headers: Authorization: Bearer proxy-handles-auth  (ignored by proxy)
  │           Content-Type: application/json
  │  Body: {
  │    "model": "gemini-2.5-flash",        ← LiteLLM alias, from openclaw.json
  │    "messages": [...],                   ← OpenClaw manages conversation
  │    "tools": [...],                      ← OpenClaw's tool definitions
  │    "stream": true                       ← OpenClaw streams by default
  │  }
  ▼
socat (localhost:8080 → /llm-sock/llm.sock)
  ▼
nginx proxy (overwrites all auth/billing headers)
  │  Authorization: Bearer ${LITELLM_MASTER_KEY}
  │  x-litellm-end-user-id: ${billingAccountId}
  │  x-litellm-spend-logs-metadata: {"run_id":"...","attempt":0,"graph_id":"sandbox:agent",...}
  ▼
LiteLLM (litellm:4000)
  │  Resolves model alias → OpenRouter upstream
  ▼
OpenRouter → upstream provider (Anthropic, Google, OpenAI, etc.)
```

#### What OpenClaw Sends

OpenClaw's `openai-completions` API mode sends standard requests:

- `POST /v1/chat/completions` with `stream: true`
- Tool definitions in the `tools` array (OpenAI function-calling format)
- Conversation history managed by OpenClaw's Pi runtime
- Model name matches the `id` field from the `cogni` provider's `models` array

#### What Our Proxy Does

Per the existing nginx template (unchanged from P0.5):

- **Overwrites** `Authorization` header with `Bearer ${LITELLM_MASTER_KEY}`
- **Overwrites** `x-litellm-end-user-id` with `${billingAccountId}`
- **Overwrites** `x-litellm-spend-logs-metadata` with run correlation JSON
- **Forwards** to `http://litellm:4000` (Docker DNS)
- **Streams** SSE responses back (`proxy_buffering off`, `proxy_read_timeout 300s`)
- **Logs** each request (timestamp, model, status, latency — no prompts)

#### What OpenClaw Receives

Standard OpenAI SSE streaming response. OpenClaw's Pi runtime parses `tool_calls` from the response, executes tools locally inside the container, appends tool results to the conversation, and calls the LLM again. This loop repeats until the LLM returns a text-only response (no more tool calls).

#### Routes Used

| Route                       | Used by OpenClaw                 | Purpose                                                    |
| --------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `POST /v1/chat/completions` | Yes                              | All LLM calls                                              |
| `GET /v1/models`            | Possibly (model discovery)       | Proxy forwards all methods on `/v1/`; LiteLLM handles this |
| `GET /health`               | No (socat bridges, not OpenClaw) | Proxy health check                                         |
| `POST /v1/responses`        | No                               | Would require `api: "openai-responses"`                    |

---

### Container Image

One image for both modes: `cogni-sandbox-openclaw:latest` (`ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest`).

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Image Build (multi-stage)                                             │
│                                                                        │
│  Stage 1: GHCR openclaw-outbound-headers ──────────────────────┐       │
│    (forked header-forwarding OpenClaw, /app runtime)           │       │
│                                                                │       │
│  Stage 2: node:22-bookworm                                     │       │
│    ├── COPY --from=stage1 /app  ◄──────────────────────────────┘       │
│    ├── apt: socat, git, jq, curl                                       │
│    ├── corepack: pnpm@9.12.2                                           │
│    ├── ENV PNPM_STORE_DIR=/pnpm-store                                  │
│    ├── ENV HOME=/workspace                                             │
│    ├── user: sandboxer (1001:1001)                                     │
│    └── entrypoint: sandbox-entrypoint.sh (socat bridge)                │
│                                                                        │
│  Output: cogni-sandbox-openclaw:latest                                 │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Runtime: Gateway Mode                                                 │
│  compose entrypoint override: ["node", "/app/dist/index.js", "gateway"]│
│  (sandbox-entrypoint.sh bypassed — devtools unused but present)        │
│                                                                        │
│  Runtime: Ephemeral Mode                                               │
│  default entrypoint: sandbox-entrypoint.sh (socat + bash -lc "$@")    │
│  (devtools available: pnpm, git for coding agents)                     │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Image Build Parameterization

```dockerfile
ARG OPENCLAW_BASE=ghcr.io/cogni-dao/openclaw-outbound-headers:latest
FROM ${OPENCLAW_BASE} AS openclaw
FROM node:22-bookworm
COPY --from=openclaw /app /app
# ... devtools, sandboxer user, entrypoint
```

The base image `openclaw-outbound-headers:latest` is a multi-arch manifest (arm64+amd64). No per-arch overrides needed — Docker resolves the correct arch automatically at build time.

#### Storage Volumes

```
┌─────────────────────────────────────────────────────────────┐
│  Container: cogni-sandbox-openclaw                          │
│                                                             │
│  /workspace/          ← RW repo checkout (agent edits here) │
│  /pnpm-store/         ← persistent pnpm CAS (named volume)  │
│  /app/                ← OpenClaw runtime (from image, RO)    │
│  /etc/openclaw/       ← config bind-mount (RO)               │
│  /llm-sock/           ← LLM proxy unix socket (volume)       │
└─────────────────────────────────────────────────────────────┘
```

| Volume       | Mount         | Purpose                                      | Persists? |
| ------------ | ------------- | -------------------------------------------- | --------- |
| `pnpm_store` | `/pnpm-store` | pnpm content-addressable store across runs   | Yes       |
| `repo_data`  | `/repo`       | git-synced codebase mirror (gateway: RO)     | Yes       |
| workspace    | `/workspace`  | agent working directory (ephemeral or tmpfs) | Per-mode  |

`PNPM_STORE_DIR=/pnpm-store` is set in the image ENV. First `pnpm install` populates the store; subsequent installs relink from cache (~250ms vs ~5s cold).

**Temporary (P0):** Agent's first action must be `pnpm install --offline --frozen-lockfile` in the RW workspace. P1 replaces this with a compose bootstrap service (task.0036).

#### Entrypoint

`sandbox-entrypoint.sh`: starts socat bridge (`localhost:8080 → /llm-sock/llm.sock`), then execs `bash -lc "$@"`. Gateway mode overrides entrypoint entirely.

#### ReadonlyRootfs Compatibility

`ReadonlyRootfs: true` with tmpfs at `/tmp` and `/run`. Writable paths:

- `/workspace/` — `HOME=/workspace`, agent file ops, OpenClaw config/state
- `/pnpm-store/` — named volume for pnpm CAS
- `OPENCLAW_STATE_DIR=/workspace/.openclaw-state` prevents writes to readonly rootfs

---

### OpenClaw Configuration

The `SandboxGraphProvider` generates this config and writes it to `/workspace/.openclaw/openclaw.json` before each run.

#### Base Config (invariant across all runs)

```json5
{
  // ── Agent defaults ──
  agents: {
    defaults: {
      model: {
        primary: "cogni/${MODEL_ID}", // set per-run from GraphRunRequest
      },
      workspace: "/workspace", // container workspace root
      sandbox: { mode: "off" }, // invariant 13: OPENCLAW_SANDBOX_OFF
      skipBootstrap: true, // we pre-create workspace files
      timeoutSeconds: 540, // < container timeout (600s) for clean exit
    },
    list: [
      {
        id: "main",
        default: true,
        workspace: "/workspace",
      },
    ],
  },

  // ── Model routing ──
  models: {
    mode: "replace", // invariant 16: strip all built-in providers
    providers: {
      cogni: {
        baseUrl: "http://localhost:8080/v1", // socat → socket → proxy → LiteLLM
        apiKey: "proxy-handles-auth", // overwritten by proxy, value is irrelevant
        api: "openai-completions",
        models: [
          // ── generated at runtime from LiteLLM config ──
          // see "Model Catalog Sync" section
        ],
      },
    },
  },

  // ── Tool policy ──
  tools: {
    elevated: { enabled: false }, // invariant 15: OPENCLAW_ELEVATED_DISABLED
    deny: [
      // group:web ALLOWED — gateway has internet egress via cogni-edge network
      "browser", // Chrome CDP — no Chromium, no display
      "cron", // invariant 14: OPENCLAW_CRON_DISABLED
      "gateway", // no gateway running
      "nodes", // no device mesh
      "sessions_send", // no multi-session routing
      "sessions_spawn", // no sub-agent spawning
      "message", // no channel delivery
    ],
  },

  // ── Cron ──
  cron: {
    enabled: false, // invariant 14: OPENCLAW_CRON_DISABLED
  },

  // ── Gateway ──
  gateway: {
    mode: "local", // no gateway service
  },
}
```

#### Allowed Tools (what OpenClaw CAN do inside the sandbox)

| Tool               | Works? | Notes                                                                     |
| ------------------ | ------ | ------------------------------------------------------------------------- |
| `exec` (bash)      | Yes    | Runs commands inside the container. This is intentional.                  |
| `read`             | Yes    | Reads files in `/workspace`                                               |
| `write`            | Yes    | Writes files in `/workspace`                                              |
| `edit`             | Yes    | Edits files in `/workspace`                                               |
| `apply_patch`      | Yes    | Applies patches in `/workspace`                                           |
| `image`            | Maybe  | Uses LLM for generation — would work if model supports it, but not tested |
| `web_fetch`        | Yes    | Gateway has internet egress via `cogni-edge`. Ephemeral: still denied.    |
| `web_search`       | Yes    | Gateway has internet egress via `cogni-edge`. Ephemeral: still denied.    |
| `browser`          | No     | Denied — no Chromium, no display                                          |
| `cron`             | No     | Denied — Temporal is scheduler                                            |
| `memory`           | Yes    | Vector memory within workspace (local files only)                         |
| `sessions_list`    | Yes    | Read-only session introspection                                           |
| `sessions_history` | Yes    | Read-only session history                                                 |

#### Model Catalog Sync

The `cogni` provider's `models` array must list every LiteLLM model alias the agent might use. The `SandboxGraphProvider` generates this from our LiteLLM config.

**Mapping from LiteLLM config** (`platform/infra/services/runtime/configs/litellm.config.yaml`):

```json5
// Each LiteLLM model_name becomes an OpenClaw model entry:
{
  id: "gemini-2.5-flash", // matches litellm model_name
  name: "Gemini 2.5 Flash", // display name
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000, // approximate, from provider docs
  maxTokens: 8192,
}
```

We set all costs to `0` because we do NOT want OpenClaw tracking costs — LiteLLM is the billing truth (invariant 11).

---

### Agent I/O Protocol

#### Input

The `SandboxGraphProvider` prepares the workspace before invoking `runOnce()`:

```
/workspace/
├── .openclaw/
│   └── openclaw.json               # generated config (see above)
├── .cogni/
│   └── prompt.txt                   # user's message text (extracted from GraphRunRequest)
└── repo/                            # optional: host-cloned target repository
    └── ...
```

**`prompt.txt`**: The last user message from `GraphRunRequest.messages`, extracted as plain text. OpenClaw does not accept structured multi-message input via `--message` — it takes a single text string.

#### Invocation

The `SandboxGraphProvider` calls `runOnce()` with:

```typescript
// Environment via llmProxy.env (injected by SandboxRunnerAdapter as container Env)
const env = {
  HOME: "/workspace",
  OPENCLAW_CONFIG_PATH: "/workspace/.openclaw/openclaw.json",
  OPENCLAW_STATE_DIR: "/workspace/.openclaw-state",
  OPENCLAW_LOAD_SHELL_ENV: "0",
};

// Command via argv (adapter joins with space, entrypoint runs via bash -lc)
const argv = [
  "node /app/dist/index.js agent",
  "--local --agent main",
  `--session-id ${runId}`,
  '--message "$(cat /workspace/.cogni/prompt.txt)"',
  "--json --timeout 540",
];
// Note: adapter joins argv with " " into a single Cmd string, then
// entrypoint.sh runs it via `bash -lc "$@"` — shell expansion happens
// inside the container, so $(cat ...) resolves correctly.
```

**Effective command inside container:**

```bash
HOME=/workspace \
OPENCLAW_CONFIG_PATH=/workspace/.openclaw/openclaw.json \
OPENCLAW_STATE_DIR=/workspace/.openclaw-state \
OPENCLAW_LOAD_SHELL_ENV=0 \
node /app/dist/index.js agent \
  --local --agent main \
  --session-id "${RUN_ID}" \
  --message "$(cat /workspace/.cogni/prompt.txt)" \
  --json --timeout 540
```

**Flag breakdown**:

| Flag           | Value       | Why                                                                          |
| -------------- | ----------- | ---------------------------------------------------------------------------- |
| `--local`      | (boolean)   | Bypass gateway, run embedded agent directly                                  |
| `--agent main` | `"main"`    | Route to the default agent defined in config                                 |
| `--session-id` | `${RUN_ID}` | Unique per sandbox invocation, used for session state                        |
| `--message`    | prompt text | The user's message to the agent                                              |
| `--json`       | (boolean)   | Output structured JSON to stdout (no other output)                           |
| `--timeout`    | `540`       | Agent timeout in seconds. Must be < container `maxRuntimeSec` for clean exit |

#### Output

With `--json`, OpenClaw writes a JSON envelope to **stdout**:

```json5
{
  payloads: [
    {
      text: "The agent's final text response",
      mediaUrl: null,
    },
  ],
  meta: {
    durationMs: 12450,
    agentMeta: {
      sessionId: "run-abc123",
      provider: "cogni", // our provider name
      model: "cogni/gemini-2.5-flash",
      usage: {
        // OpenClaw-reported (UX hint only)
        input: 3200,
        output: 890,
        total: 4090,
      },
    },
    error: null, // or { "kind": "context_overflow", "message": "..." }
  },
}
```

**`SandboxGraphProvider` parsing**:

1. Parse stdout as JSON
2. Extract `payloads[0].text` → emit as `text_delta` AiEvent
3. Check `meta.error` → if present, return `GraphFinal.error`
4. `meta.agentMeta.usage` is a **UX hint only** — authoritative billing from LiteLLM `/spend/logs`
5. If stdout is not valid JSON (agent crash), treat as `GraphFinal.error` with stderr as diagnostics

#### Exit Codes

| Code    | Meaning                                         | Action                                |
| ------- | ----------------------------------------------- | ------------------------------------- |
| `0`     | Success (even if `meta.error` is set)           | Parse JSON, check `meta.error`        |
| `1`     | CLI error (missing flags, config parse failure) | Return `GraphFinal.error` with stderr |
| `137`   | OOM killed (SIGKILL)                            | Return `errorCode: "oom_killed"`      |
| timeout | Container killed by `SandboxRunnerAdapter`      | Return `errorCode: "timeout"`         |

---

### Agent Provisioning Guide

#### How OpenClaw Agents Work

Each OpenClaw agent is defined by:

1. **Config entry** in `openclaw.json` under `agents.list[]`
2. **Workspace directory** containing behavior files
3. **Model assignment** (which LLM to use)

#### Pre-Configured Agent Setup (No Interactive Onboard)

OpenClaw does NOT require `openclaw onboard` to run. It gracefully defaults to `{}` if the config file is empty. Our `SandboxGraphProvider` generates the full config, so no onboarding is needed.

**Minimum required for agent to run:**

1. `openclaw.json` exists with provider config (generated by us)
2. At least one of `--agent`, `--session-id`, or `--to` is passed (we use `--agent main`)
3. LLM endpoint is reachable (our proxy at `localhost:8080`)

#### Workspace Behavior Files

OpenClaw reads these files from the workspace directory at session start. They form the agent's system prompt:

| File           | Purpose                          | Required?                        |
| -------------- | -------------------------------- | -------------------------------- |
| `AGENTS.md`    | Main operating instructions      | Recommended                      |
| `SOUL.md`      | Agent personality and philosophy | Recommended                      |
| `USER.md`      | Context about the user/DAO       | Optional                         |
| `TOOLS.md`     | Environment-specific tool notes  | Optional                         |
| `IDENTITY.md`  | Name, emoji, avatar              | Optional                         |
| `HEARTBEAT.md` | Proactive task checklist         | Not used (cron disabled)         |
| `BOOTSTRAP.md` | First-run onboarding             | Not used (`skipBootstrap: true`) |
| `MEMORY.md`    | Long-term curated memory         | Optional                         |

**For Cogni sandbox agents**, the `SandboxGraphProvider` should pre-create at minimum:

```markdown
# /workspace/AGENTS.md

You are a Cogni coding agent. You have access to bash, file read/write/edit,
web_fetch, web_search, curl, and git. You have internet access for research.
GITHUB_TOKEN is set — use it for GitHub API calls via curl.
LLM calls route through the proxy. Do not attempt browser actions (no Chromium).
```

```markdown
# /workspace/TOOLS.md

## Git Remote Setup

Your workspace was cloned from a local mirror. To interact with GitHub:
git remote set-url origin "$COGNI_REPO_URL"
  git config credential.helper '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'
Then git fetch/push/pull work normally. COGNI_REPO_URL and GITHUB_TOKEN are in your env.

## GitHub API (no gh CLI — use curl)

curl -sH "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/OWNER/REPO/...
```

```markdown
# /workspace/SOUL.md

You are a focused, technical coding agent. Be direct and concise.
Write clean code. Explain your reasoning. Ask clarifying questions
if the task is ambiguous.
```

#### Skills

OpenClaw skills (in `skills/` directory) provide domain-specific behavior. The gateway has internet egress, so web-based skills (web search, API calls, curl) are functional. `gh` CLI is not installed — use `curl` with `GITHUB_TOKEN` for GitHub API calls. Browser-based skills remain non-functional (no Chromium). Ephemeral mode (`network=none`) has no network access — web skills are denied there.

#### Cogni Skills (MVP)

Gateway-only skills for governance and observability. Require env vars passed to `openclaw-gateway` service.

| Skill               | Purpose                                          | Env Vars Required                                       | Gateway Only |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------- | ------------ |
| `deployment-health` | Query Grafana metrics (LLM cost, service health) | `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN` (Viewer) | Yes          |

---

### Billing & Observability

#### Billing Flow

Unchanged from [Sandboxed Agents](sandboxed-agents.md) P0.5 design and [external-executor-billing](external-executor-billing.md):

1. Every LLM call from OpenClaw transits our nginx proxy
2. Proxy injects `x-litellm-end-user-id: ${billingAccountId}`
3. Proxy injects `x-litellm-spend-logs-metadata: { "run_id": "${runId}", ... }`
4. LiteLLM records spend per `end_user` with `metadata.run_id`
5. After sandbox exits, `reconcileRun()` queries `GET /spend/logs?end_user=${billingAccountId}` and filters by `metadata.run_id`
6. Emits `usage_report` AiEvent → `RunEventRelay` commits `charge_receipt`

**OpenClaw-specific consideration**: A single sandbox run may generate 5–50+ LLM calls (one per tool-use turn). All are tracked under the same `billingAccountId` + `run_id`. The reconciliation query returns all of them. Sum `completion_tokens` + `prompt_tokens` across all calls for total run cost.

#### Observability

- **Proxy audit log**: Every LLM request logged with timestamp, model, status, latency
- **LiteLLM → Langfuse**: All calls traced via `x-litellm-spend-logs-metadata` (contains `existing_trace_id`, `session_id`)
- **OpenClaw stdout**: Agent's final response and metadata (parsed by `SandboxGraphProvider`)
- **OpenClaw stderr**: Diagnostic output if agent fails (captured by `SandboxRunnerAdapter`)

#### Token Consumption Risk

OpenClaw's autonomous tool-use loop has no explicit turn limit. A pathological agent could loop indefinitely, consuming tokens until the container timeout (default 600s).

**Mitigations (layered)**:

1. Container `maxRuntimeSec` (hard kill at timeout)
2. OpenClaw `--timeout` flag (clean exit before container kill)
3. LiteLLM per-key spend limits (backstop for runaway billing)
4. Proxy `proxy_read_timeout 300s` (individual request timeout)

---

### Conversation Continuity

Each sandbox invocation creates a new OpenClaw session (invariant 19: ONE_RUN_ONE_SESSION). No conversation history persists. The user's message is passed via `--message`, and the agent responds without prior context.

This is acceptable for single-turn task execution ("fix this bug", "write this function").

---

### Anti-Patterns

| Pattern                                  | Problem                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Enable OpenClaw sandbox (`mode: "all"`)  | Docker not available in container; hard crash                    |
| Enable OpenClaw cron                     | Duplicate scheduler; billing surprises                           |
| Enable elevated tools                    | Collapses sandbox security boundary                              |
| Use `models.mode: "merge"`               | Built-in providers cause auth resolution noise, confusing errors |
| Start OpenClaw gateway in sandbox        | Requires network listeners; violates one-shot semantics          |
| Pass API keys via env to sandbox         | Violates SECRETS_HOST_ONLY; proxy handles auth                   |
| Trust OpenClaw's usage reporting         | UX hint only; LiteLLM is billing truth                           |
| Run `openclaw onboard` in container      | Interactive; not needed with pre-created config                  |
| Mount Docker socket into sandbox         | Allows container escape; violates NETWORK_DEFAULT_DENY           |
| Leave `web_fetch`/`browser` enabled      | Immediate failure (`network=none`); confuses agent               |
| Proxy OpenClaw dashboard                 | Network + ports required; not until P2+                          |
| Persist sessions without workspace mount | Session state lost on container exit                             |
| `FROM openclaw:local` in published image | Non-deterministic; may lack header-forwarding (invariant 26)     |
| Different images for dev vs prod gateway | Compose drift; violates COMPOSE_IMAGE_PARITY (invariant 27)      |

## Acceptance Checks

**Automated:**

- `pnpm check:docs` — validates spec frontmatter and required headings

**Manual:**

1. Verify `docker run --rm cogni-sandbox-openclaw node /app/dist/index.js --version` outputs expected version
2. Verify sandbox container has no network access (`curl` fails) and no `LITELLM_MASTER_KEY` in env
3. Verify OpenClaw JSON output parses correctly (see `tests/_fixtures/sandbox/openclaw-expected-output.json`)

## Open Questions

### OQ-2: `/v1/models` Discovery

Does OpenClaw call `GET /v1/models` at startup or during model resolution? Our nginx proxy forwards **all methods** on `/v1/` (not just POST), so `GET /v1/models` would pass through to LiteLLM, which supports this endpoint. The question is whether OpenClaw actually makes this call when models are pre-configured in `openclaw.json`, or whether it's only used for auto-discovery of available models.

**Resolution**: Likely a non-issue since the proxy forwards it and LiteLLM handles it. Verify by checking proxy access logs during an OpenClaw test run.

### OQ-3: OpenAI Completions vs Responses API

OpenClaw supports both `openai-completions` and `openai-responses`. We default to `openai-completions` because LiteLLM's OpenAI-compatible proxy speaks this format. But `openai-responses` may have benefits (reasoning separation). Does LiteLLM support the Responses API format?

**Resolution**: Use `openai-completions` for P0.75. Evaluate Responses API if LiteLLM adds support.

### OQ-5: Workspace File Ownership

The `SandboxRunnerAdapter` hardcodes `User: "sandboxer"` (uid 1001). The host-mounted workspace is created by the Node.js host process (likely running as a different uid). Will file permissions conflict?

**Resolution**: The adapter already handles this for the existing P0.5 sandbox — the same pattern applies. Create workspace with `0o777` or `chown 1001:1001` on the host before mounting. OpenClaw writes config/session files to `OPENCLAW_CONFIG_PATH` and `OPENCLAW_STATE_DIR`, both on the workspace mount.

### OQ-7: `--message` Size Limits

OpenClaw receives the prompt via CLI `--message` flag. For very long prompts (e.g., pasting an entire file for review), this could hit shell argument limits (typically 128KB–2MB depending on OS). Alternative: write message to a file and use shell substitution `--message "$(cat file)"`.

**Resolution**: Our invocation already uses `$(cat /workspace/.cogni/prompt.txt)`. Verify this works for prompts up to the shell limit. For larger inputs, consider writing a wrapper script inside the container.

### OQ-9: Egress Policy for `pnpm install` Inside Container

The devtools image includes pnpm, and the `pnpm_store` volume enables fast installs. But `pnpm install` requires network access to a package registry. In ephemeral mode (`network=none`), this is impossible. In gateway mode (`sandbox-internal`), only Docker DNS is available — no internet egress.

Options: (a) host pre-seeds `node_modules` on the workspace volume before mounting, (b) allow minimum egress from `sandbox-internal` to an internal npm proxy/mirror, (c) pre-populate `pnpm_store` volume from host.

## Related

- **Project:** [proj.sandboxed-agents](../../work/projects/proj.sandboxed-agents.md) — Roadmap: container, E2E wiring, custom agents, conversation continuity
- [Sandboxed Agents](sandboxed-agents.md) — Core sandbox invariants 1–12, phase definitions (pending migration)
- [OpenClaw Sandbox Controls](openclaw-sandbox-controls.md) — Invariants 20-25, dynamic catalog, git relay, dashboard
- [External Executor Billing](external-executor-billing.md) — Reconciliation pattern, billing invariants
- [Sandbox Scaling](../SANDBOX_SCALING.md) — Proxy architecture, threat model (pending migration)
- [Graph Execution](graph-execution.md) — GraphExecutorPort, AggregatingGraphExecutor
- [Tool Use](tool-use.md) — Tool execution, DENY_BY_DEFAULT
- [RBAC](rbac.md) — ExecutionGrant, allowSandbox gate
- OpenClaw repo: `/Users/derek/dev/openclaw/` — source of truth for OpenClaw internals
