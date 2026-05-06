---
id: byo-agent-runtime-bridge
type: research
title: "BYO Agent Runtime — Hosted UI Controls Local Claude Code / Codex"
status: active
trust: draft
verified: 2026-05-05
summary: "How a Cogni operator user, browsing cognidao.org, can pair and remote-control a Claude Code or Codex process running on their own laptop or cloud VM — modeled on the LangGraph dev ↔ LangSmith Studio pattern."
read_when: "Designing the operator-side surface for user-owned agent runtimes, picking a transport for hosted-UI ↔ local-CLI control, or evaluating whether to host this ourselves vs. lean on Anthropic's Bridge / community projects."
owner: derekg1729
created: 2026-05-05
tags: [byo-ai, claude-code, codex, langgraph, bridge, operator, graph-executor]
---

# Research: BYO Agent Runtime — Hosted UI Controls Local Claude Code / Codex

> spike: ad-hoc `/research` (2026-05-05) | related: [openai-oauth-byo-ai](openai-oauth-byo-ai.md), [tailscale-headscale-mesh-vpn](tailscale-headscale-mesh-vpn.md), [mcp-production-deployment-patterns](mcp-production-deployment-patterns.md)

## Question

A user is browsing the deployed Cogni operator (cognidao.org). From a page in that hosted UI, they want to pair a Claude Code (or Codex) process running on **their own device** — laptop, dev VM, cloud box — and drive it from the operator: pick a work item, send it to "my-mac", watch the stream, get artifacts back. The operator never holds the user's Anthropic / OpenAI credentials; the agent runtime stays under the user's control.

Three sub-questions:

1. What CLI/SDK surface do Claude Code and Codex actually expose for being driven by another process? What does the Conductor app (the harness this very research session is running inside) actually do?
2. How does `langgraph dev` connect a _locally-running_ server to a _hosted_ studio UI on `smith.langchain.com`? That is the reference pattern.
3. Given (1) and (2), and given Cogni's existing `GraphExecutorPort` + `connections` table architecture, what is the minimum-viable shape for a Cogni "device bridge" — a Next.js page on the operator that pairs and dispatches to user-owned runtimes?

## Context

Cogni already has the upstream half of "BYO" wired:

- **`GraphExecutorPort`** (`packages/graph-execution-core/src/graph-executor.port.ts`) routes graph runs by namespace via `NamespaceGraphRouter`. Existing namespaces: `langgraph` (in-proc or dev), `sandbox` (Docker via `SandboxGraphProvider`).
- **Codex BYO-AI** (`adapters/server/ai/codex/codex-llm.adapter.ts`, route `app/api/v1/auth/openai-codex/exchange`) exists today. User OAuths once; token stored AEAD-encrypted in `connections` table (`packages/db-schema/src/connections.ts`) with AAD `{billing_account_id, connection_id, provider}`. `ConnectionBrokerPort` resolves at run time.
- **External-agent contract** (`/api/v1/agent/register` → 30-day `cogni_ag_sk_v1_*` HMAC token; `/api/v1/work/items/{id}/{claims,heartbeat,pr,coordination}`) already lets a process running anywhere claim a work item and report progress over plain HTTPS. That is the _outbound_ model (agent calls operator).

What is **missing** is the _inbound_ dispatch direction: operator-side UI says "run this on the user's laptop" and the laptop's Claude Code obeys. Today's `/contribute-to-cogni` flow assumes the agent decides what to do; here the hosted UI decides.

The naive "treat the local Claude Code as another `GraphExecutorPort` adapter" framing was the first read of this question and it is wrong: that puts the runtime inside the operator's process boundary. The user explicitly wants the runtime to live on **their** device, with the operator sending it work over a channel.

The right reference architecture is **LangGraph dev ↔ LangSmith Studio**, plus Anthropic's own **Claude Code Bridge / Remote Control** (which solves exactly this problem, but only between a local CLI and `claude.ai`).

## Findings

### 1. What Claude Code and Codex actually expose

