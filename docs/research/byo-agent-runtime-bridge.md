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

## v0 critical review (post-prototype, 2026-05-06)

The walking skeleton landed and works. PR #1280 ships a `cogni dev` CLI + a bespoke `/runtimes/dev` page; both screenshots and live demo confirm Claude Code and Codex round-trip from the candidate-a operator UI through a Cloudflare quick tunnel into this workspace.

But the prototype made **two architectural shortcuts that a v1 cannot keep**:

### Shortcut 1: bypassed the GraphExecutor contract

The page hand-rolls a chat UI and POSTs directly from the browser to the user's tunnel. Every other graph-running surface in the system (in-proc langgraph, langgraph-dev, sandbox) flows through `GraphExecutorPort` server-side and emits `ChatDeltaEvent`s into the existing `assistant-ui` Thread. The bridge should look identical from the consumer's perspective — a paired device is just a `LlmProvider`/`GraphExecutor` whose runtime happens to live behind a signed channel on the user's machine. The page goes away; bridge devices appear as entries in the existing `/chat` model picker (`provider: "bridge", connectionId: <device_id>`). Conversation continuity, threads, prompt cards, persistence all "just work" because they're already implemented for the canonical chat surface.

This also flips the transport: instead of browser → tunnel direct, the operator's `BridgeRuntimeProvider` server-side fetches the tunnel using a per-device secret it holds (AEAD-encrypted in the existing `connections` table or a sibling `device_connections` table). The browser never sees the tunnel URL. That is what closes most of the security surface in one move.

### Shortcut 2: no isolation on the agent's host

`claude` and `codex exec` currently run with `cwd = process.cwd()` of `cogni dev`, which on Derek's machine is the entire monorepo worktree. `claude` also reads/writes `$HOME/.claude` for memories. A malicious prompt is a supply-chain attack against the user's primary repo and cross-session persistent state. **No further user can touch this prototype until isolation lands.**

The fix: `cogni dev` does not run agents in `process.cwd()`. Each session provisions a fresh isolated worktree under `~/.cogni/sessions/<uuid>/` (configurable). Agent processes spawn with `cwd` pointed there and `HOME` overridden to a session-local directory, so `claude`'s memories and `codex`'s state are scoped to the session and disappear with it. v0 invariant: **no escalation pathway possible** — the agent cannot read or write outside the session worktree, period. v-next: explicit grant flow for the user to mount additional read-only or read-write paths on a per-session basis.

## Roadmap

Single API work item: `task.5000`. Each phase below ships as one PR; the work item is updated, not decomposed.

### Phase 0 — current PR (#1280, "Derek's machine only")

- **Status**: shipped, validated on candidate-a, NOT for any second user.
- **Bound by**: tunnel URL == only secret; agents have full disk access; UI is a debug console, not the polished chat.
- **Action**: merge as-is for the artifact and the live demo; flag clearly as untrusted prototype in the PR body and the page itself.

### Phase 1 — Isolation (HARD GATE before user N=2)

- `cogni dev` provisions a fresh session worktree under `~/.cogni/sessions/<uuid>/`. Bootstrap: `git init` + optional `git clone <url>` if the user passes `--repo`.
- Spawned `claude` / `codex` get `cwd = <session>`, `HOME = <session>/.home`, `TMPDIR = <session>/tmp`. No env passthrough of `PATH`, `OPENAI_*`, or other secrets the user has lying around.
- Dropped: `--workdir` flag (the agent never picks the host's cwd).
- v0-strict invariant: **no path outside the session is reachable by the agent.** This is enforceable today via env override + `cwd`; it is not a sandbox in the kernel sense, but it removes the obvious supply-chain footgun and the `$HOME/.claude` cross-session leak.
- Validates by: prompt the agent to `ls /Users/derek` or `cat ~/.ssh/id_rsa` — must come back empty.

### Phase 2 — GraphExecutor contract alignment (kills the page; kills 200+ lines of duplicated UI)

- New port adapter: `BridgeRuntimeProvider implements GraphExecutorPort`, registered server-side at namespace `bridge:claude` and `bridge:codex` in the factory at `nodes/operator/app/src/bootstrap/graph-executor.factory.ts`.
- `runGraph()` looks up the device's signed channel, makes a server-side `POST /run` to the tunnel with the prompt **piped via stdin** (kills the `ARG_MAX` and shell-special-char issues), parses the SSE chunks, re-emits as `ChatDeltaEvent`. The runtime's wire format on the user's machine becomes the same envelope every other graph executor consumes.
- Bridge devices appear as model-picker entries in the existing `/chat` page — paired by user, identified by display name, e.g. "claude on derek-mbp".
- `nodes/operator/app/src/app/(app)/runtimes/dev/{page,view}.tsx` deleted; the entire 250-line bespoke chat goes to the trash.
- Conversation continuity, thread persistence, prompt cards, attach/mic, gradient send button, all polish from `image-v1.png` — all inherited for free.
- The `cogni dev` CLI loses `--print-url-only`, `--no-tunnel`, `--allow-empty`, and the hardcoded operator-origin allowlist.

### Phase 3 — Per-user device pairing (multi-tenant correct)

- `cogni dev` becomes `cogni pair` (one-time) + `cogni dev` (recurring foreground). Pair flow: device emits a code, user confirms in the operator UI under `/settings/runtimes`, operator issues a per-device secret stored AEAD in `connections`/`device_connections` with AAD `{billing_account_id, device_id, provider="cogni-bridge"}`.
- Every `/run` and `/capabilities` request carries `Authorization: Bearer <device-secret>`; the local server rejects everything else. CORS becomes a defence-in-depth layer, not the primary control.
- The tunnel URL is operator-side state, never in the browser or the URL bar. Closes findings 1, 2, 6, 8 from the security review.
- New endpoints under `/api/v1/runtimes/devices/...` (announce, list, revoke, send).

### Phase 4 — Hardening

- Concurrency cap (=1 for v0 of this phase), per-message wallclock timeout (5 min), per-minute rate limit, request-body size cap (256 KB).
- Audit log: every `/run` records `principal_id`, `device_id`, `prompt_hash`, `binary_path`, exit code, duration. Lands in the operator's existing AI-runs activity feed.
- Error sanitization in SSE — no raw stderr leaks of file paths or env hints.
- `Referrer-Policy: no-referrer` and a tight CSP on the chat page so no cross-site resource leaks the bridge identity.

### Phase 5 — Beyond batch (post-MVP)

- Conversation continuity via `claude --resume <session-id>` and persistent codex sessions.
- Token-by-token streaming (Channels mode) once Anthropic ships daemonization (`claude remote-control --headless`); until then, batch.
- Headless cloud-VM target with a tmux wrapper for the TTY constraint.
- v-next isolation: explicit grant flow letting the user mount additional paths (e.g. "agent may read-only access `~/dev/cogni-template`") with revocation, per-grant audit.

## Specs (fold-in points, not new files yet)

- Update `docs/spec/architecture.md` to list `BridgeRuntimeProvider` alongside the other GraphExecutor adapters once Phase 2 lands.
- Add a short section to `docs/spec/security-auth.md` covering the device-secret model and AEAD AAD binding when Phase 3 lands.
- A standalone `docs/spec/byo-agent-runtime-bridge.md` only after Phase 3 — earlier specs would just rot. Per `SPECS_ARE_AS_BUILT`.

Routing: all phases stay on `node = operator`; the `@cogni/cli` package is a workspace-level tool, no node tag.