**Claude Code SDK (May 2026)** ([Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview), [headless docs](https://code.claude.com/docs/en/headless), [GH issue #29116](https://github.com/anthropics/claude-code/issues/29116)) ships three orthogonal control mechanisms:

| Mechanism          | Shape                                                                                                        | Fit                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Dispatch**       | Submit a task, poll for completion. No live channel.                                                         | Fire-and-forget; matches Cogni's existing `claims → heartbeat → pr` polling shape.  |
| **Channels**       | Persistent streaming connection (WebSocket-flavored) for live tokens, mid-run instructions, progress events. | Closest to "remote-controlled live session"; what the operator UI ideally consumes. |
| **Remote Control** | Pause / resume / inspect / intercept of a running session.                                                   | Operator could implement a "pause this run" button.                                 |

**Bridge mode** ([deepwiki](https://deepwiki.com/claude-code-best/claude-code/9.2-authentication-and-oauth)) is Anthropic's first-party version of exactly the pattern asked for: a local Claude Code CLI registers as a "bridge environment" and is driven from `claude.ai` via long-poll/WebSocket. It works — and the implication is Anthropic is _not_ exposing this as a public bridge protocol you can host yourself; the only registered controller is `claude.ai`.

**Headless caveat** ([GH #30447](https://github.com/anthropics/claude-code/issues/30447)): `claude remote-control` currently requires a TTY. On a headless server (the obvious "cloud VM" target) the only reliable option today is wrapping it in `tmux` / `screen`. Daemonization is an open feature request.

**Codex CLI**: `codex exec` (already used by `CodexLlmAdapter`) is a clean non-interactive subprocess invocation. There is no native "bridge mode" equivalent; remote control = wrapper script + transport.

**Community prior art** (informative, not adoptable as-is):

- [`MatthewJamisonJS/claude-on-the-go`](https://github.com/MatthewJamisonJS/claude-on-the-go): WebSocket bridge phone → Mac → Claude CLI.
- [`K9i-0/ccpocket`](https://github.com/K9i-0/ccpocket): mobile client controlling Codex/Claude over WebSocket.

Both validate the shape: **persistent reverse WebSocket from device to a public broker, with the controller as the third party.**

### 2. Conductor (the harness this session is running in)

[conductor.build](https://conductor.build/) is **Mac-app-local only**. It manages git worktrees, invokes Claude Code / Codex CLIs, and reuses whatever auth the user already has (subscription or API key). It has no backend, no remote agents, and no cross-device sync. It is an orchestrator for _parallel local_ sessions, not a transport. Useful as a UX reference (worktree-per-task, "many agents at once") but **does not solve our problem** — we need the controller to be the operator's hosted Next.js, not a Mac binary.

### 3. The LangGraph dev ↔ LangSmith Studio reference pattern

Confirmed mechanism ([Studio troubleshooting](https://docs.langchain.com/langsmith/troubleshooting-studio), [forum thread](https://forum.langchain.com/t/langgraph-cli-cors-issue/2128)):

1. User runs `langgraph dev --tunnel` locally. CLI binds an HTTP server (default port 2024) **and** spawns a Cloudflare quick tunnel via `cloudflared`, getting an ephemeral `https://<words>.trycloudflare.com` URL.
2. CLI prints a Studio URL of the form `https://smith.langchain.com/studio/?baseUrl=<tunnel-url>`.
3. User opens that URL in a browser they're already logged into LangSmith with. The hosted Studio JS reads `baseUrl` from the query string and makes **CORS-allowed HTTPS calls directly from the browser to the tunnel**, which forwards to `localhost:2024`.
4. There is no operator-side WebSocket gateway and no Anthropic-style first-party bridge. The transport is "browser → public HTTPS tunnel → local server", and the hosted page is essentially a stateless thin client over the local API.
5. Auth: LangSmith login gates the _UI_; the local server has its own scoping. Browser fetches carry no LangSmith session into the local server.

**Known sharp edges** (worth absorbing before copying):

- Cloudflare quick tunnels are flaky; intermittent disconnects are common.
- Chrome ≥142 enforces Private Network Access; HTTPS pages cannot fetch HTTP-localhost without explicit user opt-in. Plain `http://localhost:2024` from `https://smith.langchain.com` is dead in mainstream browsers — `--tunnel` is now mandatory, not optional.
- The _origin_ of the calls is the user's browser, not the LangSmith backend, so the local server only needs to allowlist the studio origin in CORS, not authenticate LangSmith infrastructure.

This is the cleanest, lowest-cost-to-host pattern: the operator runs no bridge gateway, holds no socket state, and pays no egress for the stream.

### 4. Existing Cogni surface to integrate against

From the operator survey (graph executor + connections side):

- **Add a new `GraphExecutorPort` adapter** under namespace `bridge:claude-code` (and `bridge:codex`). Its `runGraph()` does **not** spawn the agent — it dispatches a run envelope to the user's paired device and proxies the event stream back as `AiEvent`s. This slots cleanly into `NamespaceGraphRouter` (`packages/graph-execution-host/src/routing/namespace-graph-router.ts`).
- **`connections` table** is the right precedent for the per-user pairing record but a poor fit for the _content_: there's no third-party OAuth token to store; what we need is a stable device identity + capability tags + last-seen + a per-device shared secret. Options:
  - Reuse `connections` with a new `provider = "cogni-bridge-device"`, `credential_type = "device_secret"`. Pros: one schema. Cons: semantic stretch.
  - New `device_connections` table. Cleaner; can hold capability/runtime metadata.
- **Auth for the device** can reuse the agent-key issuance path (`/api/v1/agent/register`) — a paired device is just a registered agent with a `runtime_kind` tag.
- **Hosted page** lives under `nodes/operator/app/src/app/(app)/runtimes/` (parallel to existing `/work`, `/activity`).
- **No precedent for inbound WebSocket gateway in operator.** Operator runs on Vercel-style Next.js; persistent WS hosting is not Next-native. This is the load-bearing architectural decision.

### 5. Transport options for "operator UI ↔ user's device"

| Option                                      | Who hosts state?                           | Browser → device path                                       | Pros                                                                                                                                | Cons                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Tunnel-from-device (LangGraph model)** | Cloudflare / ngrok / tailscale             | browser → public tunnel → local agent                       | No operator-side socket infra; matches LangGraph exactly; stateless on our side                                                     | Tunnels flaky; users must run `cloudflared`; CORS config on local agent; no auth boundary on the tunnel itself unless the local server enforces it; PNA breakage risk |
| **B. Reverse WS to operator**               | Operator (new gateway service)             | browser → operator → WS → device                            | Single trust boundary; works behind NAT without user-side tunneling; clean auth (device key); lets us aggregate capability registry | Requires non-Next service for WS hosting (e.g., a small Fastify/uWebSockets service on candidate-a); adds infra.                                                      |
| **C. SSE down + POST up**                   | Operator                                   | browser → operator → SSE → device; device → POST → operator | Vercel/Next-friendly (SSE works on Edge with caveats); same trust boundary as B                                                     | Half-duplex per channel; long-running SSE connections still want a non-serverless host in practice                                                                    |
| **D. Smee.io-style relay**                  | Third party (smee.io or self-hosted relay) | browser → operator → smee → device                          | Already used in repo for GH/Alchemy webhooks (`pnpm dev:smee`); zero new infra for MVP                                              | Externally-hosted plaintext relay; awful for production user data; latency unpredictable                                                                              |
| **E. Anthropic's Bridge**                   | Anthropic                                  | (n/a — controller is `claude.ai`)                           | Best UX if we were `claude.ai`                                                                                                      | Not a public protocol; we cannot be the controller                                                                                                                    |
| **F. Tailscale / headscale mesh**           | Tailscale (or self-hosted)                 | browser → operator → Tailscale → device                     | Strong identity; existing research note ([tailscale-headscale-mesh-vpn](tailscale-headscale-mesh-vpn.md))                           | Heavyweight per-user install; mismatched with "open the hosted page and pair" UX                                                                                      |

## Recommendation

**Adopt the LangGraph model (Option A) for v0, with a Cogni-flavored device-pairing layer.** Defer the operator-hosted WebSocket gateway (Option B/C) until A's seams hurt enough to justify the infra.

**Concretely, v0 looks like this:**

1. Ship a thin CLI (`cogni-bridge` — a small Node binary or `pnpm dlx`-able package) that:
   - On `cogni-bridge pair`: prints a device code, opens a browser to `https://cognidao.org/runtimes/pair?code=…`. User confirms in the operator UI; CLI receives a per-device API key (issued via the existing agent-key path) and stores it in `~/.cogni/bridge.json`.
   - On `cogni-bridge run`: binds `127.0.0.1:<port>`, advertises capabilities (`claude-code` if `claude` on PATH, `codex` if `codex` on PATH), starts a Cloudflare quick tunnel via `cloudflared` (preferred) or a tailscale funnel (fallback), and posts the resulting public URL + capability list to the operator (`POST /api/v1/runtimes/<deviceId>/announce`).
   - Local HTTP API exposes one endpoint per capability: `POST /run` accepts a Cogni run envelope, spawns `claude --print …` (headless) or `codex exec …` in a worktree, streams stdout/stderr as SSE chunks, returns artifacts.
   - CORS allowlist: only `https://cognidao.org` (and preview origin).

2. **Operator side** adds:
   - `nodes/operator/app/src/app/(app)/runtimes/page.tsx` — list of paired devices, status (online/last seen), capabilities, "run this work item here" button.
   - `nodes/operator/app/src/app/api/v1/runtimes/announce/route.ts` — receives device's tunnel URL on each session start.
   - New `BridgedRuntimeProvider implements GraphExecutorPort` registered at namespace `"bridge"`. `runGraph()` looks up the device's current tunnel URL, makes the browser-side fetch (or — for server-initiated runs — a server-side fetch), proxies SSE chunks back as `AiEvent`s.
   - Schema: new `device_connections` table (id, billing_account_id, device_id, display_name, runtime_kind, last_seen_at, last_tunnel_url, encrypted_device_secret AEAD-bound to `{billing_account_id, device_id}`).

3. **Trade-offs accepted in v0:**
   - Cloudflare quick-tunnel flakiness inherits LangGraph's pain; document `cogni-bridge run --tunnel=tailscale` as the stable fallback.
   - No operator-mediated transport means the hosted page must call the user's tunnel directly from the browser (CORS path) for streaming UX. Server-initiated runs (e.g., a scheduled work item dispatched to the user's laptop) still work but the user must have the bridge online.
   - Headless TTY constraint on `claude remote-control` means we use **Dispatch / `claude --print`** for v0, not the live Channels API. Streaming is "stdout chunk" granularity, not token-by-token. Acceptable for the work-item-dispatch UX; revisit when Anthropic ships daemon mode.
   - We hold no Anthropic credentials. `claude` on the user's device authenticates with whatever the user is logged in with (subscription or API key). This is the "BYO" promise — and a hard alignment with the [openai-oauth-byo-ai](openai-oauth-byo-ai.md) direction (operator never holds LLM keys).

**v1 escape hatch (not now):** if/when the flakiness or CORS surface gets ugly, introduce an operator-hosted bridge gateway (Option C: SSE down, POST up). It coexists with v0 because the device-pairing record and the `BridgedRuntimeProvider` adapter are unchanged — only the transport layer underneath swaps.

## Open Questions

1. **Server-initiated runs**: if the operator (e.g., a cron / autonomous loop) wants to dispatch to a paired device, the browser is not in the loop and `runGraph()` runs server-side. Server → user's Cloudflare tunnel works _if the tunnel is up_, but the device only runs the tunnel when the user starts `cogni-bridge run`. Do we want always-on bridges (closer to Option B), or is "user must be running the bridge" acceptable? My read: acceptable for v0; flag in the UI.
2. **Auth boundary on the tunnel**: a Cloudflare quick tunnel is publicly addressable. The device's HTTP server must require the per-device API key on every request, otherwise anyone who guesses the tunnel URL can drive the user's Claude. Is the existing `cogni_ag_sk_v1_*` HMAC token sufficient, or do we want mTLS / additional binding?
3. **Workspace selection on the device**: the operator's run envelope needs to specify "run in repo at path X / branch Y" or "make a new worktree of repo Z". Reuses the worktree pattern Conductor uses; needs to be defined as part of the run envelope schema. Not blocking the architecture choice but should be specced before tasks land.
4. **Codex parity**: most of the doc is Claude Code-shaped. `codex exec` works, but Codex has no Channels equivalent — only batch. Confirm the operator UI degrades gracefully (no live stream, only completed-artifact view) for Codex devices.
5. **Conductor integration**: would Conductor ever _be_ the bridge (i.e., a Conductor workspace registers itself as a Cogni-paired runtime)? Tempting, but Conductor has no API surface today; out of scope unless they ship one.
6. **Headless server target**: Cogni-DAO contributors may want to pair a cloud VM, not a laptop. The TTY constraint on `claude remote-control` argues for `tmux`-wrapped invocation in the bridge CLI; needs a smoke test before the v0 launch.

## Proposed Layout

Loose, directional — not binding.

### Project

`proj.byo-agent-runtime-bridge` — single project, three phases roughly mapping onto the v0 / hardening / v1 split:

- **Phase 0 — Spec & Contract**: define the run-envelope schema, the device-pairing flow, the `BridgedRuntimeProvider` interface, and the device-side CLI shape. One spec, no code.
- **Phase 1 — Walking skeleton** (v0 above): paired-device flow + Cloudflare-tunnel transport + Claude Code dispatch (`claude --print`). One paired device runs one work item end-to-end from `cognidao.org/runtimes`.
- **Phase 2 — Codex + reliability**: Codex parity, tailscale-funnel fallback, "device offline" UX, retry / resumption semantics.
- **Phase 3 — Operator-mediated transport (optional)**: if the v0 seams justify it, introduce the SSE/POST gateway service. Otherwise skip.

### Specs

- `docs/spec/byo-agent-runtime-bridge.md` (new) — the as-built once Phase 1 lands. Key invariants:
  - **Operator-never-holds-LLM-credentials** (parallel to BYO-AI).
  - **Device-key-on-every-request**: tunnel URL is public; auth lives on the request, not the tunnel.
  - **Single-namespace dispatch**: every run flows through `GraphExecutorPort` namespace `"bridge"`; no side-channel from the UI to the device that bypasses run accounting.
- Update `docs/spec/architecture.md` to add `BridgedRuntimeProvider` to the GraphExecutor adapter list.
- Update `docs/guides/agent-api-validation.md` if the device-pairing flow exposes new endpoints worth validating.

### Tasks (rough sequence)

1. `task` — Spec the run-envelope + device-pairing endpoints (`POST /api/v1/runtimes/announce`, device-key issuance reuse, capability advertisement schema). Output: spec doc; no implementation.
2. `task` — Add `device_connections` table + drizzle schema; `pnpm db:generate:operator`; migration. Use the `schema-update` skill.
3. `task` — Implement `BridgedRuntimeProvider implements GraphExecutorPort`, register in `createGraphExecutor()` factory. Stub transport (no real device call yet); unit-test the namespace routing.
4. `task` — Build the `cogni-bridge` CLI as a new package under `packages/bridge-cli/` (or as a thin npm package outside the monorepo if we want it independently versioned). Capability detection + Cloudflare quick-tunnel spawn + local `POST /run` → `claude --print` shell-out.
5. `task` — Operator UI: `/runtimes` page, pair-device flow, list-of-devices view. Reuses existing `/work` patterns.
6. `task` — Wire `BridgedRuntimeProvider` to the real device (drop the stub from task 3); E2E from `cognidao.org/runtimes` → user's laptop runs Claude Code on a small work item.
7. `spike` — Codex parity smoke test on a known-good Codex install; only after Phase 1 is green.
8. `spike` — Headless-server / `tmux` wrapper target; only after Phase 1 is green.

Open routing question for the work items: Phase 0/1 belongs on `node = operator`; the CLI package may want `node = sandbox-runtime` or a new node — defer to triage.
